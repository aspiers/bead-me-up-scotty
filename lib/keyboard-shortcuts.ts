import type { View } from "@/components/app-context";

/**
 * Where a shortcut works, widest first: on every page, also on pages listing
 * beads (the all-projects Needs You inbox), or only inside a project.
 */
export type ShortcutScope = "app" | "beads" | "project";
const SCOPE_RANK: Record<ShortcutScope, number> = { app: 0, beads: 1, project: 2 };

export interface KeyboardShortcut {
  keys: string[];
  label: string;
  sequence?: boolean;
  /** Defaults to "app". */
  scope?: ShortcutScope;
}

export interface KeyboardShortcutGroup {
  topic: string;
  shortcuts: KeyboardShortcut[];
}

/** Cmd/Ctrl+Enter submits the focused text field, as its submit button would. */
export function isSubmitKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">) {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey);
}

export const VIEW_KEY_BINDINGS: Record<string, View> = {
  f: "focus",
  b: "board",
  l: "list",
  e: "epics",
  g: "graph",
  i: "insights",
  a: "activity",
  y: "needsyou",
  h: "achievements",
  p: "publish",
  s: "settings",
};

export const KEYBOARD_SHORTCUT_GROUPS: KeyboardShortcutGroup[] = [
  {
    topic: "Global",
    shortcuts: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["⌘/Ctrl", "K"], label: "Open the command palette" },
      { keys: ["/"], label: "Focus search", scope: "project" },
      { keys: ["⌘/Ctrl", "Enter"], label: "Submit the focused text field" },
      { keys: ["N"], label: "Create an issue", scope: "project" },
      { keys: ["T"], label: "Toggle light / dark theme" },
      { keys: ["Esc"], label: "Close the active drawer or dialog" },
    ],
  },
  {
    topic: "Issues",
    shortcuts: [
      { keys: ["J"], label: "Select next visible issue", scope: "beads" },
      { keys: ["K"], label: "Select previous visible issue", scope: "beads" },
      { keys: ["H"], label: "Select issue to the left", scope: "project" },
      { keys: ["L"], label: "Select issue to the right", scope: "project" },
      { keys: ["Enter"], label: "Open selected issue", scope: "beads" },
      { keys: ["O"], label: "Open selected issue", scope: "beads" },
      { keys: ["E"], label: "Edit selected issue", scope: "beads" },
      { keys: ["C"], label: "Close selected issue with optional reason", scope: "beads" },
      { keys: ["S"], label: "Set selected issue status", scope: "beads" },
      { keys: ["P"], label: "Set selected issue priority", scope: "beads" },
      { keys: ["Y"], label: "Copy selected issue ID", scope: "beads" },
    ],
  },
  {
    topic: "Views",
    shortcuts: [
      { keys: ["G", "F"], label: "Focus", sequence: true, scope: "project" },
      { keys: ["G", "B"], label: "Board", sequence: true, scope: "project" },
      { keys: ["G", "L"], label: "List", sequence: true, scope: "project" },
      { keys: ["G", "E"], label: "Epics", sequence: true, scope: "project" },
      { keys: ["G", "G"], label: "Graph", sequence: true, scope: "project" },
      { keys: ["G", "I"], label: "Insights", sequence: true, scope: "project" },
      { keys: ["G", "A"], label: "Activity", sequence: true, scope: "project" },
      { keys: ["G", "Y"], label: "Needs You", sequence: true },
      { keys: ["G", "U"], label: "Needs You (all projects)", sequence: true },
      { keys: ["G", "H"], label: "Achievements", sequence: true, scope: "project" },
      { keys: ["G", "P"], label: "Publish", sequence: true, scope: "project" },
      { keys: ["G", "S"], label: "Settings", sequence: true },
    ],
  },
  {
    topic: "Repositories",
    shortcuts: [
      { keys: ["G", "R"], label: "Choose a repository", sequence: true },
      { keys: ["G", "["], label: "Previous repository", sequence: true },
      { keys: ["G", "]"], label: "Next repository", sequence: true },
    ],
  },
];

/** The groups and shortcuts that work on a page of the given scope. */
export function shortcutGroupsFor(scope: ShortcutScope): KeyboardShortcutGroup[] {
  return KEYBOARD_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.filter((shortcut) => SCOPE_RANK[shortcut.scope ?? "app"] <= SCOPE_RANK[scope]),
  })).filter((group) => group.shortcuts.length > 0);
}

// Looks up by label (and optionally first key) so other surfaces, such as the
// command palette, stay in sync with the help dialog instead of restating keys.
export function findShortcut(topic: string, label: string, firstKey?: string): KeyboardShortcut | undefined {
  return KEYBOARD_SHORTCUT_GROUPS.find((group) => group.topic === topic)?.shortcuts.find(
    (shortcut) => shortcut.label === label && (firstKey === undefined || shortcut.keys[0] === firstKey),
  );
}
