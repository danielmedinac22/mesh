// Client-safe constants shared by the engine (server) and UI (client).
// Do NOT import server-only modules from this file.

export const DEFAULT_MODEL = "claude-opus-4-7";
export const DEFAULT_EFFORT = "high" as const;

export type Effort = typeof DEFAULT_EFFORT | "low" | "medium";

// Human-friendly label for the status panel.
export const MODEL_LABEL = "Opus 4.7";
