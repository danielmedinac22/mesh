import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgent, getAgentRaw, loadAgents } from "@/lib/agents";
import { listSkills } from "@/lib/skills";
import { loadMemory } from "@/lib/memory";
import { getCurrentProjectId, loadConfig } from "@/lib/mesh-state";
import { bootstrapProjects } from "@/lib/migrations";
import { getEngine } from "@/lib/engine";
import {
  buildAgentImproveSystem,
  buildAgentImproveUser,
} from "@/lib/prompts/agent-improve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }

  await bootstrapProjects();
  const id = parsed.data.id;
  const [agent, raw] = await Promise.all([getAgent(id), getAgentRaw(id)]);
  if (!agent || raw === null) {
    return Response.json({ error: "agent not found" }, { status: 404 });
  }
  const projectId = await getCurrentProjectId();
  const memory = projectId ? await loadMemory(projectId) : null;
  if (!memory) {
    return Response.json(
      { error: "no memory — run /connect first." },
      { status: 409 },
    );
  }

  const [allAgents, existingSkills, config] = await Promise.all([
    loadAgents(),
    listSkills(),
    loadConfig(),
  ]);
  const otherAgents = allAgents.filter((a) => a.id !== agent.id);
  const engine = getEngine(config.engineMode);
  const system = buildAgentImproveSystem({
    memory,
    otherAgents,
    existingSkills,
  });
  const user = buildAgentImproveUser({ currentRaw: raw });

  let thinking = "";
  let text = "";

  for await (const ev of engine.run({
    prompt: user,
    system,
    cacheSystem: true,
    wrapThinking: true,
  })) {
    if (ev.type === "thinking") thinking += ev.delta;
    else if (ev.type === "text") text += ev.delta;
    else if (ev.type === "error") {
      return Response.json({ error: ev.message }, { status: 502 });
    }
  }

  const suggestion = extractAgentMarkdown(text);
  if (!suggestion) {
    return Response.json(
      {
        error: "improver did not return an agent .md",
        raw: text.slice(0, 800),
      },
      { status: 502 },
    );
  }

  return Response.json({
    id: agent.id,
    current: raw,
    suggestion,
    thinking,
  });
}

function extractAgentMarkdown(text: string): string | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  return /^---\s*\n/.test(body) ? body : null;
}
