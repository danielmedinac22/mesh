import { NextRequest } from "next/server";
import { appendBrainEntry, type BrainEntry } from "@/lib/user-brain";
import { recordImport, setMcpStatus } from "@/lib/integrations";
import {
  fetchRecentMeetings,
  GRANOLA_DEFAULT_DAYS,
  GRANOLA_MAX_LIMIT,
  GranolaNotLinkedError,
} from "@/lib/granola-mcp";
import { inspectGranolaInstall } from "@/lib/granola-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefreshEvent =
  | { type: "phase"; id: "fetch" | "store" | "done"; label: string }
  | { type: "meeting"; entry: BrainEntry }
  | {
      type: "done";
      count: number;
      duration_ms: number;
      windowDays: number;
    }
  | { type: "error"; message: string; code?: "not_linked" | "network" };

type Body = { days?: number; limit?: number };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const days = Math.max(1, Math.min(60, body.days ?? GRANOLA_DEFAULT_DAYS));
  const limit = Math.max(1, Math.min(GRANOLA_MAX_LIMIT, body.limit ?? 20));

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: RefreshEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      try {
        send({
          type: "phase",
          id: "fetch",
          label: `Pulling last ${days} day${days === 1 ? "" : "s"} from Granola`,
        });

        const meetings = await fetchRecentMeetings({ days, limit });

        send({
          type: "phase",
          id: "store",
          label: `Storing ${meetings.length} meeting${meetings.length === 1 ? "" : "s"} into your brain`,
        });

        for (const m of meetings) {
          const parts = [m.summary, m.privateNotes].filter((s) => s && s.trim());
          if (parts.length === 0 && m.attendees.length > 0) {
            parts.push(`Attendees: ${m.attendees.join(", ")}`);
          }
          const body = parts.join("\n\n") || "(no notes captured)";
          const entry = await appendBrainEntry({
            kind: "meeting",
            title: m.title,
            body,
            source: "granola",
            ref: m.id,
            tags: m.attendees.slice(0, 3),
          });
          send({ type: "meeting", entry });
        }

        if (meetings.length > 0) {
          await recordImport("granola", meetings.length).catch(() => {});
        }
        const info = await inspectGranolaInstall();
        await setMcpStatus("granola", { status: info.status, email: info.email });

        send({
          type: "done",
          count: meetings.length,
          duration_ms: Date.now() - startedAt,
          windowDays: days,
        });
      } catch (err) {
        if (err instanceof GranolaNotLinkedError) {
          await setMcpStatus("granola", { status: "needs_login" });
          send({ type: "error", message: err.message, code: "not_linked" });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          send({ type: "error", message, code: "network" });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
