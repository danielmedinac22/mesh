"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CinemaPhase, CinemaMode } from "./cinema-thinking";

type AgentId = string;

type DraftEvent =
  | { type: "ticket-update"; ticket?: { title?: string } }
  | { type: "classify-start" }
  | { type: "classify-thinking"; delta: string }
  | { type: "classification" }
  | { type: "thinking"; delta: string }
  | {
      type: "dispatch";
      agents_to_deploy?: AgentId[];
      rationale?: string;
      instructions_per_agent?: Record<AgentId, string>;
    }
  | { type: "agent-start"; agent: AgentId; role: string }
  | { type: "agent-thinking"; agent: AgentId; delta: string }
  | { type: "agent-done"; agent: AgentId }
  | { type: "synthesis-start" }
  | { type: "synthesis-thinking"; delta: string }
  | { type: "plan" }
  | { type: "plan-saved" }
  | { type: "done"; duration_ms?: number }
  | { type: "error"; message: string };

export type DispatchSummary = {
  agents: AgentId[];
  rationale: string;
  instructionsPerAgent: Record<AgentId, string>;
};

const BASE_PHASES: CinemaPhase[] = [
  { id: "classify", label: "Classify", tone: "amber" },
  { id: "dispatch", label: "Dispatch", tone: "amber" },
  { id: "agents", label: "Agents", tone: "signal" },
  { id: "synthesis", label: "Synthesize", tone: "signal" },
  { id: "plan", label: "Plan", tone: "green" },
];

export type DraftCinemaState = {
  ticketId: string | null;
  ticketTitle: string | null;
  text: string;
  phase: CinemaPhase | null;
  phases: CinemaPhase[];
  active: boolean;
  tokens: number;
  mode: CinemaMode;
  error: string | null;
  doneAt: number | null;
  agentsActive: Set<AgentId>;
  dispatchSummary: DispatchSummary | null;
};

export type DraftCinema = DraftCinemaState & {
  start: (ticketId: string, ticketTitle?: string) => void;
  setMode: (mode: CinemaMode) => void;
  dismiss: () => void;
};

const initial: DraftCinemaState = {
  ticketId: null,
  ticketTitle: null,
  text: "",
  phase: null,
  phases: BASE_PHASES,
  active: false,
  tokens: 0,
  mode: "off",
  error: null,
  doneAt: null,
  agentsActive: new Set(),
  dispatchSummary: null,
};

export function useDraftCinema(): DraftCinema {
  const [state, setState] = useState<DraftCinemaState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const setMode = useCallback((mode: CinemaMode) => {
    setState((s) => ({ ...s, mode }));
  }, []);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ ...initial });
  }, []);

  const start = useCallback((ticketId: string, ticketTitle?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...initial,
      ticketId,
      ticketTitle: ticketTitle ?? null,
      mode: "cinema",
      active: true,
      phase: BASE_PHASES[0],
      phases: BASE_PHASES,
    });

    void streamDraft(ticketId, controller.signal, (ev) => {
      setState((prev) => apply(prev, ev));
    }).catch(() => {
      setState((prev) => ({ ...prev, active: false }));
    });
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { ...state, start, setMode, dismiss };
}

function apply(state: DraftCinemaState, ev: DraftEvent): DraftCinemaState {
  switch (ev.type) {
    case "ticket-update":
      if (ev.ticket?.title && !state.ticketTitle) {
        return { ...state, ticketTitle: ev.ticket.title };
      }
      return state;
    case "classify-start":
      return {
        ...state,
        phase: state.phases.find((p) => p.id === "classify") ?? state.phase,
        text: appendHeading(state.text, "Classifying ticket"),
      };
    case "classify-thinking":
      return {
        ...state,
        text: state.text + ev.delta,
        tokens: state.tokens + ev.delta.length,
      };
    case "classification":
      return {
        ...state,
        text: appendBlock(state.text, "[classification complete]"),
      };
    case "thinking":
      // High-level dispatch reasoning
      return {
        ...state,
        phase: state.phases.find((p) => p.id === "dispatch") ?? state.phase,
        text: state.text + ev.delta,
        tokens: state.tokens + ev.delta.length,
      };
    case "dispatch": {
      const agents = ev.agents_to_deploy ?? [];
      const agentList = agents.join(", ");
      return {
        ...state,
        dispatchSummary: {
          agents,
          rationale: ev.rationale ?? "",
          instructionsPerAgent: ev.instructions_per_agent ?? {},
        },
        text: appendBlock(
          state.text,
          `[dispatching ${agents.length} agents${agentList ? ` · ${agentList}` : ""}]`,
        ),
      };
    }
    case "agent-start": {
      const next = new Set(state.agentsActive);
      next.add(ev.agent);
      return {
        ...state,
        phase: state.phases.find((p) => p.id === "agents") ?? state.phase,
        agentsActive: next,
        text: appendHeading(state.text, `Agent · ${ev.agent} (${ev.role})`),
      };
    }
    case "agent-thinking":
      return {
        ...state,
        text: state.text + ev.delta,
        tokens: state.tokens + ev.delta.length,
      };
    case "agent-done": {
      const next = new Set(state.agentsActive);
      next.delete(ev.agent);
      return {
        ...state,
        agentsActive: next,
        text: appendBlock(state.text, `[agent ${ev.agent} complete]`),
      };
    }
    case "synthesis-start":
      return {
        ...state,
        phase: state.phases.find((p) => p.id === "synthesis") ?? state.phase,
        text: appendHeading(state.text, "Synthesizing plan"),
      };
    case "synthesis-thinking":
      return {
        ...state,
        text: state.text + ev.delta,
        tokens: state.tokens + ev.delta.length,
      };
    case "plan":
      return {
        ...state,
        phase: state.phases.find((p) => p.id === "plan") ?? state.phase,
        text: appendBlock(state.text, "[plan generated]"),
      };
    case "plan-saved":
      return {
        ...state,
        text: appendBlock(state.text, "[plan saved · ready to ship]"),
      };
    case "done":
      return {
        ...state,
        active: false,
        doneAt: Date.now(),
        text: appendBlock(
          state.text,
          ev.duration_ms ? `[done · ${(ev.duration_ms / 1000).toFixed(1)}s]` : "[done]",
        ),
      };
    case "error":
      return {
        ...state,
        active: false,
        error: ev.message,
        text: appendBlock(state.text, `[error: ${ev.message}]`),
      };
    default:
      return state;
  }
}

function appendHeading(text: string, heading: string): string {
  if (!text) return `${heading}\n\n`;
  return `${text.replace(/\n*$/, "")}\n\n${heading}\n\n`;
}

function appendBlock(text: string, marker: string): string {
  return `${text.replace(/\s*$/, "")}\n\n${marker}\n\n`;
}

async function streamDraft(
  ticketId: string,
  signal: AbortSignal,
  onEvent: (ev: DraftEvent) => void,
): Promise<void> {
  const res = await fetch(
    `/api/build/tickets/${encodeURIComponent(ticketId)}/draft`,
    { method: "POST", signal },
  );
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `HTTP ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Parse SSE: "data: {...}\n\n" frames
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = frame.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as DraftEvent);
        } catch {
          // ignore parse failures
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
}
