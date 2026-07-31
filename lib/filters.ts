import type { Bead } from "./schema";
import { beadOrigin } from "./attribution";

/**
 * Shared bead filter model used by both the Board and List views. Every facet is
 * multi-select; an empty array means "no constraint" (show all). `search` matches
 * id / title / assignee.
 */
export interface Filters {
  status: string[];
  type: string[];
  priority: number[];
  origin: string[];
  labels: string[];
  search: string;
}

export const emptyFilters: Filters = {
  status: [],
  type: [],
  priority: [],
  origin: [],
  labels: [],
  search: "",
};

const FILTER_PARAMS = [
  "status",
  "type",
  "priority",
  "origin",
  "label",
  "q",
] as const;

type SearchParamsReader = Pick<URLSearchParams, "get" | "getAll">;

function distinctValues(params: SearchParamsReader, name: string): string[] {
  return [...new Set(params.getAll(name).filter(Boolean))];
}

/** Parse the shared Board/List filters from bookmarkable query parameters. */
export function filtersFromSearchParams(params: SearchParamsReader): Filters {
  return {
    status: distinctValues(params, "status"),
    type: distinctValues(params, "type"),
    priority: distinctValues(params, "priority")
      .map(Number)
      .filter(
        (priority) =>
          Number.isInteger(priority) && priority >= 0 && priority <= 4,
      ),
    origin: distinctValues(params, "origin"),
    labels: distinctValues(params, "label"),
    search: params.get("q") ?? "",
  };
}

/** Replace only filter-related parameters, preserving view and issue state. */
export function writeFiltersToSearchParams(
  params: URLSearchParams,
  filters: Filters,
): void {
  for (const name of FILTER_PARAMS) params.delete(name);
  for (const status of filters.status) params.append("status", status);
  for (const type of filters.type) params.append("type", type);
  for (const priority of filters.priority)
    params.append("priority", String(priority));
  for (const origin of filters.origin) params.append("origin", origin);
  for (const label of filters.labels) params.append("label", label);
  if (filters.search) params.set("q", filters.search);
}

/**
 * `archived` is state, not a tag — it has its own dedicated toggle in the
 * FilterBar and the views hide on it — so it never appears as a label facet
 * option.
 */
export const ARCHIVED_LABEL = "archived";

/**
 * The distinct labels in use across a bead set, sorted, as filter options.
 * Callers pass ALL beads (not the filtered set) so selecting one label doesn't
 * make the other options vanish from the dropdown.
 */
export function labelOptionsFrom(beads: Bead[]): { value: string; label: string }[] {
  const s = new Set<string>();
  for (const b of beads) for (const l of b.labels ?? []) if (l !== ARCHIVED_LABEL) s.add(l);
  return [...s].sort().map((l) => ({ value: l, label: l }));
}

/** Count of active facet selections (excludes free-text search). */
export function activeFilterCount(f: Filters): number {
  return f.status.length + f.type.length + f.priority.length + f.origin.length + f.labels.length;
}

export function matchesFilters(b: Bead, f: Filters, humanAllowlist: string[]): boolean {
  if (f.status.length && !f.status.includes(b.status)) return false;
  if (f.type.length && !f.type.includes(b.issue_type)) return false;
  if (f.priority.length && !f.priority.includes(b.priority)) return false;
  if (f.origin.length && !f.origin.includes(beadOrigin(b, humanAllowlist))) return false;
  // OR within the facet, like every other facet above; AND across facets.
  if (f.labels.length && !f.labels.some((l) => (b.labels ?? []).includes(l))) return false;
  const q = f.search.trim().toLowerCase();
  if (
    q &&
    !(
      b.title.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q) ||
      (b.assignee ?? "").toLowerCase().includes(q) ||
      (b.labels ?? []).some((l) => l.toLowerCase().includes(q))
    )
  )
    return false;
  return true;
}

/** Immutable toggle of a value in a string array. */
export function toggleStr(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

/** Immutable toggle of a value in a number array. */
export function toggleNum(arr: number[], v: number): number[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}
