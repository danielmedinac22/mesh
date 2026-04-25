import { startDeviceFlow } from "@/lib/gh-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const handle = startDeviceFlow();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      }
      // Heartbeat so SSE clients keep the connection alive.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, 15_000);
      try {
        for await (const ev of handle.events) {
          if (ev.kind === "code") {
            send("code", { code: ev.code, verifyUrl: ev.verifyUrl });
          } else if (ev.kind === "done") {
            send("done", { ok: true });
          } else if (ev.kind === "error") {
            send("error", { message: ev.message });
          } else if (ev.kind === "log") {
            send("log", { line: ev.line });
          }
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      handle.cancel();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
