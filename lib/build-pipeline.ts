import { z } from "zod";
import { loadMemory, type Memory } from "@/lib/memory";
import {
  getCurrentProjectId,
  loadConfig,
  type EngineMode,
} from "@/lib/mesh-state";
import { loadBrainForPrompt } from "@/lib/user-brain";
import { getEngine } from "@/lib/engine";
import { loadAgents, type Agent, type AgentId } from "@/lib/agents";
import { buildSkillsContext } from "@/lib/skills-context";
import { buildClassifySystem, buildClassifyUser } from "@/lib/prompts/classify";
import { slugifyBranch } from "@/lib/github";
import {
  type PlanPayload,
  type PlanV2,
  PlanV2Schema,
} from "@/lib/prompts/plan";
import {
  buildMasterDispatchSystem,
  buildMasterDispatchUser,
  parseDispatchJson,
  type DispatchPayload,
  buildAgentSystem,
  buildAgentUser,
  parseAgentOutputJson,
  type AgentOutput,
  buildSynthesizerSystem,
  buildSynthesizerUser,
  parseSynthesizedPlan,
} from "@/lib/prompts/multi-agent";
import { savePlan, getPlan, type SavedPlan } from "@/lib/plan-store";
import { getTicket, updateTicket, type TicketRecord } from "@/lib/ticket-store";

export type Classification = {
  type: "code_change" | "config" | "faq" | "issue_comment";
  repos_touched: string[];
  target_branch: string;
  confidence: number;
  summary: string;
  reasoning: string;
};

const ClassificationSchema = z.object({
  type: z.enum(["code_change", "config", "faq", "issue_comment"]),
  repos_touched: z.array(z.string()),
  target_branch: z.string(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  reasoning: z.string(),
});

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type PipelineEvent =
  | { type: "ticket-update"; ticket: TicketRecord }
  | { type: "classify-start" }
  | { type: "classify-thinking"; delta: string }
  | { type: "classification"; classification: Classification }
  | { type: "meta"; ttft_ms: number }
  | { type: "thinking"; delta: string }
  | {
      type: "dispatch";
      agents_to_deploy: AgentId[];
      rationale: string;
      instructions_per_agent: Record<string, string>;
    }
  | { type: "agent-start"; agent: AgentId; role: string }
  | { type: "agent-thinking"; agent: AgentId; delta: string }
  | { type: "agent-done"; agent: AgentId; output: AgentOutput }
  | { type: "agent-error"; agent: AgentId; message: string }
  | { type: "synthesis-start" }
  | { type: "synthesis-thinking"; delta: string }
  | { type: "plan"; plan: PlanV2 }
  | { type: "plan-saved"; plan_id: string; ticket_id: string }
  | {
      type: "done";
      duration_ms: number;
      engine_mode: string;
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    }
  | { type: "error"; message: string };

function stripFences(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s;
}
function extractJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}

function accumulateUsage(dest: Usage, ev: Usage): void {
  if (ev.input_tokens !== undefined)
    dest.input_tokens = (dest.input_tokens ?? 0) + ev.input_tokens;
  if (ev.output_tokens !== undefined)
    dest.output_tokens = (dest.output_tokens ?? 0) + ev.output_tokens;
  if (ev.cache_creation_input_tokens !== undefined)
    dest.cache_creation_input_tokens =
      (dest.cache_creation_input_tokens ?? 0) + ev.cache_creation_input_tokens;
  if (ev.cache_read_input_tokens !== undefined)
    dest.cache_read_input_tokens =
      (dest.cache_read_input_tokens ?? 0) + ev.cache_read_input_tokens;
}

function buildTicketInput(t: TicketRecord): string {
  const header = `[${t.id} · priority:${t.priority}${
    t.labels.length ? ` · labels:${t.labels.join(",")}` : ""
  }] ${t.title}`;
  return t.description ? `${header}\n\n${t.description}` : header;
}

async function classifyTicket(args: {
  ticket: string;
  memory: Memory;
  brain?: string;
  engineMode: EngineMode;
  emit: (ev: PipelineEvent) => void;
  usage: Usage;
}): Promise<Classification> {
  const engine = getEngine(args.engineMode);
  const system = buildClassifySystem(args.memory, args.brain);
  const user = buildClassifyUser(args.ticket);

  let fullText = "";
  let lastError: string | null = null;
  for await (const ev of engine.run({
    prompt: user,
    system,
    cacheSystem: true,
    wrapThinking: false,
  })) {
    if (ev.type === "text") fullText += ev.delta;
    else if (ev.type === "thinking")
      args.emit({ type: "classify-thinking", delta: ev.delta });
    else if (ev.type === "meta") args.emit({ type: "meta", ttft_ms: ev.ttft_ms });
    else if (ev.type === "done")
      accumulateUsage(args.usage, {
        input_tokens: ev.input_tokens,
        output_tokens: ev.output_tokens,
        cache_creation_input_tokens: ev.cache_creation_input_tokens,
        cache_read_input_tokens: ev.cache_read_input_tokens,
      });
    else if (ev.type === "error") lastError = ev.message;
  }

  if (lastError) throw new Error(lastError);

  const body = extractJsonObject(stripFences(fullText.trim()));
  const obj = ClassificationSchema.parse(JSON.parse(body));
  const target_branch = obj.target_branch.startsWith("mesh/")
    ? obj.target_branch
    : slugifyBranch(obj.summary || obj.target_branch);
  return { ...obj, target_branch };
}

async function runDispatch(args: {
  memory: Memory;
  agents: Agent[];
  classification: Classification;
  ticket: string;
  brain?: string;
  engineMode: EngineMode;
  emit: (ev: PipelineEvent) => void;
  usage: Usage;
}): Promise<DispatchPayload> {
  const engine = getEngine(args.engineMode);
  const system = buildMasterDispatchSystem({
    memory: args.memory,
    agents: args.agents,
    brain: args.brain,
  });
  const user = buildMasterDispatchUser({
    ticket: args.ticket,
    reposTouched: args.classification.repos_touched,
    targetBranch: args.classification.target_branch,
    classifierReasoning: args.classification.reasoning,
  });

  let fullText = "";
  let lastError = "no attempts";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? user
        : `${user}\n\nPrevious attempt failed: ${lastError}\nEmit ONLY the dispatch JSON after </thinking>.`;
    fullText = "";
    for await (const ev of engine.run({
      prompt,
      system,
      cacheSystem: true,
      wrapThinking: true,
    })) {
      if (ev.type === "thinking")
        args.emit({ type: "thinking", delta: ev.delta });
      else if (ev.type === "text") fullText += ev.delta;
      else if (ev.type === "meta")
        args.emit({ type: "meta", ttft_ms: ev.ttft_ms });
      else if (ev.type === "done")
        accumulateUsage(args.usage, {
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cache_creation_input_tokens: ev.cache_creation_input_tokens,
          cache_read_input_tokens: ev.cache_read_input_tokens,
        });
      else if (ev.type === "error") lastError = ev.message;
    }
    try {
      return parseDispatchJson(fullText);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`Dispatch failed: ${lastError}`);
}

async function runSubAgent(args: {
  agent: Agent;
  memory: Memory;
  skillsContext: string;
  ticket: string;
  classification: Classification;
  instructions: string;
  brain?: string;
  engineMode: EngineMode;
  emit: (ev: PipelineEvent) => void;
  usage: Usage;
}): Promise<AgentOutput> {
  const engine = getEngine(args.engineMode);
  const system = buildAgentSystem({
    agent: args.agent,
    memory: args.memory,
    skillsContext: args.skillsContext,
    targetBranch: args.classification.target_branch,
    brain: args.brain,
  });
  const user = buildAgentUser({
    ticket: args.ticket,
    reposTouched: args.classification.repos_touched,
    targetBranch: args.classification.target_branch,
    instructions: args.instructions,
  });

  let fullText = "";
  let lastError = "no attempts";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? user
        : `${user}\n\nPrevious attempt failed: ${lastError}\nEmit ONLY the JSON after </thinking>.`;
    fullText = "";
    for await (const ev of engine.run({
      prompt,
      system,
      cacheSystem: true,
      wrapThinking: true,
    })) {
      if (ev.type === "thinking")
        args.emit({
          type: "agent-thinking",
          agent: args.agent.id,
          delta: ev.delta,
        });
      else if (ev.type === "text") fullText += ev.delta;
      else if (ev.type === "done")
        accumulateUsage(args.usage, {
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cache_creation_input_tokens: ev.cache_creation_input_tokens,
          cache_read_input_tokens: ev.cache_read_input_tokens,
        });
      else if (ev.type === "error") lastError = ev.message;
    }
    try {
      return parseAgentOutputJson(fullText, args.agent.id);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`Sub-agent ${args.agent.id} failed: ${lastError}`);
}

async function runSynthesis(args: {
  memory: Memory;
  ticket: string;
  classification: Classification;
  dispatch: DispatchPayload;
  outputs: AgentOutput[];
  brain?: string;
  engineMode: EngineMode;
  emit: (ev: PipelineEvent) => void;
  usage: Usage;
  extraUserBlock?: string;
}): Promise<PlanV2> {
  const engine = getEngine(args.engineMode);
  const system = buildSynthesizerSystem(args.memory, args.brain);
  const baseUser = buildSynthesizerUser({
    ticket: args.ticket,
    reposTouched: args.classification.repos_touched,
    targetBranch: args.classification.target_branch,
    dispatch: args.dispatch,
    outputs: args.outputs,
  });
  const user = args.extraUserBlock
    ? `${baseUser}\n\n${args.extraUserBlock}`
    : baseUser;

  let fullText = "";
  let lastError = "no attempts";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? user
        : `${user}\n\nPrevious attempt failed: ${lastError}\nEmit ONLY the plan JSON after </thinking>.`;
    fullText = "";
    for await (const ev of engine.run({
      prompt,
      system,
      cacheSystem: true,
      wrapThinking: true,
    })) {
      if (ev.type === "thinking")
        args.emit({ type: "synthesis-thinking", delta: ev.delta });
      else if (ev.type === "text") fullText += ev.delta;
      else if (ev.type === "done")
        accumulateUsage(args.usage, {
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cache_creation_input_tokens: ev.cache_creation_input_tokens,
          cache_read_input_tokens: ev.cache_read_input_tokens,
        });
      else if (ev.type === "error") lastError = ev.message;
    }
    try {
      return parseSynthesizedPlan(fullText);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`Synthesis failed: ${lastError}`);
}

// ========== Public: draft pipeline ==========

export async function* runDraftPipeline(input: {
  ticket_id: string;
}): AsyncIterable<PipelineEvent> {
  const startedAt = Date.now();
  const usage: Usage = {};
  const events: PipelineEvent[] = [];
  const emit = (ev: PipelineEvent) => {
    events.push(ev);
  };

  const ticket = await getTicket(input.ticket_id);
  if (!ticket) {
    yield { type: "error", message: `ticket ${input.ticket_id} not found` };
    return;
  }
  const projectId = ticket.projectId ?? (await getCurrentProjectId());
  const memory = projectId ? await loadMemory(projectId) : null;
  if (!memory) {
    yield { type: "error", message: "no memory — run /connect first" };
    return;
  }
  const allAgents = await loadAgents();
  // The multi-agent dispatch is wired to the four base agents. Custom user
  // agents from Settings are visible elsewhere but inert until the master
  // prompt and contribution shapes are taught to handle them.
  const agents = allAgents.filter((a) =>
    (["frontend", "backend", "product", "qa"] as readonly string[]).includes(a.id),
  );
  if (agents.length === 0) {
    yield {
      type: "error",
      message: "no agents defined — expected files in .claude/agents/",
    };
    return;
  }
  const config = await loadConfig();
  const brain = await loadBrainForPrompt();

  try {
    // --- 1. Classify ---
    const updated = await updateTicket(input.ticket_id, {
      drafting: {
        phase: "classifying",
        started_at: new Date().toISOString(),
      },
    });
    if (updated) yield { type: "ticket-update", ticket: updated };
    yield { type: "classify-start" };

    const ticketInput = buildTicketInput(ticket);
    const classification = await classifyTicket({
      ticket: ticketInput,
      memory,
      brain,
      engineMode: config.engineMode,
      emit,
      usage,
    });
    for (const ev of events.splice(0)) yield ev;
    yield { type: "classification", classification };

    // --- 2. Dispatch ---
    const phaseUpdate = await updateTicket(input.ticket_id, {
      drafting: {
        phase: "planning",
        started_at: new Date().toISOString(),
      },
    });
    if (phaseUpdate) yield { type: "ticket-update", ticket: phaseUpdate };

    const dispatch = await runDispatch({
      memory,
      agents,
      classification,
      ticket: ticketInput,
      brain,
      engineMode: config.engineMode,
      emit,
      usage,
    });
    for (const ev of events.splice(0)) yield ev;
    yield {
      type: "dispatch",
      agents_to_deploy: dispatch.agents_to_deploy,
      rationale: dispatch.rationale,
      instructions_per_agent: dispatch.instructions_per_agent,
    };

    // --- 3. Sub-agents in parallel ---
    const deployedAgents = agents.filter((a) =>
      (dispatch.agents_to_deploy as readonly string[]).includes(a.id),
    );
    const skillsContext = await buildSkillsContext({
      repos: classification.repos_touched,
    });

    // Emit agent-start synchronously so the UI can show columns.
    for (const a of deployedAgents) {
      yield { type: "agent-start", agent: a.id, role: a.frontmatter.role };
    }

    const outputs: AgentOutput[] = [];
    const pending = deployedAgents.map(async (agent) => {
      try {
        const output = await runSubAgent({
          agent,
          memory,
          skillsContext,
          ticket: ticketInput,
          classification,
          instructions: dispatch.instructions_per_agent[agent.id] ?? "",
          brain,
          engineMode: config.engineMode,
          emit,
          usage,
        });
        outputs.push(output);
        emit({ type: "agent-done", agent: agent.id, output });
      } catch (err) {
        emit({
          type: "agent-error",
          agent: agent.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Drain events while waiting. We poll until all promises settle.
    let settled = false;
    const allDone = Promise.allSettled(pending).then(() => {
      settled = true;
    });
    while (!settled) {
      await Promise.race([
        allDone,
        new Promise<void>((res) => setTimeout(res, 40)),
      ]);
      for (const ev of events.splice(0)) yield ev;
    }
    for (const ev of events.splice(0)) yield ev;

    if (outputs.length === 0) throw new Error("all sub-agents failed");

    // --- 4. Synthesis ---
    const synthUpdate = await updateTicket(input.ticket_id, {
      drafting: {
        phase: "synthesizing",
        started_at: new Date().toISOString(),
      },
    });
    if (synthUpdate) yield { type: "ticket-update", ticket: synthUpdate };
    yield { type: "synthesis-start" };

    const plan = await runSynthesis({
      memory,
      ticket: ticketInput,
      classification,
      dispatch,
      outputs,
      brain,
      engineMode: config.engineMode,
      emit,
      usage,
    });
    for (const ev of events.splice(0)) yield ev;

    plan.tests = plan.tests.map((s) => ({
      ...s,
      target_branch: classification.target_branch,
    }));
    plan.implementation = plan.implementation.map((s) => ({
      ...s,
      target_branch: classification.target_branch,
    }));
    PlanV2Schema.parse(plan);
    yield { type: "plan", plan };

    // --- 5. Persist plan + ticket ---
    const saved = await savePlan({
      ticket: ticketInput,
      classification,
      plan,
      ticket_id: input.ticket_id,
      agent_outputs: outputs,
      projectId: projectId ?? undefined,
    });
    const done = await updateTicket(input.ticket_id, {
      status: "drafted",
      plan_id: saved.id,
      drafting: undefined,
    });
    if (done) yield { type: "ticket-update", ticket: done };
    yield { type: "plan-saved", plan_id: saved.id, ticket_id: input.ticket_id };

    yield {
      type: "done",
      duration_ms: Date.now() - startedAt,
      engine_mode: config.engineMode,
      ...usage,
    };
  } catch (err) {
    // Revert drafting phase so the UI doesn't stay stuck.
    await updateTicket(input.ticket_id, { drafting: undefined }).catch(
      () => null,
    );
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ========== Public: adjust pipeline ==========

export async function* runAdjustPipeline(input: {
  ticket_id: string;
  instruction: string;
  quick_actions: string[];
}): AsyncIterable<PipelineEvent> {
  const startedAt = Date.now();
  const usage: Usage = {};
  const events: PipelineEvent[] = [];
  const emit = (ev: PipelineEvent) => {
    events.push(ev);
  };

  const ticket = await getTicket(input.ticket_id);
  if (!ticket) {
    yield { type: "error", message: `ticket ${input.ticket_id} not found` };
    return;
  }
  if (!ticket.plan_id) {
    yield { type: "error", message: "ticket has no plan to adjust" };
    return;
  }
  const base = await getPlan(ticket.plan_id);
  if (!base) {
    yield { type: "error", message: `plan ${ticket.plan_id} missing` };
    return;
  }
  const projectId = ticket.projectId ?? base.projectId ?? (await getCurrentProjectId());
  const memory = projectId ? await loadMemory(projectId) : null;
  if (!memory) {
    yield { type: "error", message: "no memory — run /connect first" };
    return;
  }
  const config = await loadConfig();
  const brain = await loadBrainForPrompt();

  try {
    const phaseUpdate = await updateTicket(input.ticket_id, {
      drafting: {
        phase: "synthesizing",
        started_at: new Date().toISOString(),
      },
    });
    if (phaseUpdate) yield { type: "ticket-update", ticket: phaseUpdate };

    yield { type: "synthesis-start" };

    const dispatch: DispatchPayload = {
      agents_to_deploy: (base.agent_outputs ?? []).map(
        (o) => o.agent,
      ) as DispatchPayload["agents_to_deploy"],
      rationale:
        "Adjusting a previous plan. Re-using the agents that produced the base plan.",
      instructions_per_agent: {},
    };

    const extra = buildAdjustBlock({
      previousPlan: base.plan,
      instruction: input.instruction,
      quickActions: input.quick_actions,
    });

    const plan = await runSynthesis({
      memory,
      ticket: base.ticket,
      classification: base.classification as Classification,
      dispatch,
      outputs: base.agent_outputs ?? [],
      brain,
      engineMode: config.engineMode,
      emit,
      usage,
      extraUserBlock: extra,
    });
    for (const ev of events.splice(0)) yield ev;

    plan.tests = plan.tests.map((s) => ({
      ...s,
      target_branch: base.classification.target_branch,
    }));
    plan.implementation = plan.implementation.map((s) => ({
      ...s,
      target_branch: base.classification.target_branch,
    }));
    PlanV2Schema.parse(plan);
    yield { type: "plan", plan };

    const saved = await savePlan({
      ticket: base.ticket,
      classification: base.classification,
      plan,
      ticket_id: input.ticket_id,
      base_plan_id: base.id,
      agent_outputs: base.agent_outputs,
      projectId: projectId ?? undefined,
    });

    const done = await updateTicket(input.ticket_id, {
      status: "drafted",
      plan_id: saved.id,
      drafting: undefined,
      adjustments: [
        ...ticket.adjustments,
        {
          at: new Date().toISOString(),
          instruction: buildAdjustSummary(
            input.instruction,
            input.quick_actions,
          ),
          previous_plan_id: base.id,
        },
      ],
    });
    if (done) yield { type: "ticket-update", ticket: done };
    yield { type: "plan-saved", plan_id: saved.id, ticket_id: input.ticket_id };

    yield {
      type: "done",
      duration_ms: Date.now() - startedAt,
      engine_mode: config.engineMode,
      ...usage,
    };
  } catch (err) {
    await updateTicket(input.ticket_id, { drafting: undefined }).catch(
      () => null,
    );
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildAdjustBlock(args: {
  previousPlan: PlanPayload | PlanV2;
  instruction: string;
  quickActions: string[];
}): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("ADJUSTMENT CONTEXT — the user has reviewed the previous plan.");
  lines.push("Your job is to revise it. Keep what works, change what they ask.");
  lines.push("");
  lines.push("PREVIOUS PLAN (you produced this earlier):");
  lines.push("```json");
  lines.push(JSON.stringify(args.previousPlan, null, 2));
  lines.push("```");
  lines.push("");
  if (args.quickActions.length > 0) {
    lines.push("QUICK ACTIONS THE USER SELECTED:");
    for (const a of args.quickActions) lines.push(`- ${a}`);
    lines.push("");
  }
  if (args.instruction.trim()) {
    lines.push("USER INSTRUCTION:");
    lines.push(args.instruction.trim());
    lines.push("");
  }
  lines.push(
    "Produce the revised plan JSON after </thinking>, respecting the same schema.",
  );
  return lines.join("\n");
}

function buildAdjustSummary(instruction: string, quickActions: string[]): string {
  const parts: string[] = [];
  if (quickActions.length > 0) parts.push(quickActions.join(" · "));
  if (instruction.trim()) parts.push(instruction.trim());
  return parts.join(" — ") || "manual adjustment";
}

// Shared: wraps a pipeline iterator as an SSE ReadableStream.
//
// The pipeline runs eagerly in the background — if the client disconnects,
// the generator still drains to completion so ticket state (status, plan_id)
// lands on disk correctly. The SSE stream only tails the events while alive.
export function pipelineToSSE(
  iter: AsyncIterable<PipelineEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let clientGone = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (bytes: Uint8Array) => {
        if (clientGone) return;
        try {
          controller.enqueue(bytes);
        } catch {
          clientGone = true;
        }
      };
      try {
        for await (const ev of iter) {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
      } catch (err) {
        safeEnqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            })}\n\n`,
          ),
        );
      } finally {
        try {
          controller.close();
        } catch {
          // ignore double close
        }
      }
    },
    cancel() {
      // Client disconnected. Do NOT abort the generator — it must finish so
      // the ticket state on disk is consistent. Just stop enqueuing.
      clientGone = true;
    },
  });
}

export type { SavedPlan };
