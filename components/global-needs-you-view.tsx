"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import { NeedsYouInbox, type InboxSource } from "@/components/needs-you-view";
import { useProjects } from "@/hooks/use-projects";
import { useViewerMode } from "@/hooks/use-viewer-mode";
import { beadsPollInterval, beadsQuery } from "@/hooks/use-beads";
import { makeIndex } from "@/lib/beads-view";
import type { BeadsResponse, ProjectInfo } from "@/lib/api-client";

const noop = () => {};
const projectHref = (p: ProjectInfo, bead?: string) =>
  `/p/${encodeURIComponent(p.id)}${bead ? `?bead=${encodeURIComponent(bead)}` : ""}`;

/** Needs You across every registered project, in one inbox. */
export function GlobalNeedsYouView() {
  const router = useRouter();
  const { data: projectsData, isLoading } = useProjects();
  const viewerMode = useViewerMode();
  const readOnly = viewerMode.data?.readOnly ?? true;
  const [selected, setSelected] = React.useState<string | null>(null);
  // Demo is seeded sample data, and a project without .beads has nothing to list.
  const projects = (projectsData?.projects ?? []).filter((p) => p.id !== "demo" && p.hasBeads);
  // shortcut: polls each project rather than opening one SSE stream per project; add streams if the poll lag matters.
  const results = useQueries({
    queries: projects.map((p) => ({
      ...beadsQuery(p.id),
      // A query that has never loaded drops its error when a refetch starts, so polling a
      // broken project makes its error line flicker. shortcut: a reload retries it.
      refetchInterval: (q: { state: { data?: BeadsResponse; status: string } }) =>
        q.state.data === undefined && q.state.status === "error" ? false : beadsPollInterval(q.state.data),
      refetchOnWindowFocus: false,
    })),
  });

  const sources: InboxSource[] = [];
  const failed: { project: ProjectInfo; error: string }[] = [];
  projects.forEach((project, i) => {
    const { data, error } = results[i];
    if (error) failed.push({ project, error: error.message });
    if (!data) return;
    const prefix = `${project.id}/`;
    sources.push({
      project,
      app: {
        projectId: project.id,
        beads: data.beads,
        index: makeIndex(data.beads),
        meta: data.meta,
        humanAllowlist: data.meta?.humanAllowlist ?? [],
        readOnly,
        loading: false,
        selectedBeadId: selected?.startsWith(prefix) ? selected.slice(prefix.length) : null,
        selectBead: (id) => setSelected(id === null ? null : prefix + id),
        // The detail pane follows links itself; these only leave for the project.
        openDetail: (id) => router.push(projectHref(project, id)),
        pushDetail: (id) => router.push(projectHref(project, id)),
        peekDetail: noop,
        replaceDetail: noop,
        openCreate: (opts) => router.push(projectHref(project, opts?.parent)),
        openEpic: (id) => router.push(projectHref(project, id)),
      },
    });
  });

  return (
    <div className="h-full bg-background text-foreground text-sm">
      <NeedsYouInbox
        title="Needs You"
        sources={sources}
        loading={isLoading || results.some((r) => r.isLoading)}
        selected={selected}
        onSelect={setSelected}
        ownKeys
        headerExtra={
          <Link href="/" title="All projects" className="whitespace-nowrap text-[12px] text-[var(--text-3)] hover:text-[var(--text)]">
            ← Projects
          </Link>
        }
        alerts={failed.map(({ project, error }) => (
          <p key={project.id} role="alert" title={error} className="truncate px-3 py-1 text-[12px] text-destructive">
            Couldn’t load{" "}
            <Link href={projectHref(project)} className="hover:underline">{project.name}</Link>: {error}
          </p>
        ))}
      />
    </div>
  );
}
