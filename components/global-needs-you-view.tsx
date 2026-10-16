"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppProvider } from "@/components/app-context";
import {
  GateCard,
  NeedsYouCard,
  NeedsYouEmpty,
  NeedsYouHeader,
} from "@/components/needs-you-view";
import { useProjects } from "@/hooks/use-projects";
import { useViewerMode } from "@/hooks/use-viewer-mode";
import { beadsQuery } from "@/hooks/use-beads";
import { useBoardPrefs, type NeedsYouGroup, type NeedsYouSort } from "@/hooks/use-board-prefs";
import { makeIndex, needsHuman, readyHumanGate } from "@/lib/beads-view";
import type { ProjectInfo } from "@/lib/api-client";
import type { Bead } from "@/lib/schema";

type AppValue = React.ComponentProps<typeof AppProvider>["value"];

interface Item {
  project: ProjectInfo;
  bead: Bead;
  gate: boolean;
}

interface Group {
  project?: ProjectInfo;
  items: Item[];
}

const noop = () => {};

const SORTS: Record<NeedsYouSort, (a: Item, b: Item) => number> = {
  priority: (a, b) => a.bead.priority - b.bead.priority,
  newest: (a, b) => (b.bead.updated_at ?? "").localeCompare(a.bead.updated_at ?? ""),
  oldest: (a, b) => (a.bead.updated_at ?? "").localeCompare(b.bead.updated_at ?? ""),
  project: (a, b) => a.project.name.localeCompare(b.project.name),
};

const projectHref = (p: ProjectInfo) => `/p/${encodeURIComponent(p.id)}`;

/**
 * Needs You across every registered project. Each card renders inside its own
 * project's AppProvider, so Respond / Dismiss / Approve hit that project.
 */
export function GlobalNeedsYouView() {
  const router = useRouter();
  const { data: projectsData, isLoading } = useProjects();
  const viewerMode = useViewerMode();
  const readOnly = viewerMode.data?.readOnly ?? true;
  const { prefs, setPrefs } = useBoardPrefs();
  const [selectedBeadId, selectBead] = React.useState<string | null>(null);
  // Demo is seeded sample data, and a project without .beads has nothing to list.
  const projects = (projectsData?.projects ?? []).filter((p) => p.id !== "demo" && p.hasBeads);
  // shortcut: polls each project rather than opening one SSE stream per project; add streams if the poll lag matters.
  const results = useQueries({ queries: projects.map((p) => beadsQuery(p.id)) });

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
    contexts.set(project.id, {
      projectId: project.id,
      beads: data.beads,
      index,
      meta: data.meta,
      humanAllowlist: data.meta?.humanAllowlist ?? [],
      readOnly,
      loading: false,
      selectedBeadId,
      selectBead,
      openDetail,
      pushDetail: openDetail,
      // No drawer here: cards link out to their project instead.
      peekDetail: noop,
      replaceDetail: noop,
      openCreate: noop,
      openEpic: noop,
    });
    for (const b of data.beads) {
      if (readyHumanGate(b, index)) items.push({ project, bead: b, gate: true });
      else if (needsHuman(b)) items.push({ project, bead: b, gate: false });
    }
  });
  // Gates first, as on the per-project page; sort is stable, so ties keep that.
  items.sort((a, b) => Number(b.gate) - Number(a.gate)).sort(SORTS[prefs.needsYouSort]);

  const groups: Group[] = (
    prefs.needsYouGroup === "project"
      ? projects.map((project) => ({ project, items: items.filter((it) => it.project === project) }))
      : [{ items }]
  ).filter((g) => g.items.length);
  const loading = isLoading || results.some((r) => r.isLoading);

  return (
    <div className="flex h-full flex-col bg-background text-foreground text-sm">
      <NeedsYouHeader title="Needs You · all projects" total={items.length}>
        <span className="flex-1" />
        <PrefSelect
          label="Group by"
          value={prefs.needsYouGroup}
          options={{ project: "Project", none: "None" }}
          onChange={(v) => setPrefs({ ...prefs, needsYouGroup: v as NeedsYouGroup })}
        />
        <PrefSelect
          label="Sort"
          value={prefs.needsYouSort}
          options={{ priority: "Priority", newest: "Newest", oldest: "Oldest", project: "Project" }}
          onChange={(v) => setPrefs({ ...prefs, needsYouSort: v as NeedsYouSort })}
        />
        <Link href="/" className="ml-2 text-[12px] text-[var(--text-3)] hover:text-[var(--text)]">
          ← Projects
        </Link>
      </NeedsYouHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {failed.map(({ project, error }) => (
          <p key={project.id} role="alert" className="mx-auto mb-3 max-w-3xl text-[12px] text-destructive">
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
          groups.map((g) => (
            <section key={g.project?.id ?? "all"} data-project-id={g.project?.id} className="mx-auto mb-6 max-w-3xl">
              {g.project && (
                <h2 className="mb-2 flex items-center gap-2 text-[13px] font-[650]">
                  <ProjectLink project={g.project} />
                  <span className="text-[12px] font-normal text-[var(--text-3)]">· {g.items.length}</span>
                </h2>
              )}
              <div className="flex flex-col gap-3">
                {g.items.map((it) => (
                  <div key={`${it.project.id}/${it.bead.id}`} data-item-project={it.project.id}>
                    {!g.project && (
                      <div className="mb-1 text-[11.5px] font-[600] text-[var(--text-2)]">
                        <ProjectLink project={it.project} />
                      </div>
                    )}
                    <AppProvider value={contexts.get(it.project.id)!}>
                      {it.gate ? (
                        <GateCard gate={it.bead} />
                      ) : (
                        <NeedsYouCard bead={it.bead} nextId={null} />
                      )}
                    </AppProvider>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
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
    <label className="flex items-center gap-2 text-[12px] text-[var(--text-2)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-[8px] border border-border bg-[var(--surface-2)] px-2 text-[var(--text)]"
      >
        {Object.entries(options).map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}
