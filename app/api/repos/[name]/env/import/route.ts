import { NextRequest } from "next/server";
import { z } from "zod";
import { getRepo, getRepoEnv, loadConfig, setRepoEnv } from "@/lib/mesh-state";
import { getEngine } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  raw: z.string().min(1).max(200_000),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

const SYSTEM = `You are a config-file parser. The user pastes the contents of a .env file (or similar dotenv-style content). Extract all environment variables into a clean key-value map.

Rules:
- Output VALID JSON only, wrapped in <result>...</result> tags.
- Schema: { "vars": { "KEY": "VALUE", ... }, "skipped": [ { "key": "KEY", "value": "VALUE", "reason": "string" } ], "notes": "short summary, 1-2 sentences" }
- Strip surrounding single or double quotes from values.
- Strip comments (lines starting with #) and ignore inline comments after unquoted values.
- Skip lines that look like placeholders (e.g. value is empty, "your_key_here", "xxx", "TODO", "...", "<your_secret>", "changeme"). Add them to skipped with reason="placeholder".
- Skip duplicates (later wins). Note duplicates in skipped with reason="duplicate".
- Preserve multi-line values that use quoted strings.
- Keys must match /^[A-Z_][A-Z0-9_]*$/i. Skip malformed lines with reason="malformed".
- Do not invent keys. Do not add keys that are not present in the input.
- Do not echo secret values in "notes".

Use thinking to organize your work before producing the JSON. Be concise.`;

export async function POST(
  req: NextRequest,
  { params }: { params: { name: string } },
) {
  const repo = await getRepo(params.name);
  if (!repo) {
    return Response.json(
      { error: `repo ${params.name} not registered` },
      { status: 404 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  const { raw, mode } = parsed.data;
  const config = await loadConfig();
  const engine = getEngine(config.engineMode);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed
        }
      };

      let textBuf = "";
      try {
        for await (const ev of engine.run({
          system: SYSTEM,
          prompt: `Parse this env content:\n\n<env>\n${raw}\n</env>`,
        })) {
          if (ev.type === "thinking") {
            send({ type: "thinking", delta: ev.delta });
          } else if (ev.type === "text") {
            textBuf += ev.delta;
          } else if (ev.type === "done") {
            send({
              type: "usage",
              input_tokens: ev.input_tokens,
              output_tokens: ev.output_tokens,
              cache_creation_input_tokens: ev.cache_creation_input_tokens,
              cache_read_input_tokens: ev.cache_read_input_tokens,
            });
          } else if (ev.type === "error") {
            send({ type: "error", message: ev.message });
            controller.close();
            return;
          }
        }

        const result = extractResult(textBuf);
        if (!result) {
          send({
            type: "error",
            message: "Could not parse Claude's response as JSON.",
          });
          controller.close();
          return;
        }

        let finalEnv: Record<string, string> = {};
        if (mode === "merge") {
          const existing = await getRepoEnv(repo.name).catch(() => ({}));
          finalEnv = { ...existing, ...result.vars };
        } else {
          finalEnv = { ...result.vars };
        }

        await setRepoEnv(repo.name, finalEnv);
        send({
          type: "result",
          env: finalEnv,
          imported: result.vars,
          skipped: result.skipped,
          notes: result.notes,
          mode,
        });
        controller.close();
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

type ParsedResult = {
  vars: Record<string, string>;
  skipped: Array<{ key?: string; value?: string; reason?: string }>;
  notes: string;
};

function extractResult(text: string): ParsedResult | null {
  const match = text.match(/<result>([\s\S]*?)<\/result>/i);
  const candidate = match ? match[1] : text;
  const json = stripFences(candidate).trim();
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const vars = isStringMap(obj.vars) ? obj.vars : {};
  const skipped = Array.isArray(obj.skipped)
    ? (obj.skipped as ParsedResult["skipped"])
    : [];
  const notes = typeof obj.notes === "string" ? obj.notes : "";
  return { vars, skipped, notes };
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function isStringMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object") return false;
  for (const [k, val] of Object.entries(v)) {
    if (typeof k !== "string") return false;
    if (typeof val !== "string") return false;
  }
  return true;
}
