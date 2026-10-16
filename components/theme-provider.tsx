"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { getTheme, type ThemeDef, type ThemeMode } from "@/lib/themes";

/**
 * Per-project theme (bead-me-up-scotty-81k). The chosen theme is stored per-device
 * in localStorage, keyed by the active project so different projects look different
 * and don't get confused. Project identity comes from the /p/<projectId> URL; the
 * launcher (no project) uses a shared key.
 */
const LEGACY_KEY = "bmus-theme";
const THEME_EVENT = "bmus:theme";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function serverSnapshot(): string {
  return "light";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(callback: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** What the quick toggle switches to next: Light -> Dark -> System -> Light. */
type ToggleTarget = "light" | "dark" | "system";
const TOGGLE_NEXT: Partial<Record<string, ToggleTarget>> = { light: "dark", dark: "system" };
export const TOGGLE_ICON: Record<ToggleTarget, string> = { light: "sun", dark: "moon", system: "monitor" };

/** The palette and mode to apply: System borrows Light or Dark, every other theme is itself. */
function resolve(themeId: string, systemDark: boolean): { id: string; mode: ThemeMode } {
  const theme = getTheme(themeId);
  if (theme.mode !== "system") return { id: theme.id, mode: theme.mode };
  const mode = systemDark ? "dark" : "light";
  return { id: mode, mode };
}

function storageKey(projectId: string | null): string {
  return projectId ? `bmus.theme.${projectId}` : "bmus.theme";
}

/**
 * localStorage when in a browser, else undefined. Reached via `globalThis` on
 * purpose: a `typeof window === "undefined"` guard gets constant-folded to `true`
 * in the server bundle, which dead-code-eliminates the project-keyed read and
 * leaves the minifier emitting a temp before its declaration (TDZ during SSR).
 *
 * Node >= 22 exposes a `globalThis.localStorage` stub during SSR that lacks the
 * Storage methods unless the process was started with `--localstorage-file`
 * (calling `getItem` on it throws "is not a function"), so the object is only
 * usable if it actually implements Storage. Both methods are checked, not just
 * `getItem`: the read path and the two `setItem` writers share this one guard,
 * so a partial stub would still throw on save.
 */
function getStore(): Storage | undefined {
  const store = (globalThis as { localStorage?: Storage }).localStorage;
  return typeof store?.getItem === "function" && typeof store.setItem === "function"
    ? store
    : undefined;
}

function projectIdFromPath(pathname: string | null): string | null {
  const m = pathname?.match(/^\/p\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Reads the saved theme id for a project, falling back to the legacy key, then default. */
function readThemeId(projectId: string | null): string {
  try {
    const store = getStore();
    const stored = store
      ? (store.getItem(storageKey(projectId)) ?? store.getItem(LEGACY_KEY))
      : null;
    return getTheme(stored).id;
  } catch {
    return "light";
  }
}

interface ThemeContextValue {
  theme: ThemeDef;
  /** The applied light/dark mode, with System already resolved. */
  mode: ThemeMode;
  /** The theme `toggle` switches to. */
  next: ToggleTarget;
  setTheme: (id: string) => void;
  toggle: () => void;
}

// Plain-literal default (no module-load-time function call — keeps the bundler's
// scope-hoisting from tripping a TDZ during SSR). Only used if a consumer renders
// with no provider mounted, which doesn't happen in practice.
const ThemeContext = React.createContext<ThemeContextValue>({
  theme: { id: "light", name: "Light", mode: "light", swatch: ["#f6f6f8", "#ffffff", "#6d5ef0"] },
  mode: "light",
  next: "dark",
  setTheme: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname);

  // Hydration must match the server's light snapshot before reading browser
  // preferences. React then applies the saved project theme and subscribes to changes.
  const themeId = React.useSyncExternalStore(
    subscribe,
    () => readThemeId(projectId),
    serverSnapshot,
  );
  const systemDark = React.useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const theme = getTheme(themeId);
  const { mode } = resolve(themeId, systemDark);

  // Apply to <html>: data-theme drives the palette; .dark drives Tailwind/shadcn.
  // Reads live values rather than the snapshots: during hydration those are the
  // server's "light", which would undo the pre-paint script in app/layout.tsx.
  React.useEffect(() => {
    const live = resolve(readThemeId(projectId), window.matchMedia(DARK_QUERY).matches);
    document.documentElement.dataset.theme = live.id;
    document.documentElement.classList.toggle("dark", live.mode === "dark");
  }, [projectId, themeId, systemDark]);

  // Plain handlers (no manual memoization — React Compiler handles it, and the
  // provider updates from the external store). Notify this tab after saving;
  // the native storage event handles other tabs.
  function setTheme(id: string) {
    getStore()?.setItem(storageKey(projectId), getTheme(id).id);
    window.dispatchEvent(new Event(THEME_EVENT));
  }
  // Quick switch (sidebar button, T shortcut, launcher). Named palettes go to Light.
  function toggle() {
    setTheme(TOGGLE_NEXT[readThemeId(projectId)] ?? "light");
  }

  return (
    <ThemeContext.Provider value={{ theme, mode, next: TOGGLE_NEXT[themeId] ?? "light", setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => React.useContext(ThemeContext);
