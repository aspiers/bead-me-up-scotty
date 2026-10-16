"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NeedsYouInbox, type InboxSource } from "@/components/needs-you-view";
import { GLOBAL_VIEW_HREF, Sidebar } from "@/components/sidebar";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { countNeedsYou, useAllProjectsBeads } from "@/hooks/use-all-projects-beads";
import { useViewerMode } from "@/hooks/use-viewer-mode";
import { makeIndex } from "@/lib/beads-view";
import type { ProjectInfo } from "@/lib/api-client";

const noop = () => {};
const projectHref = (p: ProjectInfo, bead?: string) =>
  `/p/${encodeURIComponent(p.id)}${bead ? `?bead=${encodeURIComponent(bead)}` : ""}`;

/** Needs You across every registered project, in one inbox. */
export function GlobalNeedsYouView() {
  const router = useRouter();
  const { projects, results, isLoading } = useAllProjectsBeads();
  const viewerMode = useViewerMode();
  const readOnly = viewerMode.data?.readOnly ?? true;
  const [selected, setSelected] = React.useState<string | null>(null);

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

  const waiting = sources.reduce((n, { app }) => n + countNeedsYou(app.beads, app.index), 0);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground text-sm">
      <ReadOnlyBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar view="needsyou" onView={(v) => router.push(GLOBAL_VIEW_HREF[v]!)} humanActor={sources[0]?.app.meta?.humanActor} needsYouTotal={waiting} />
        <div className="min-w-0 flex-1">
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
      </div>
    </div>
  );
}
