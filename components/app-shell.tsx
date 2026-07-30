"use client";
import * as React from "react";
import { type BeadType } from "@/lib/schema";
import Link from "next/link";
import { useBeads } from "@/hooks/use-beads";
import { useBeadsStream } from "@/hooks/use-beads-stream";
import { useLastView } from "@/hooks/use-last-view";
import { useTheme } from "@/components/theme-provider";
import { makeIndex } from "@/lib/beads-view";
import { AppProvider, type DetailAction } from "@/components/app-context";
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
  const [view, setView] = useLastView(projectId);
  const { toggle: toggleTheme } = useTheme();
  // Drawer navigation TRAIL, not a single id: clicking a subtask from its
  // parent used to replace the drawer outright, leaving no way back (GH #15).
  // The visible bead is the last entry.
  const [openStack, setOpenStack] = React.useState<string[]>([]);
  const openId = openStack.length ? openStack[openStack.length - 1] : null;
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

  // RESET. Every caller outside the drawer (board, list, epics, activity,
  // needs-you, palette, assist panel) means "start here", not "continue a trail".
  const openDetail = React.useCallback((id: string, action: DetailAction = "view") => {
    selectBead(id);
    setOpenStack([id]);
    setDetailRequest({ id, action, nonce: (detailNonce.current += 1) });
  }, []);
  // PUSH. Drawer-internal navigation only, so back can return.
  const MAX_TRAIL = 25;
  const pushDetail = React.useCallback((id: string) => {
    selectBead(id);
    setOpenStack((s) => {
      if (s[s.length - 1] === id) return s; // re-clicking the current bead is a no-op
      const next = [...s, id];
      return next.length > MAX_TRAIL ? next.slice(next.length - MAX_TRAIL) : next;
    });
    setDetailRequest({ id, action: "view", nonce: (detailNonce.current += 1) });
  }, []);
  const closeDetail = React.useCallback(() => setOpenStack([]), []);
  // POP. Skips entries whose bead has since been deleted/archived away, so back
  // can never land on an empty drawer; if nothing valid remains, it closes.
  const backDetail = React.useCallback(() => {
    const next = openStack.slice(0, -1);
    while (next.length && !index.has(next[next.length - 1])) next.pop();
    const id = next[next.length - 1];
    setOpenStack(next);
    if (id) {
      selectBead(id);
      setDetailRequest({ id, action: "view", nonce: (detailNonce.current += 1) });
    }
  }, [index, openStack]);
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
      setOpenStack([]); // close the detail drawer
      setView("epics");
      setFocusEpic({ id: epicId, nonce: (focusNonce.current += 1) });
    },
    [setView],
  );

  const openCreateFromKeyboard = React.useCallback(() => openCreate(), [openCreate]);
  const closeOverlays = React.useCallback(() => {
    setOpenStack([]);
    setCreate((current) => ({ ...current, open: false }));
  }, []);

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
                <EpicsView focusEpic={focusEpic} onFocusHandledAction={clearFocusEpic} />
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
            initialAction={detailRequest?.id === openId ? detailRequest.action : "view"}
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
