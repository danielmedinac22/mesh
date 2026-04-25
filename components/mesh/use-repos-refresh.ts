"use client";

import { useEffect } from "react";

export const REPOS_CHANGED_EVENT = "mesh:repos-changed";

export function emitReposChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REPOS_CHANGED_EVENT));
}

export function useReposRefresh(reload: () => void) {
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener(REPOS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(REPOS_CHANGED_EVENT, handler);
  }, [reload]);
}
