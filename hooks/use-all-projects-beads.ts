"use client";
import { useQueries } from "@tanstack/react-query";
import { useProjects } from "@/hooks/use-projects";
import { beadsPollInterval, beadsQuery } from "@/hooks/use-beads";
import { makeIndex, needsHuman, readyHumanGate } from "@/lib/beads-view";
import type { BeadsResponse } from "@/lib/api-client";
import type { Bead } from "@/lib/schema";

/** Every registered project's beads, polled; empty when not enabled. */
export function useAllProjectsBeads(enabled = true) {
  const { data, isLoading } = useProjects();
  // Demo is seeded sample data, and a project without .beads has nothing to list.
  const projects = enabled ? (data?.projects ?? []).filter((p) => p.id !== "demo" && p.hasBeads) : [];
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
  return { projects, results, isLoading };
}

/** Beads that need a person: agent-flagged (bd human) or ready human-approval gates. */
export const countNeedsYou = (beads: Bead[], index = makeIndex(beads)) =>
  beads.filter((b) => needsHuman(b) || readyHumanGate(b, index)).length;

/** The Needs You total across every project; undefined when not enabled. */
export function useAllProjectsNeedsYou(enabled: boolean) {
  const { results } = useAllProjectsBeads(enabled);
  return enabled ? results.reduce((n, r) => n + (r.data ? countNeedsYou(r.data.beads) : 0), 0) : undefined;
}
