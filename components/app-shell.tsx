"use client";
import * as React from "react";
import { toast } from "sonner";
import { type BeadType } from "@/lib/schema";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useBeads } from "@/hooks/use-beads";
import { useBeadsStream } from "@/hooks/use-beads-stream";
import { useLastView } from "@/hooks/use-last-view";
import { useTheme } from "@/components/theme-provider";
import { makeIndex } from "@/lib/beads-view";
import { AppProvider, type DetailAction, type View } from "@/components/app-context";
import { Sidebar } from "@/components/sidebar";
import { Board } from "@/components/board/board";
import { FocusView } from "@/components/focus-view";
import { ListView } from "@/components/list-view";
import { EpicsView } from "@/components/epics-view";
import { GraphView } from "@/components/graph-view";
import { InsightsView } from "@/components/insights-view";
import { ActivityView } from "@/components/activity-view";
import { NeedsYouView } from "@/components/needs-you-view";
import { AchievementsView } from "@/components/achievements-view";
import { PublishView } from "@/components/publish-view";
import { SettingsView } from "@/components/settings-view";
import { BeadDetailDrawer } from "@/components/bead-detail-drawer";
import { CreateBeadModal } from "@/components/create-bead-modal";
import { KeyboardLayer } from "@/components/keyboard-layer";
import { isTyping } from "@/hooks/use-app-keyboard";
import { NotificationWatcher } from "@/components/notification-watcher";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useViewerMode } from "@/hooks/use-viewer-mode";
import { useNotificationActivation } from "@/hooks/use-notifications";
import { Menu } from "lucide-react";

// Each browser history entry records the drawer trail it shows, so browser
// Back/Forward (Alt+Left/Right, mouse buttons) walk the trail too.
function savedTrail(id: string | null): string[] | null {
  const saved: unknown = window.history.state?.beadTrail;
  return id && Array.isArray(saved) && saved[saved.length - 1] === id ? saved : null;
}
const startsWith = (ids: string[], prefix: string[]) =>
  prefix.length <= ids.length && prefix.every((id, i) => ids[i] === id);
const sameTrail = (a: unknown, b: string[]) => Array.isArray(a) && a.join(" ") === b.join(" ");
type Step = { dir: -1 | 1; from: string | null; until: number };
const pending = (step: Step | null): step is Step => !!step && Date.now() < step.until;

export function AppShell({ projectId }: { projectId: string }) {
  const [view, setView] = useLastView();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const { toggle: toggleTheme } = useTheme();
  // Drawer navigation TRAIL, not a single id: clicking a subtask from its
  // parent used to replace the drawer outright, leaving no way back (GH #15).
  // The visible bead is the last entry.
  //
  // Seeded from `?bead=<ID>` so a bead is URL-addressable (see the sync effect
  // below). Read during render rather than in a mount effect: the repo's React
  // Compiler lint forbids setState-in-effect, and the seed is safe to hydrate
  // with because the drawer's open state also depends on the bead being present
  // in `index` — react-query has no SSR prefetch here, so server and first
  // client render both see an empty index and render the drawer closed.
  const [openStack, setOpenStack] = React.useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const seed = new URLSearchParams(window.location.search).get("bead");
    return savedTrail(seed) ?? (seed ? [seed] : []);
  });
  const rawOpenId = openStack.length ? openStack[openStack.length - 1] : null;
  // The longer trail left by going back, which names the Forward step. Any
  // push since (a new link, a filter change) has dropped the browser's forward
  // entries: the ref is cleared then, and the state only counts on the entry
  // it was recorded for.
  const search = useSearchParams().toString();
  const [ahead, setAhead] = React.useState<{ ids: string[]; search: string } | null>(null);
  const aheadRef = React.useRef<string[] | null>(null);
  const aheadIds = ahead && ahead.search === search && ahead.ids.length > openStack.length
    && startsWith(ahead.ids, openStack) ? ahead.ids : null;
  const [selectedBeadId, selectBead] = React.useState<string | null>(null);
  const detailNonce = React.useRef(0);
  const [detailRequest, setDetailRequest] = React.useState<{
    id: string;
    action: DetailAction;
    nonce: number;
  } | null>(null);
  const [create, setCreate] = React.useState<{
    open: boolean;
    parent: string;
    type?: BeadType;
  }>({ open: false, parent: "" });

  const { data, isLoading, error } = useBeads(projectId);
  // Live push: refetch the moment this project's .beads/ mutates, instead of
  // waiting for the fallback poll interval. `live` drives the sidebar indicator.
  const { live } = useBeadsStream(projectId);
  const beads = React.useMemo(() => data?.beads ?? [], [data]);
  const index = React.useMemo(() => makeIndex(beads), [beads]);
  const viewerMode = useViewerMode();
  const readOnly = viewerMode.data?.readOnly ?? true;
  // Preserve the requested link until a successful response establishes whether
  // the bead exists. A network error must not erase a valid bookmark.
  const loaded = !isLoading && !error && !!data;
  const openId = rawOpenId && loaded && !index.has(rawOpenId) ? null : rawOpenId;
  const missingToasted = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!loaded) return;
    if (!rawOpenId || index.has(rawOpenId)) {
      missingToasted.current = null;
      return;
    }
    if (missingToasted.current === rawOpenId) return;
    missingToasted.current = rawOpenId;
    toast.error(`Bead ${rawOpenId} not found in this project`);
  }, [loaded, rawOpenId, index]);

  // RESET. Every caller outside the drawer (board, list, epics, activity,
  // needs-you, palette, assist panel) means "start here", not "continue a trail".
  const openDetail = React.useCallback((id: string, action: DetailAction = "view") => {
    selectBead(id);
    setOpenStack([id]);
    setDetailRequest({
      id,
      action: readOnly ? "view" : action,
      nonce: (detailNonce.current += 1),
    });
  }, [readOnly]);
  useNotificationActivation(projectId, openDetail);
  // PUSH. Drawer-internal navigation only, so back can return.
  const MAX_TRAIL = 25;
  const pushDetail = React.useCallback((id: string) => {
    if (openStack[openStack.length - 1] === id) return;
    selectBead(id);
    const next = [...openStack, id].slice(-MAX_TRAIL);
    setOpenStack(next);
    aheadRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.set("bead", id);
    window.history.pushState({ beadTrail: next }, "", `${url.pathname}${url.search}${url.hash}`);
    setDetailRequest({ id, action: "view", nonce: (detailNonce.current += 1) });
  }, [openStack]);
  const closeDetail = React.useCallback(() => {
    setOpenStack([]);
    setDetailRequest(null);
  }, []);

  // The drawer's own Back/Forward land on the bead they name, so they keep
  // stepping past entries where only the view or filters changed, and past
  // beads deleted since. `until` stops a step the browser had nowhere to take.
  const stepping = React.useRef<Step | null>(null);
  const stepDetail = React.useCallback((dir: -1 | 1) => {
    stepping.current = { dir, from: rawOpenId, until: Date.now() + 1000 };
    window.history.go(dir);
  }, [rawOpenId]);
  const backDetail = React.useCallback(() => stepDetail(-1), [stepDetail]);
  const forwardDetail = React.useCallback(() => stepDetail(1), [stepDetail]);

  const restore = React.useEffectEvent(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("bead");
    // Entries pushed outside the app carry no trail; keep ours if they show
    // the same bead, so an unsaved draft survives.
    const trail = savedTrail(id) ?? (id === rawOpenId ? openStack : id ? [id] : []);
    const kept = aheadRef.current;
    const known = kept && kept.length > openStack.length && startsWith(kept, openStack) ? kept : openStack;
    aheadRef.current = known.length > trail.length && startsWith(known, trail) ? known : null;
    setAhead(aheadRef.current && { ids: aheadRef.current, search: params.toString() });
    const step = stepping.current;
    stepping.current = null;
    if (pending(step) && id && (id === step.from || (loaded && !index.has(id)))) {
      stepping.current = step;
      window.history.go(step.dir);
      return;
    }
    if (!sameTrail(trail, openStack)) setOpenStack(trail);
    if (id === rawOpenId) return;
    setDetailRequest(null);
    selectBead(id);
  });
  // Subscribed once: Next renders the new entry inside its own popstate
  // listener, and a listener re-added during that event would miss it.
  React.useEffect(() => {
    const onPopState = () => restore();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Opening a bead from outside the drawer, or closing it, replaces the
  // current entry; only drawer links push one (pushDetail).
  React.useEffect(() => {
    if (pending(stepping.current)) return;
    const url = new URL(window.location.href);
    if (openId) url.searchParams.set("bead", openId);
    else url.searchParams.delete("bead");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current || !sameTrail(window.history.state?.beadTrail, openStack)) {
      window.history.replaceState({ ...window.history.state, beadTrail: openStack }, "", next);
    }
  }, [openId, openStack]);
  // View and filter changes push entries without a trail; give them the one
  // they were pushed from, so browser Back to them keeps it.
  React.useEffect(() => {
    if (pending(stepping.current) || Array.isArray(window.history.state?.beadTrail)) return;
    if (new URLSearchParams(window.location.search).get("bead") !== rawOpenId) return;
    aheadRef.current = null;
    window.history.replaceState({ ...window.history.state, beadTrail: openStack }, "");
  }, [search, rawOpenId, openStack]);
  const canGoBack = openStack.length > 1;

  // Alt+Left/Right step through browser history while the drawer is open, as
  // the browser itself would. Handled here because headless Chromium has no
  // such shortcut, and preventDefault stops a double step where it does.
  // Text fields keep them (word movement on macOS), as does a dialog above.
  React.useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTyping(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") window.history.back();
      else window.history.forward();
    };
    // Capture: the drawer's dialog stops arrow keys from bubbling to window.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openId]);
  // Options object rather than positional args so future presets (assignee,
  // priority) can be added without churning every call site again.
  const openCreate = React.useCallback(
    (opts: { parent?: string; type?: BeadType } = {}) => {
      if (readOnly) return;
      setCreate({ open: true, parent: opts.parent ?? "", type: opts.type });
    },
    [readOnly],
  );

  // Jump to the Epics screen and focus an epic (bead 55b). The nonce makes each
  // request distinct so clicking the same epic again re-triggers the scroll.
  const [focusEpic, setFocusEpic] = React.useState<{ id: string; nonce: number } | null>(null);
  const focusNonce = React.useRef(0);
  const clearFocusEpic = React.useCallback(() => setFocusEpic(null), []);
  const openEpic = React.useCallback(
    (epicId: string) => {
      setOpenStack([]); // close the detail drawer
      setDetailRequest(null);
      setView("epics");
      setFocusEpic({ id: epicId, nonce: (focusNonce.current += 1) });
    },
    [setView],
  );

  const openCreateFromKeyboard = React.useCallback(() => openCreate(), [openCreate]);
  const closeOverlays = React.useCallback(() => {
    setOpenStack([]);
    setDetailRequest(null);
    setCreate((current) => ({ ...current, open: false }));
  }, []);

  const errorMessage = error ? (error as Error).message : undefined;
  const setMobileView = React.useCallback((next: View) => {
    setView(next);
    setMobileNavOpen(false);
  }, [setView]);
  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 48rem)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileNavOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    <AppProvider
      value={{
        projectId,
        beads,
        index,
        meta: data?.meta,
        humanAllowlist: data?.meta?.humanAllowlist ?? [],
        readOnly,
        loading: isLoading,
        error: errorMessage,
        selectedBeadId,
        selectBead,
        openDetail,
        pushDetail,
        openCreate,
        openEpic,
      }}
    >
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground text-sm">
        <ReadOnlyBanner />
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-[var(--surface)] px-3 py-2 md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              type="button"
              aria-label="Open navigation and project menu"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <Menu size={18} aria-hidden="true" />
              <span className="sr-only">Open navigation and project menu</span>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[min(88vw,300px)] max-w-[88vw] gap-0 overflow-hidden border-r border-border bg-[var(--surface)] p-0"
            >
              <SheetTitle className="sr-only">Project and view navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Choose a project or review view.
              </SheetDescription>
              <Sidebar
                mobile
                view={view}
                onView={setMobileView}
                kind={data?.meta?.kind}
                projectId={projectId}
                live={live}
                onProjectNavigate={() => setMobileNavOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--text)]">
            Bead Me Up Scotty
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          view={view}
          onView={setView}
          kind={data?.meta?.kind}
          projectId={projectId}
          live={live}
        />
        <main className="relative flex min-w-0 flex-1 flex-col">
          {errorMessage && view !== "settings" ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
                <p className="text-sm font-medium text-destructive">Couldn’t open this project</p>
                <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
                <Link
                  href="/"
                  className="mt-4 inline-block rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  ← Back to projects
                </Link>
              </div>
            </div>
          ) : (
            <>
              {view === "board" && <Board />}
              {view === "list" && <ListView />}
              {view === "epics" && (
                <EpicsView focusEpic={focusEpic} onFocusHandledAction={clearFocusEpic} />
              )}
              {view === "focus" && <FocusView />}
              {view === "graph" && <GraphView />}
              {view === "insights" && <InsightsView />}
              {view === "activity" && <ActivityView />}
              {view === "needsyou" && <NeedsYouView />}
              {view === "achievements" && <AchievementsView />}
              {view === "publish" && <PublishView />}
              {view === "settings" && <SettingsView />}
            </>
          )}

          <BeadDetailDrawer
            openId={openId}
            initialAction={detailRequest?.id === openId ? detailRequest.action : "view"}
            actionNonce={detailRequest?.id === openId ? detailRequest.nonce : 0}
            canGoBack={canGoBack}
            backTo={canGoBack ? openStack[openStack.length - 2] : null}
            onBack={backDetail}
            forwardTo={aheadIds ? aheadIds[openStack.length] : null}
            onForward={forwardDetail}
            onClose={closeDetail}
          />
        </main>
        </div>
      </div>

      <CreateBeadModal
        open={create.open && !readOnly}
        parent={create.parent}
        type={create.type}
        onOpenChange={(o) => setCreate((c) => ({ ...c, open: o }))}
      />

      <KeyboardLayer
        projectId={projectId}
        readOnly={readOnly}
        selectedId={selectedBeadId}
        selectIdAction={selectBead}
        setViewAction={setView}
        openDetailAction={openDetail}
        openCreateAction={openCreateFromKeyboard}
        closeOverlaysAction={closeOverlays}
        toggleThemeAction={toggleTheme}
      />
      <NotificationWatcher projectId={projectId} />
    </AppProvider>
  );
}
