"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "mesh:session:usage";
const CONTEXT_LIMIT = 1_000_000;

export type UsageDone = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type LastTurn = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  at: string;
};

type UsageState = {
  lastTurn: LastTurn | null;
  prevUsed: number | null;
  cumulativeOutput: number;
  compactedAt: string | null;
};

export type PressureState = "idle" | "ok" | "warn" | "critical";

type UsageContextValue = {
  lastTurn: LastTurn | null;
  used: number;
  total: number;
  delta: number | null;
  state: PressureState;
  compactedAt: string | null;
  recordUsage: (done: UsageDone) => void;
  reset: (opts?: { compacted?: boolean }) => void;
};

const UsageCtx = createContext<UsageContextValue | null>(null);

function defaultState(): UsageState {
  return { lastTurn: null, prevUsed: null, cumulativeOutput: 0, compactedAt: null };
}

function loadState(): UsageState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<UsageState>;
    return {
      lastTurn: parsed.lastTurn ?? null,
      prevUsed: parsed.prevUsed ?? null,
      cumulativeOutput: parsed.cumulativeOutput ?? 0,
      compactedAt: parsed.compactedAt ?? null,
    };
  } catch {
    return defaultState();
  }
}

function pressureOf(used: number, total: number): PressureState {
  if (used <= 0) return "idle";
  const pct = used / total;
  if (pct < 0.5) return "ok";
  if (pct < 0.8) return "warn";
  return "critical";
}

function usedFromTurn(t: LastTurn | null): number {
  if (!t) return 0;
  return t.input + t.cacheRead + t.cacheCreate;
}

export function UsageProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UsageState>(defaultState);

  useEffect(() => {
    setState(loadState());
  }, []);

  const persist = useCallback((next: UsageState) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable — state still lives in memory
    }
  }, []);

  const recordUsage = useCallback(
    (done: UsageDone) => {
      const input = done.input_tokens ?? 0;
      const cacheRead = done.cache_read_input_tokens ?? 0;
      const cacheCreate = done.cache_creation_input_tokens ?? 0;
      const output = done.output_tokens ?? 0;
      if (input + cacheRead + cacheCreate + output === 0) return;

      setState((prev) => {
        const next: UsageState = {
          lastTurn: {
            input,
            output,
            cacheRead,
            cacheCreate,
            at: new Date().toISOString(),
          },
          prevUsed: usedFromTurn(prev.lastTurn),
          cumulativeOutput: prev.cumulativeOutput + output,
          compactedAt: prev.compactedAt,
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(
    (opts?: { compacted?: boolean }) => {
      setState((prev) => {
        const next: UsageState = {
          lastTurn: null,
          prevUsed: opts?.compacted ? usedFromTurn(prev.lastTurn) : null,
          cumulativeOutput: 0,
          compactedAt: opts?.compacted ? new Date().toISOString() : null,
        };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const value = useMemo<UsageContextValue>(() => {
    const used = usedFromTurn(state.lastTurn);
    const delta =
      state.prevUsed !== null && state.lastTurn ? used - state.prevUsed : null;
    return {
      lastTurn: state.lastTurn,
      used,
      total: CONTEXT_LIMIT,
      delta,
      state: pressureOf(used, CONTEXT_LIMIT),
      compactedAt: state.compactedAt,
      recordUsage,
      reset,
    };
  }, [state, recordUsage, reset]);

  return <UsageCtx.Provider value={value}>{children}</UsageCtx.Provider>;
}

export function useSessionUsage(): UsageContextValue {
  const ctx = useContext(UsageCtx);
  if (!ctx) {
    return {
      lastTurn: null,
      used: 0,
      total: CONTEXT_LIMIT,
      delta: null,
      state: "idle",
      compactedAt: null,
      recordUsage: () => {},
      reset: () => {},
    };
  }
  return ctx;
}

export function useUsageRecorder() {
  return useSessionUsage().recordUsage;
}
