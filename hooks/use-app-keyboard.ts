"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { View, DetailAction } from "@/components/app-context";
import { copyBeadId } from "@/components/copyable-id";
import { GLOBAL_VIEW_HREF } from "@/components/sidebar";
import { useProjects } from "@/hooks/use-projects";
import { VIEW_KEY_BINDINGS } from "@/lib/keyboard-shortcuts";

const ITEM_SELECTOR = "[data-keyboard-bead-id]";
const CHORD_TIMEOUT_MS = 900;

type PalettePage = "root" | "status" | "priority" | "projects";

interface KeyboardActions {
  /** Null outside a project, where project-only keys do nothing. */
  projectId: string | null;
  readOnly: boolean;
  selectedId: string | null;
  openId: string | null;
  selectId: (id: string | null) => void;
  setView: (view: View) => void;
  openDetail: (id: string, action?: DetailAction) => void;
  openCreate: () => void;
  openPalette: (page?: PalettePage, beadId?: string) => void;
  openHelp: () => void;
  closeOverlays: () => void;
  toggleTheme: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

function isNativeControlActivation(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (key !== "Enter" && key !== " ") return false;
  return !!target.closest("button, a, input, textarea, select") && !target.matches(ITEM_SELECTOR);
}

// A docked drawer sits beside the main view rather than over it, so it only
// blocks shortcuts while focus is inside it. y copies the drawer's bead, so
// with ignoreBeadDrawer the bead drawer alone never blocks it.
function hasOpenOverlay(target: EventTarget | null, ignoreBeadDrawer = false): boolean {
  const own = (el: Element) => ignoreBeadDrawer && el.hasAttribute("data-bead-drawer");
  if (target instanceof HTMLElement) {
    const docked = target.closest("[data-docked]");
    if (docked && !own(docked)) return true;
  }
  return Array.from(
    document.querySelectorAll(
      '[data-slot="dialog-content"], [data-slot="sheet-content"]:not([data-docked]), [data-slot="dropdown-menu-content"], [data-slot="select-content"]',
    ),
  ).some((overlay) => !own(overlay));
}

function visibleItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  });
}

function itemId(element: HTMLElement): string | null {
  return element.dataset.keyboardBeadId ?? null;
}

function focusItem(element: HTMLElement, selectId: (id: string | null) => void) {
  const id = itemId(element);
  if (!id) return;
  selectId(id);
  element.focus({ preventScroll: true });
  element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function moveLinear(direction: 1 | -1, selectedId: string | null, selectId: KeyboardActions["selectId"]) {
  const items = visibleItems();
  if (items.length === 0) return;
  const focused = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
  const current = focused !== -1 ? focused : items.findIndex((element) => itemId(element) === selectedId);
  const next = current === -1 ? (direction === 1 ? 0 : items.length - 1) : current + direction;
  focusItem(items[Math.max(0, Math.min(items.length - 1, next))], selectId);
}

function moveHorizontal(direction: 1 | -1, selectedId: string | null, selectId: KeyboardActions["selectId"]) {
  const items = visibleItems();
  if (items.length === 0) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const current = (focused && items.includes(focused) ? focused : null) ??
    items.find((element) => itemId(element) === selectedId) ??
    items[0];
  const rect = current.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const candidates = items
    .filter((element) => element !== current)
    .map((element) => {
      const candidate = element.getBoundingClientRect();
      const dx = candidate.left + candidate.width / 2 - x;
      const dy = candidate.top + candidate.height / 2 - y;
      return { element, dx, score: Math.abs(dx) + Math.abs(dy) * 2 };
    })
    .filter(({ dx }) => (direction === 1 ? dx > 8 : dx < -8))
    .sort((a, b) => a.score - b.score);
  if (candidates[0]) focusItem(candidates[0].element, selectId);
}

function selectedOrFirst(selectedId: string | null, selectId: KeyboardActions["selectId"]): string | null {
  const items = visibleItems();
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selected = (focused && items.includes(focused) ? focused : null) ??
    items.find((element) => itemId(element) === selectedId) ??
    items[0];
  if (!selected) return null;
  const id = itemId(selected);
  if (id !== selectedId) focusItem(selected, selectId);
  return id;
}

function runChord(
  key: string,
  actions: KeyboardActions,
  cycleProject: (direction: 1 | -1) => void,
  router: { push: (href: string) => void },
): boolean {
  const view = VIEW_KEY_BINDINGS[key];
  if (view) {
    // Outside a project only the views with an app-wide page go anywhere; the
    // rest are still swallowed so their second key can't act as a shortcut.
    if (actions.projectId === null) {
      const href = GLOBAL_VIEW_HREF[view];
      if (href) router.push(href);
      return true;
    }
    actions.selectId(null);
    actions.setView(view);
    return true;
  }
  if (key === "r") {
    actions.openPalette("projects");
    return true;
  }
  if (key === "u") {
    router.push("/needs-you");
    return true;
  }
  if (key === "[" || key === "]") {
    cycleProject(key === "]" ? 1 : -1);
    return true;
  }
  return false;
}

function runGlobalShortcut(key: string, actions: KeyboardActions): boolean {
  if (key === "?") actions.openHelp();
  else if (key === "/") document.querySelector<HTMLInputElement>("input[data-search]")?.focus();
  else if (key === "n") {
    if (!actions.readOnly && actions.projectId !== null) actions.openCreate();
  }
  else if (key === "t") actions.toggleTheme();
  else return false;
  return true;
}

function runMovementShortcut(key: string, actions: KeyboardActions): boolean {
  if (key === "j" || key === "k") {
    moveLinear(key === "j" ? 1 : -1, actions.selectedId, actions.selectId);
  } else if (key === "h" || key === "l") {
    moveHorizontal(key === "l" ? 1 : -1, actions.selectedId, actions.selectId);
  } else {
    return false;
  }
  return true;
}

function runIssueShortcut(key: string, actions: KeyboardActions): boolean {
  if (!["Enter", "o", "e", "c", "s", "p", "y"].includes(key)) return false;
  if (actions.readOnly && ["e", "c", "s", "p"].includes(key)) return true;
  const id = key === "y" && actions.openId ? actions.openId : selectedOrFirst(actions.selectedId, actions.selectId);
  if (!id) return false;
  if (key === "y") copyBeadId(id);
  else if (key === "Enter" || key === "o") actions.openDetail(id);
  else {
    if (key === "e") actions.openDetail(id, "edit");
    else if (key === "c") actions.openDetail(id, "close");
    else actions.openPalette(key === "s" ? "status" : "priority", id);
  }
  return true;
}

export function useAppKeyboardShortcuts(actions: KeyboardActions) {
  const router = useRouter();
  const { data } = useProjects();
  const projects = React.useMemo(() => data?.projects ?? [], [data]);
  const pendingChordAt = React.useRef(0);

  const cycleProject = React.useCallback(
    (direction: 1 | -1) => {
      if (projects.length === 0) return;
      const current = projects.findIndex((project) => project.id === actions.projectId);
      const next = current === -1 ? 0 : (current + direction + projects.length) % projects.length;
      router.push(`/p/${projects[next].id}`);
    },
    [actions.projectId, projects, router],
  );

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (event.repeat) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "k") {
        const paletteOpen = !!document.querySelector("[cmdk-root]");
        if (hasOpenOverlay(event.target) && !paletteOpen) return;
        event.preventDefault();
        actions.openPalette();
        return;
      }
      if (key === "Escape") {
        pendingChordAt.current = 0;
        if (!hasOpenOverlay(event.target)) actions.closeOverlays();
        return;
      }
      if (
        isTyping(event.target) ||
        isNativeControlActivation(event.target, key) ||
        // y copies the drawer's bead, so the drawer alone must not block it.
        hasOpenOverlay(event.target, key === "y") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (pendingChordAt.current > Date.now()) {
        pendingChordAt.current = 0;
        // Only y gets here over an overlay, and there it copies, not navigates.
        if (!hasOpenOverlay(event.target) && runChord(key, actions, cycleProject, router)) {
          event.preventDefault();
          return;
        }
      }
      if (key === "g") {
        event.preventDefault();
        pendingChordAt.current = Date.now() + CHORD_TIMEOUT_MS;
        return;
      }
      if (
        runGlobalShortcut(key, actions) ||
        runMovementShortcut(key, actions) ||
        runIssueShortcut(key, actions)
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions, cycleProject, router]);
}
