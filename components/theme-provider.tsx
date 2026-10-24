"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import {
  getTheme,
  parseThemePrefs,
  type ModePreference,
  type ThemeDef,
  type ThemeMode,
  type ThemePrefs,
} from "@/lib/themes";

/**
 * Per-project theme (bead-me-up-scotty-81k). The chosen theme is stored per-device
 * in localStorage, keyed by the active project so different projects look different
 * and don't get confused. Project identity comes from the /p/<projectId> URL; the
 * launcher (no project) uses a shared key. The value is JSON ThemePrefs: a light
 * theme, a dark theme, and a Light/Dark/System mode choosing between them.
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

function serverSnapshot(): string | null {
  return null;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(callback: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** The quick toggle cycles the mode: Light -> Dark -> System -> Light. */
const MODE_NEXT: Record<ModePreference, ModePreference> = { light: "dark", dark: "system", system: "light" };
export const MODE_ICON: Record<ModePreference, string> = { light: "sun", dark: "moon", system: "monitor" };

/** The theme to apply: the chosen theme for the fixed mode, or for the OS scheme in System mode. */
function resolve(prefs: ThemePrefs, systemDark: boolean): ThemeDef {
  const mode = prefs.mode === "system" ? (systemDark ? "dark" : "light") : prefs.mode;
  return getTheme(prefs[mode]);
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

/** Reads the saved value for a project, falling back to the legacy key. */
function readSaved(projectId: string | null): string | null {
  try {
    const store = getStore();
    return store ? (store.getItem(storageKey(projectId)) ?? store.getItem(LEGACY_KEY)) : null;
  } catch {
    return null;
  }
}

interface ThemeContextValue {
  /** The applied theme, with System already resolved. */
  theme: ThemeDef;
  /** The applied light/dark mode. */
  mode: ThemeMode;
  prefs: ThemePrefs;
  /** The mode `toggle` switches to. */
  next: ModePreference;
  /** Makes `id` the theme for its mode, and shows it unless in System mode. */
  setTheme: (id: string) => void;
  setMode: (mode: ModePreference) => void;
  toggle: () => void;
}

// Plain-literal default (no module-load-time function call — keeps the bundler's
// scope-hoisting from tripping a TDZ during SSR). Only used if a consumer renders
// with no provider mounted, which doesn't happen in practice.
const ThemeContext = React.createContext<ThemeContextValue>({
  theme: { id: "light", name: "Light", mode: "light", swatch: ["#f6f6f8", "#ffffff", "#6d5ef0"] },
  mode: "light",
  prefs: { mode: "light", light: "light", dark: "dark" },
  next: "dark",
  setTheme: () => {},
  setMode: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname);

  // Hydration must match the server's light snapshot before reading browser
  // preferences. React then applies the saved project theme and subscribes to changes.
  // The raw string is the snapshot because it compares stably; parse it per render.
  const saved = React.useSyncExternalStore(subscribe, () => readSaved(projectId), serverSnapshot);
  const systemDark = React.useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  const prefs = parseThemePrefs(saved);
  const theme = resolve(prefs, systemDark);

  // Apply to <html>: data-theme drives the palette; .dark drives Tailwind/shadcn.
  // Reads live values rather than the snapshots: during hydration those are the
  // server's defaults, which would undo the pre-paint script in app/layout.tsx.
  React.useEffect(() => {
    const live = resolve(parseThemePrefs(readSaved(projectId)), window.matchMedia(DARK_QUERY).matches);
    document.documentElement.dataset.theme = live.id;
    document.documentElement.classList.toggle("dark", live.mode === "dark");
  }, [projectId, saved, systemDark]);

  // Plain handlers (no manual memoization — React Compiler handles it, and the
  // provider updates from the external store). Notify this tab after saving;
  // the native storage event handles other tabs.
  function save(change: Partial<ThemePrefs>) {
    const current = parseThemePrefs(readSaved(projectId));
    getStore()?.setItem(storageKey(projectId), JSON.stringify({ ...current, ...change }));
    window.dispatchEvent(new Event(THEME_EVENT));
  }
  function setTheme(id: string) {
    const picked = getTheme(id);
    const { mode } = parseThemePrefs(readSaved(projectId));
    save({ [picked.mode]: picked.id, mode: mode === "system" ? mode : picked.mode });
  }
  function setMode(mode: ModePreference) {
    save({ mode });
  }
  // Quick switch (sidebar button, T shortcut, launcher, palette).
  function toggle() {
    setMode(MODE_NEXT[parseThemePrefs(readSaved(projectId)).mode]);
  }

  return (
    <ThemeContext.Provider
      value={{ theme, mode: theme.mode, prefs, next: MODE_NEXT[prefs.mode], setTheme, setMode, toggle }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => React.useContext(ThemeContext);
