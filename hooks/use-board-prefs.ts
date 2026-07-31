"use client";
import * as React from "react";
import type { BoardSortMode } from "@/lib/board-columns";

/**
 * Per-device board display preferences (localStorage, not server config — they're
 * a viewing choice, like theme/notifications). This includes column visibility
 * and the active board sort mode.
 */

const PREFS_KEY = "bmus.board";

export type BlockedColumnMode = "auto" | "always";
export interface BoardPrefs {
  blockedColumn: BlockedColumnMode;
  /** How cards are ordered within each board column. */
  sortMode: BoardSortMode;
  /** Check GitHub for a newer app version and show the update indicator (bead bgb). */
  checkUpdates: boolean;
}
const DEFAULTS: BoardPrefs = {
  blockedColumn: "auto",
  sortMode: "priority",
  checkUpdates: true,
};

export function loadBoardPrefs(): BoardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<BoardPrefs>) };
  } catch {
    return DEFAULTS;
  }
}
function saveBoardPrefs(p: BoardPrefs) {
  if (typeof window !== "undefined") localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

/**
 * Lazy-initializes from localStorage during render (no setState-in-effect). This
 * is hydration-safe: the Board only renders its columns after client-side beads
 * data loads — the SSR/first-paint output is the "Loading…" state with no columns
 * — so the persisted value never diverges from the server HTML at hydration.
 */
export function useBoardPrefs() {
  const [prefs, setPrefsState] = React.useState<BoardPrefs>(() => loadBoardPrefs());
  const setPrefs = React.useCallback((p: BoardPrefs) => {
    setPrefsState(p);
    saveBoardPrefs(p);
  }, []);
  return { prefs, setPrefs };
}
