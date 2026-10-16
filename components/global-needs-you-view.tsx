"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppProvider } from "@/components/app-context";
import {
  ExpandCollapseAll,
  NeedsYouEmpty,
  NeedsYouHeader,
  NeedsYouItem,
  useCardExpansion,
} from "@/components/needs-you-view";
import { PriorityChip } from "@/components/board/bead-card";
import { Icon, typeIconName } from "@/components/icons";
import { useProjects } from "@/hooks/use-projects";
import { useViewerMode } from "@/hooks/use-viewer-mode";
import { beadsQuery } from "@/hooks/use-beads";
import {
  useBoardPrefs,
  type NeedsYouGroup,
  type NeedsYouGroupSort,
  type NeedsYouSort,
} from "@/hooks/use-board-prefs";
import { makeIndex, needsHuman, readyHumanGate, typeColor } from "@/lib/beads-view";
import type { ProjectInfo } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Bead } from "@/lib/schema";

type AppValue = React.ComponentProps<typeof AppProvider>["value"];

interface Item {
  /** Unique across projects: "<project id>/<bead id>". */
  key: string;
  project: ProjectInfo;
  bead: Bead;
  gate: boolean;
}

interface Group {
  /** "<group by>:<value>", so expand and filter state can't leak between groupings. */
  key: string;
  name: string;
  label: React.ReactNode;
  items: Item[];
}

const noop = () => {};
const updated = (it: Item) => it.bead.updated_at ?? "";
const latest = (g: Group) => g.items.reduce((m, it) => (updated(it) > m ? updated(it) : m), "");
const mostUrgent = (g: Group) => Math.min(...g.items.map((it) => it.bead.priority));

const ITEM_SORTS: Record<NeedsYouSort, (a: Item, b: Item) => number> = {
  priority: (a, b) => a.bead.priority - b.bead.priority,
  newest: (a, b) => updated(b).localeCompare(updated(a)),
  oldest: (a, b) => updated(a).localeCompare(updated(b)),
  project: (a, b) => a.project.name.localeCompare(b.project.name),
};

const GROUP_SORTS: Record<NeedsYouGroupSort, (a: Group, b: Group) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  updated: (a, b) => latest(b).localeCompare(latest(a)),
  count: (a, b) => b.items.length - a.items.length,
  priority: (a, b) => mostUrgent(a) - mostUrgent(b),
};

const projectHref = (p: ProjectInfo) => `/p/${encodeURIComponent(p.id)}`;

function groupItems(items: Item[], by: NeedsYouGroup): Group[] {
  if (by === "none") return items.length ? [{ key: "none", name: "", label: null, items }] : [];
  const groups = new Map<string, Group>();
  for (const it of items) {
    const key = by === "project" ? `project:${it.project.id}` : `priority:${it.bead.priority}`;
    let g = groups.get(key);
    if (!g) {
      g = by === "project"
        ? { key, name: it.project.name, label: <ProjectLink project={it.project} />, items: [] }
        : { key, name: `P${it.bead.priority}`, label: <PriorityChip p={it.bead.priority} />, items: [] };
      groups.set(key, g);
    }
    g.items.push(it);
  }
  return [...groups.values()];
}

/**
 * Needs You across every registered project, with a sidebar summarising each
 * group. Each card renders inside its own project's AppProvider, so Respond /
 * Dismiss / Approve hit that project.
 */
export function GlobalNeedsYouView() {
  const router = useRouter();
  const { data: projectsData, isLoading } = useProjects();
  const viewerMode = useViewerMode();
  const readOnly = viewerMode.data?.readOnly ?? true;
  const { prefs, setPrefs } = useBoardPrefs();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<string | null>(null);
  // A fresh object per click, so jumping to the same card again still scrolls.
  const [jump, setJump] = React.useState<{ key: string } | null>(null);
  const expansion = useCardExpansion("selected");
  // Demo is seeded sample data, and a project without .beads has nothing to list.
  const projects = (projectsData?.projects ?? []).filter((p) => p.id !== "demo" && p.hasBeads);
  // shortcut: polls each project rather than opening one SSE stream per project; add streams if the poll lag matters.
  const results = useQueries({ queries: projects.map((p) => beadsQuery(p.id)) });

  React.useEffect(() => {
    if (jump) document.querySelector(`[data-item-key="${CSS.escape(jump.key)}"]`)?.scrollIntoView({ block: "start" });
  }, [jump]);

  const contexts = new Map<string, AppValue>();
  const failed: { project: ProjectInfo; error: string }[] = [];
  const items: Item[] = [];
  projects.forEach((project, i) => {
    const { data, error } = results[i];
    if (error) failed.push({ project, error: error.message });
    if (!data) return;
    const index = makeIndex(data.beads);
    const openDetail = (id: string) =>
      router.push(`${projectHref(project)}?bead=${encodeURIComponent(id)}`);
    const prefix = `${project.id}/`;
    contexts.set(project.id, {
      projectId: project.id,
      beads: data.beads,
      index,
      meta: data.meta,
      humanAllowlist: data.meta?.humanAllowlist ?? [],
      readOnly,
      loading: false,
      selectedBeadId: selected?.startsWith(prefix) ? selected.slice(prefix.length) : null,
      selectBead: (id) => setSelected(id === null ? null : prefix + id),
      openDetail,
      pushDetail: openDetail,
      // No drawer here: cards link out to their project instead.
      peekDetail: noop,
      replaceDetail: noop,
      openCreate: noop,
      openEpic: noop,
    });
    for (const b of data.beads) {
      const gate = readyHumanGate(b, index);
      if (gate || needsHuman(b)) items.push({ key: prefix + b.id, project, bead: b, gate });
    }
  });
  // Gates first, as on the per-project page; both sorts are stable, so ties keep that.
  items.sort((a, b) => Number(b.gate) - Number(a.gate)).sort(ITEM_SORTS[prefs.needsYouSort]);
  const groups = groupItems(items, prefs.needsYouGroup).sort(GROUP_SORTS[prefs.needsYouGroupSort]);
  const activeFilter = groups.some((g) => g.key === filter) ? filter : null;
  const shown = activeFilter ? groups.filter((g) => g.key === activeFilter) : groups;
  const mixed = prefs.needsYouGroup !== "project";
  const loading = isLoading || results.some((r) => r.isLoading);

  const toggleGroup = (key: string) => {
    const open = prefs.needsYouExpanded.includes(key);
    setPrefs({
      ...prefs,
      needsYouExpanded: open ? prefs.needsYouExpanded.filter((k) => k !== key) : [...prefs.needsYouExpanded, key],
    });
  };
  const jumpTo = (it: Item, groupKey: string) => {
    if (activeFilter && activeFilter !== groupKey) setFilter(null);
    setSelected(it.key);
    expansion.setOpen(it.key, true);
    setJump({ key: it.key });
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground text-sm">
      <NeedsYouHeader title="Needs You · all projects" total={items.length}>
        <span className="flex-1" />
        {items.length > 0 && <ExpandCollapseAll onChange={expansion.setAll} />}
        <Link href="/" className="ml-2 text-[12px] text-[var(--text-3)] hover:text-[var(--text)]">
          ← Projects
        </Link>
      </NeedsYouHeader>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Needs You summary" className="flex w-[280px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-[var(--surface)] p-3">
          <div className="flex flex-col gap-2">
            <PrefSelect
              label="Group by"
              value={prefs.needsYouGroup}
              options={{ project: "Project", priority: "Priority", none: "None" }}
              onChange={(v) => setPrefs({ ...prefs, needsYouGroup: v as NeedsYouGroup })}
            />
            {prefs.needsYouGroup !== "none" && (
              <PrefSelect
                label="Order groups"
                value={prefs.needsYouGroupSort}
                options={{
                  name: prefs.needsYouGroup === "priority" ? "Priority" : "Name",
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
              options={{ priority: "Priority", newest: "Newest", oldest: "Oldest", project: "Project" }}
              onChange={(v) => setPrefs({ ...prefs, needsYouSort: v as NeedsYouSort })}
            />
          </div>
          <nav className="flex flex-col gap-[2px]">
            <SidebarRow active={!activeFilter} onClick={() => setFilter(null)} count={items.length}>
              All projects
            </SidebarRow>
            {prefs.needsYouGroup === "none"
              ? items.map((it) => (
                  <BeadRow key={it.key} item={it} project selected={selected === it.key} onClick={() => jumpTo(it, "none")} />
                ))
              : groups.map((g) => {
                  const open = prefs.needsYouExpanded.includes(g.key);
                  return (
                    <div key={g.key} data-group-key={g.key}>
                      <SidebarRow
                        active={activeFilter === g.key}
                        onClick={() => setFilter(g.key)}
                        count={g.items.length}
                        expanded={open}
                        onToggle={() => toggleGroup(g.key)}
                      >
                        {g.name}
                      </SidebarRow>
                      {open && g.items.map((it) => (
                        <BeadRow key={it.key} item={it} project={mixed} selected={selected === it.key} onClick={() => jumpTo(it, g.key)} />
                      ))}
                    </div>
                  );
                })}
            {prefs.needsYouGroup === "project" && failed.map(({ project, error }) => (
              <SidebarRow key={project.id} onClick={() => router.push(projectHref(project))} count="!" title={error}>
                {project.name}
              </SidebarRow>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {failed.map(({ project, error }) => (
            <p key={project.id} role="alert" title={error} className="mx-auto mb-3 max-w-3xl truncate text-[12px] text-destructive">
              Couldn’t load <ProjectLink project={project} />: {error}
            </p>
          ))}
          {groups.length === 0 && loading ? (
            <div className="flex h-[200px] items-center justify-center text-[var(--text-3)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <NeedsYouEmpty />
          ) : (
            shown.map((g) => (
              <section key={g.key} data-group-key={g.key} className="mx-auto mb-6 max-w-3xl">
                {g.label && (
                  <h2 className="mb-2 flex items-center gap-2 text-[13px] font-[650]">
                    {g.label}
                    <span className="text-[12px] font-normal text-[var(--text-3)]">· {g.items.length}</span>
                  </h2>
                )}
                <div className="flex flex-col gap-2">
                  {g.items.map((it) => {
                    const open = expansion.isOpen(it.key, selected === it.key);
                    return (
                      <div key={it.key} data-item-key={it.key} data-item-project={it.project.id} className="scroll-mt-3">
                        {mixed && open && (
                          <div className="mb-1 text-[11.5px] font-[600] text-[var(--text-2)]">
                            <ProjectLink project={it.project} />
                          </div>
                        )}
                        <AppProvider value={contexts.get(it.project.id)!}>
                          <NeedsYouItem
                            bead={it.bead}
                            gate={it.gate}
                            open={open}
                            onOpenChange={(o) => expansion.setOpen(it.key, o)}
                            project={mixed ? it.project.name : undefined}
                          />
                        </AppProvider>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarRow({ active, onClick, count, expanded, onToggle, title, children }: {
  active?: boolean;
  onClick: () => void;
  count: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  title?: string;
  children: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-[9px] pr-2 text-[13px]",
        active ? "bg-[var(--brand-weak)] font-semibold text-[var(--brand)]" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]",
      )}
    >
      {onToggle ? (
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${children}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex h-7 w-6 flex-shrink-0 items-center justify-center text-[var(--text-3)] hover:text-[var(--text)]"
        >
          <Icon name="chevron" size={13} className={expanded ? "" : "-rotate-90"} />
        </button>
      ) : (
        <span className="w-6 flex-shrink-0" />
      )}
      <button type="button" onClick={onClick} title={title} aria-current={active ? "true" : undefined} className="min-w-0 flex-1 truncate py-[6px] text-left">
        {children}
      </button>
      <span className={cn("font-mono text-[11px]", count === "!" ? "text-destructive" : "text-[var(--text-3)]")}>{count}</span>
    </div>
  );
}

function BeadRow({ item, project, selected, onClick }: {
  item: Item;
  project?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const { bead, gate } = item;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${bead.id} · ${bead.title}`}
      data-sidebar-item={item.key}
      className={cn(
        "flex w-full items-center gap-[6px] rounded-[7px] py-[4px] pl-7 pr-2 text-left text-[12px]",
        selected ? "bg-[var(--surface-3)] text-[var(--text)]" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]",
      )}
    >
      {gate ? (
        <Icon name="gate" size={12} className="flex-shrink-0" style={{ color: "var(--brand)" }} />
      ) : (
        <Icon name={typeIconName(bead.issue_type)} size={12} className="flex-shrink-0" style={{ color: typeColor(bead.issue_type) }} />
      )}
      <span className="min-w-0 flex-1 truncate">{bead.title}</span>
      {project && <span className="max-w-[80px] flex-shrink-0 truncate text-[10.5px] text-[var(--text-3)]">{item.project.name}</span>}
    </button>
  );
}

function ProjectLink({ project }: { project: ProjectInfo }) {
  return <Link href={projectHref(project)} className="hover:underline">{project.name}</Link>;
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
        className="h-8 w-[150px] rounded-[8px] border border-border bg-[var(--surface-2)] px-2 text-[var(--text)]"
      >
        {Object.entries(options).map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}
