"use client";
import * as React from "react";
import { type BeadType } from "@/lib/schema";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBeads } from "@/hooks/use-beads";
import { useBeadsStream } from "@/hooks/use-beads-stream";
import { useLastView } from "@/hooks/use-last-view";
import { useUrlState } from "@/hooks/use-url-state";
import { useTheme } from "@/components/theme-provider";
import { makeIndex } from "@/lib/beads-view";
import { AppProvider, type DetailAction } from "@/components/app-context";
import { isView, type View } from "@/lib/views";
import { Sidebar } from "@/components/sidebar";
import { Board } from "@/components/board/board";
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
import { NotificationWatcher } from "@/components/notification-watcher";

export function AppShell({ projectId }: { projectId: string }) {
  const [lastView, rememberView] = useLastView(projectId);
  const pathname = usePathname();
  const { searchParams, updateLocation, updateUrl } = useUrlState();
  const projectPath = `/p/${encodeURIComponent(projectId)}`;
  const pathTail = pathname.startsWith(`${projectPath}/`)
    ? pathname.slice(projectPath.length + 1).split("/")[0]
    : null;
  const requestedView = isView(pathTail) ? pathTail : null;
  const legacyView = searchParams.get("view");
  const view = requestedView ?? (isView(legacyView) ? legacyView : lastView);
  const issueId = searchParams.get("issue");
  const setView = React.useCallback(
    (nextView: View) => {
      rememberView(nextView);
      updateLocation((url) => {
        url.pathname = `${projectPath}/${nextView}`;
        url.searchParams.delete("view");
      });
    },
    [projectPath, rememberView, updateLocation],
  );

  // Upgrade old bare/query-string URLs and repair unknown view segments while
  // retaining the per-project default used by old bookmarks.
  React.useEffect(() => {
    if (requestedView === view && legacyView === null) return;
    updateLocation((url) => {
      url.pathname = `${projectPath}/${view}`;
      url.searchParams.delete("view");
    }, "replace");
  }, [legacyView, projectPath, requestedView, updateLocation, view]);

  // Path navigation can also come from browser back/forward, so keep the old
  // per-project default aligned with whichever route is actually active.
  React.useEffect(() => {
    if (requestedView) rememberView(requestedView);
  }, [rememberView, requestedView]);

  const { toggle: toggleTheme } = useTheme();
  // Drawer navigation TRAIL, not a single id: clicking a subtask from its
  // parent used to replace the drawer outright, leaving no way back (GH #15).
  // The URL's issue is authoritative; the stack only names the drawer's custom
  // back destination.
  const [openStack, setOpenStack] = React.useState<string[]>(() =>
    issueId ? [issueId] : [],
  );
  // Mirrors openStack so handlers can pop from the newest value rather than the
  // one captured when they were last rendered.
  const openStackRef = React.useRef(openStack);
  React.useEffect(() => {
    openStackRef.current = openStack;
  }, [openStack]);
  const openId = issueId;
  const [selectedBeadId, selectBead] = React.useState<string | null>(issueId);
  const previousUrlIssue = React.useRef(issueId);
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

  // Back/forward and direct URL navigation drive the drawer and selection.
  React.useEffect(() => {
    if (previousUrlIssue.current === issueId) return;
    previousUrlIssue.current = issueId;
    selectBead(issueId);
    setOpenStack((stack) => {
      if (!issueId) return [];
      const previousIndex = stack.lastIndexOf(issueId);
      return previousIndex >= 0 ? stack.slice(0, previousIndex + 1) : [issueId];
    });
    if (issueId) {
      setDetailRequest({
        id: issueId,
        action: "view",
        nonce: (detailNonce.current += 1),
      });
    }
  }, [issueId]);

  const setIssueInUrl = React.useCallback(
    (id: string | null, mode: "push" | "replace" = "push") => {
      previousUrlIssue.current = id;
      updateUrl((params) => {
        if (id) params.set("issue", id);
        else params.delete("issue");
      }, mode);
    },
    [updateUrl],
  );

  // RESET. Every caller outside the drawer (board, list, epics, activity,
  // needs-you, palette, assist panel) means "start here", not "continue a trail".
  const openDetail = React.useCallback(
    (id: string, action: DetailAction = "view") => {
      selectBead(id);
      setOpenStack([id]);
      setDetailRequest({ id, action, nonce: (detailNonce.current += 1) });
      setIssueInUrl(id);
    },
    [setIssueInUrl],
  );
  // PUSH. Drawer-internal navigation only, so back can return.
  const MAX_TRAIL = 25;
  const pushDetail = React.useCallback(
    (id: string) => {
      selectBead(id);
      setOpenStack((stack) => {
        if (stack[stack.length - 1] === id) return stack;
        const next = [...stack, id];
        return next.length > MAX_TRAIL
          ? next.slice(next.length - MAX_TRAIL)
          : next;
      });
      setDetailRequest({
        id,
        action: "view",
        nonce: (detailNonce.current += 1),
      });
      setIssueInUrl(id);
    },
    [setIssueInUrl],
  );
  const closeDetail = React.useCallback(() => {
    selectBead(null);
    setOpenStack([]);
    setIssueInUrl(null);
  }, [setIssueInUrl]);
  // POP. Skips entries whose bead has since been deleted/archived away, so back
  // can never land on an empty drawer; if nothing valid remains, it closes.
  // Reads the stack through a ref rather than the render closure, so a burst of
  // clicks pops one entry each instead of all recomputing from the same stale
  // array. The URL write has to stay outside a state updater (those must be
  // pure), hence the ref rather than a functional setOpenStack.
  const backDetail = React.useCallback(() => {
    const next = openStackRef.current.slice(0, -1);
    while (next.length && !index.has(next[next.length - 1])) next.pop();
    openStackRef.current = next;
    setOpenStack(next);
    const id = next[next.length - 1] ?? null;
    selectBead(id);
    if (id) {
      setDetailRequest({
        id,
        action: "view",
        nonce: (detailNonce.current += 1),
      });
    }
    setIssueInUrl(id);
  }, [index, setIssueInUrl]);
  // Options object rather than positional args so future presets (assignee,
  // priority) can be added without churning every call site again.
  const openCreate = React.useCallback(
    (opts: { parent?: string; type?: BeadType } = {}) =>
      setCreate({ open: true, parent: opts.parent ?? "", type: opts.type }),
    [],
  );

  // Jump to the Epics screen and focus an epic (bead 55b). The nonce makes each
  // request distinct so clicking the same epic again re-triggers the scroll.
  const [focusEpic, setFocusEpic] = React.useState<{ id: string; nonce: number } | null>(null);
  const focusNonce = React.useRef(0);
  const clearFocusEpic = React.useCallback(() => setFocusEpic(null), []);
  const openEpic = React.useCallback(
    (epicId: string) => {
      previousUrlIssue.current = null;
      selectBead(null);
      setOpenStack([]); // close the detail drawer
      rememberView("epics");
      updateLocation((url) => {
        url.pathname = `${projectPath}/epics`;
        url.searchParams.delete("view");
        url.searchParams.delete("issue");
      });
      setFocusEpic({ id: epicId, nonce: (focusNonce.current += 1) });
    },
    [projectPath, rememberView, updateLocation],
  );

  const openCreateFromKeyboard = React.useCallback(
    () => openCreate(),
    [openCreate],
  );
  const closeOverlays = React.useCallback(() => {
    closeDetail();
    setCreate((current) => ({ ...current, open: false }));
  }, [closeDetail]);

  const errorMessage = error ? (error as Error).message : undefined;

  return (
    <AppProvider
      value={{
        projectId,
        beads,
        index,
        meta: data?.meta,
        humanAllowlist: data?.meta?.humanAllowlist ?? [],
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
      <div className="flex h-full overflow-hidden bg-background text-foreground text-sm">
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
                <EpicsView
                  focusEpic={focusEpic}
                  onFocusHandledAction={clearFocusEpic}
                />
              )}
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
            initialAction={
              detailRequest?.id === openId ? detailRequest.action : "view"
            }
            actionNonce={detailRequest?.id === openId ? detailRequest.nonce : 0}
            canGoBack={openStack.length > 1}
            backTo={openStack.length > 1 ? openStack[openStack.length - 2] : null}
            onBack={backDetail}
            onClose={closeDetail}
          />
        </main>
      </div>

      <CreateBeadModal
        open={create.open}
        parent={create.parent}
        type={create.type}
        onOpenChange={(o) => setCreate((c) => ({ ...c, open: o }))}
      />

      <KeyboardLayer
        projectId={projectId}
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
