"use client";
import * as React from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { AppProvider, useApp, type AppContextValue } from "@/components/app-context";
import { BeadDetailPane } from "@/components/bead-detail-drawer";
import { Icon, typeIconName } from "@/components/icons";
import { PriorityChip } from "@/components/board/bead-card";
import {
  useBoardPrefs,
  type NeedsYouGroup,
  type NeedsYouGroupSort,
  type NeedsYouSort,
} from "@/hooks/use-board-prefs";
import { needsHuman, readyHumanGate, typeColor, relTime, fmtDateTime } from "@/lib/beads-view";
import { cn } from "@/lib/utils";
import type { Bead } from "@/lib/schema";

/**
 * Mission Control — "Needs You" decision inbox. Surfaces two kinds of items
 * waiting on a person:
 *   1. Beads an agent flagged for a decision (the `human` label, via `bd human`)
 *      — answered (comment + clear the flag) or dismissed.
 *   2. Human-approval gates (`bd gate create --type human`) whose blockers are
 *      resolved — approved (closed, which unblocks dependents) from here so they
 *      don't sit invisibly waiting on the board (bead 8qc / gh-6).
 * Laid out like Linear's inbox: a list, and the selected bead's detail beside it.
 */
export function NeedsYouView() {
  const app = useApp();
  const prefix = `${app.projectId}/`;
  return (
    <NeedsYouInbox
      title="Needs You"
      sources={[{ project: { id: app.projectId, name: app.projectId }, app }]}
      loading={app.loading}
      selected={app.selectedBeadId && prefix + app.selectedBeadId}
      onSelect={(key) => app.selectBead(key && key.slice(prefix.length))}
    />
  );
}

/** One project's beads, with the context its actions run in. */
export interface InboxSource {
  project: { id: string; name: string };
  app: AppContextValue;
}

interface Item {
  /** Unique across projects: "<project id>/<bead id>". */
  key: string;
  source: InboxSource;
  bead: Bead;
  gate: boolean;
}

interface Group {
  /** "<group by>:<value>", so collapse state can't leak between groupings. */
  key: string;
  name: string;
  label: React.ReactNode;
  items: Item[];
}

const updated = (it: Item) => it.bead.updated_at ?? "";
const latest = (g: Group) => g.items.reduce((m, it) => (updated(it) > m ? updated(it) : m), "");
const mostUrgent = (g: Group) => Math.min(...g.items.map((it) => it.bead.priority));

const ITEM_SORTS: Record<NeedsYouSort, (a: Item, b: Item) => number> = {
  priority: (a, b) => a.bead.priority - b.bead.priority,
  newest: (a, b) => updated(b).localeCompare(updated(a)),
  oldest: (a, b) => updated(a).localeCompare(updated(b)),
  project: (a, b) => a.source.project.name.localeCompare(b.source.project.name),
};

const GROUP_SORTS: Record<NeedsYouGroupSort, (a: Group, b: Group) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  updated: (a, b) => latest(b).localeCompare(latest(a)),
  count: (a, b) => b.items.length - a.items.length,
  priority: (a, b) => mostUrgent(a) - mostUrgent(b),
};

function groupItems(items: Item[], by: NeedsYouGroup): Group[] {
  if (by === "none") return items.length ? [{ key: "none", name: "", label: null, items }] : [];
  const groups = new Map<string, Group>();
  for (const it of items) {
    const { project } = it.source;
    const key = by === "project" ? `project:${project.id}` : `priority:${it.bead.priority}`;
    let g = groups.get(key);
    if (!g) {
      g = by === "project"
        ? { key, name: project.name, label: project.name, items: [] }
        : { key, name: `P${it.bead.priority}`, label: <PriorityChip p={it.bead.priority} />, items: [] };
      groups.set(key, g);
    }
    g.items.push(it);
  }
  return [...groups.values()];
}

/**
 * The inbox for one project or many. Each bead's detail renders inside its own
 * project's context, so Respond, Dismiss and Approve reach that project.
 */
export function NeedsYouInbox({ title, sources, loading, selected, onSelect, alerts, headerExtra, ownKeys = false }: {
  title: string;
  sources: InboxSource[];
  loading: boolean;
  /** Item key, "<project id>/<bead id>". */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** One-line problems shown above the list, such as a project that failed to load. */
  alerts?: React.ReactNode;
  headerExtra?: React.ReactNode;
  /** Handle J/K here, where no project keyboard layer is mounted. */
  ownKeys?: boolean;
}) {
  const { prefs, setPrefs } = useBoardPrefs();
  const mixed = sources.length > 1;
  // A single project's list has nothing to group by project.
  const groupBy = !mixed && prefs.needsYouGroup === "project" ? "none" : prefs.needsYouGroup;
  const items: Item[] = [];
  for (const source of sources) {
    const { beads, index, projectId } = source.app;
    for (const b of beads) {
      const gate = readyHumanGate(b, index);
      if (gate || needsHuman(b)) items.push({ key: `${projectId}/${b.id}`, source, bead: b, gate });
    }
  }
  // Gates first; both sorts are stable, so ties keep that.
  items.sort((a, b) => Number(b.gate) - Number(a.gate)).sort(ITEM_SORTS[prefs.needsYouSort]);
  const groups = groupItems(items, groupBy).sort(GROUP_SORTS[prefs.needsYouGroupSort]);
  const visible = groups.flatMap((g) => (prefs.needsYouCollapsed.includes(g.key) ? [] : g.items));
  const current = items.find((it) => it.key === selected) ?? visible[0] ?? null;
  const at = current ? visible.indexOf(current) : -1;
  const nextKey = at === -1 ? null : (visible[at + 1] ?? visible[at - 1])?.key ?? null;

  // Once everything has loaded, the item shown becomes the selection, so J/K step from it.
  const currentKey = current?.key ?? null;
  React.useEffect(() => {
    if (!loading && currentKey && currentKey !== selected) onSelect(currentKey);
  }, [loading, currentKey, selected, onSelect]);

  const toggleGroup = (key: string) => {
    const collapsed = prefs.needsYouCollapsed.includes(key);
    setPrefs({
      ...prefs,
      needsYouCollapsed: collapsed ? prefs.needsYouCollapsed.filter((k) => k !== key) : [...prefs.needsYouCollapsed, key],
    });
  };

  const visibleKeys = visible.map((it) => it.key).join("\n");
  React.useEffect(() => {
    if (!ownKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const keys = visibleKeys ? visibleKeys.split("\n") : [];
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.itemKey;
      const i = keys.indexOf(focused ?? currentKey ?? "");
      const next = keys[Math.max(0, Math.min(keys.length - 1, i + (e.key === "j" ? 1 : -1)))];
      if (!next) return;
      e.preventDefault();
      document.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(next)}"]`)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ownKeys, visibleKeys, currentKey]);

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Needs You list" className="flex w-[340px] flex-shrink-0 flex-col border-r border-border bg-[var(--surface)]">
        <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-3">
          <Icon name="user" size={16} className="text-[var(--text-2)]" />
          <h1 className="truncate whitespace-nowrap text-[14px] font-[650]">{title}</h1>
          <span className="text-[12px] text-[var(--text-3)]">{items.length || ""}</span>
          <span className="flex-1" />
          <DisplayMenu mixed={mixed} />
          {headerExtra}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {alerts}
          {items.length === 0 && loading && (
            <div className="flex h-[120px] items-center justify-center text-[var(--text-3)]">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {groups.map((g) => {
            const collapsed = prefs.needsYouCollapsed.includes(g.key);
            return (
              <section key={g.key} data-group-key={g.key} className="mb-1">
                {g.label && (
                  <h2>
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() => toggleGroup(g.key)}
                      className="flex w-full items-center gap-[6px] px-3 py-[6px] text-left text-[12px] font-[600] text-[var(--text-2)] hover:text-[var(--text)]"
                    >
                      <Icon name="chevron" size={12} className={collapsed ? "-rotate-90" : ""} />
                      <span className="min-w-0 truncate">{g.label}</span>
                      <span className="font-normal text-[var(--text-3)]">{g.items.length}</span>
                    </button>
                  </h2>
                )}
                {!collapsed && g.items.map((it) => (
                  <InboxRow
                    key={it.key}
                    item={it}
                    showProject={mixed && groupBy !== "project"}
                    selected={it === current}
                    onSelect={() => onSelect(it.key)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </aside>
      <section aria-label="Bead detail" className="min-w-0 flex-1">
        {current ? (
          <DetailPane key={current.key} item={current} onAnswered={() => onSelect(nextKey)} />
        ) : (
          !loading && <NeedsYouEmpty />
        )}
      </section>
    </div>
  );
}

function InboxRow({ item, showProject, selected, onSelect }: {
  item: Item;
  showProject: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { bead, gate } = item;
  return (
    <button
      type="button"
      data-item-key={item.key}
      data-item-project={item.source.project.id}
      data-keyboard-bead-id={bead.id}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onFocus={onSelect}
      title={bead.title}
      className={cn(
        "mx-1 flex w-[calc(100%-8px)] items-start gap-[9px] rounded-[8px] px-2 py-[7px] text-left focus-visible:outline-none",
        selected ? "bg-[var(--surface-3)]" : "hover:bg-[var(--surface-2)]",
      )}
    >
      <span className="mt-[2px] flex-shrink-0">
        {gate ? (
          <Icon name="gate" size={14} style={{ color: "var(--brand)" }} />
        ) : (
          <Icon name={typeIconName(bead.issue_type)} size={14} style={{ color: typeColor(bead.issue_type) }} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-[550] text-[var(--text)]">{bead.title}</span>
        <span className="mt-[2px] flex items-center gap-[5px] text-[11.5px] text-[var(--text-3)]">
          <span className="font-mono">{bead.id}</span>
          {showProject && <span className="truncate">· {item.source.project.name}</span>}
          {gate && <span>· approval gate</span>}
        </span>
      </span>
      <span className="flex flex-shrink-0 flex-col items-end gap-[3px]">
        <span title={fmtDateTime(bead.updated_at)} className="text-[11px] text-[var(--text-3)]">{relTime(bead.updated_at)}</span>
        <PriorityChip p={bead.priority} />
      </span>
    </button>
  );
}

/** The selected bead, with its own trail for links followed inside it. */
function DetailPane({ item, onAnswered }: { item: Item; onAnswered: () => void }) {
  const [trail, setTrail] = React.useState<string[]>([]);
  const { app } = item.source;
  const shownId = trail.at(-1) ?? item.bead.id;
  const bead = app.index.get(shownId);
  const push = (id: string) => setTrail((t) => (t.at(-1) === id ? t : [...t, id]));
  if (!bead) return null;
  return (
    <AppProvider value={{ ...app, selectedBeadId: shownId, openDetail: push, pushDetail: push }}>
      <BeadDetailPane
        bead={bead}
        canGoBack={trail.length > 0}
        backTo={trail.at(-2) ?? item.bead.id}
        onBack={() => setTrail((t) => t.slice(0, -1))}
        onAnswered={onAnswered}
      />
    </AppProvider>
  );
}

/** Grouping and sorting, tucked behind one button as in Linear. */
function DisplayMenu({ mixed }: { mixed: boolean }) {
  const { prefs, setPrefs } = useBoardPrefs();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const group = mixed || prefs.needsYouGroup !== "project" ? prefs.needsYouGroup : "none";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Display options"
        className="flex h-7 items-center gap-[5px] rounded-[7px] border border-border px-2 text-[12px] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
      >
        <SlidersHorizontal size={13} /> Display
      </button>
      {open && (
        <div role="group" aria-label="Display options" className="absolute right-0 top-9 z-30 flex w-[260px] flex-col gap-2 rounded-[10px] border border-border bg-[var(--surface)] p-3 shadow-lg">
          <PrefSelect
            label="Group by"
            value={group}
            options={mixed
              ? { project: "Project", priority: "Priority", none: "None" }
              : { priority: "Priority", none: "None" }}
            onChange={(v) => setPrefs({ ...prefs, needsYouGroup: v as NeedsYouGroup })}
          />
          {group !== "none" && (
            <PrefSelect
              label="Order groups"
              value={prefs.needsYouGroupSort}
              options={{
                name: group === "priority" ? "Priority" : "Name",
                updated: "Recently updated",
                count: "Most items",
                priority: "Most urgent",
              }}
              onChange={(v) => setPrefs({ ...prefs, needsYouGroupSort: v as NeedsYouGroupSort })}
            />
          )}
          <PrefSelect
            label="Sort items"
            value={prefs.needsYouSort}
            options={mixed
              ? { priority: "Priority", newest: "Newest", oldest: "Oldest", project: "Project" }
              : { priority: "Priority", newest: "Newest", oldest: "Oldest" }}
            onChange={(v) => setPrefs({ ...prefs, needsYouSort: v as NeedsYouSort })}
          />
        </div>
      )}
    </div>
  );
}

function PrefSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-2)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-[140px] rounded-[8px] border border-border bg-[var(--surface-2)] px-2 text-[var(--text)]"
      >
        {Object.entries(options).map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}

export function NeedsYouEmpty() {
  return (
    <div className="p-10 text-center text-[13px] text-[var(--text-3)]">
      🎉 Nothing needs you right now. Agents flag beads here with{" "}
      <span className="font-mono">bd human</span>, and human-approval gates
      (<span className="font-mono">bd gate create --type human</span>) show
      up once their blockers clear.
    </div>
  );
}
