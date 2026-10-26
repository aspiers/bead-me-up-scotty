"use client";

import * as React from "react";
import { AppProvider, type AppContextValue, type DetailAction, type View } from "@/components/app-context";
import { CommandPalette, type PalettePage } from "@/components/command-palette";
import { KeyboardHelpDialog } from "@/components/keyboard-help-dialog";
import { useTheme } from "@/components/theme-provider";
import { useAppKeyboardShortcuts } from "@/hooks/use-app-keyboard";
import { useViewerMode } from "@/hooks/use-viewer-mode";
import type { ShortcutScope } from "@/lib/keyboard-shortcuts";

export function KeyboardLayer({
  projectId,
  scope,
  readOnly,
  selectedId,
  openId = null,
  selectIdAction,
  setViewAction,
  openDetailAction,
  openCreateAction,
  closeOverlaysAction,
  toggleThemeAction,
}: {
  /** Null outside a project. */
  projectId: string | null;
  scope: ShortcutScope;
  readOnly: boolean;
  selectedId: string | null;
  /** The bead open in the drawer, which y copies; pages without a drawer omit it. */
  openId?: string | null;
  selectIdAction: (id: string | null) => void;
  setViewAction: (view: View) => void;
  openDetailAction: (id: string, action?: DetailAction) => void;
  openCreateAction: () => void;
  closeOverlaysAction: () => void;
  toggleThemeAction: () => void;
}) {
  const [helpOpen, setHelpOpen] = React.useState(false);
  const paletteNonce = React.useRef(0);
  const [paletteRequest, setPaletteRequest] = React.useState<{
    open: boolean;
    page: PalettePage;
    beadId: string | null;
    nonce: number;
  }>({ open: false, page: "root", beadId: null, nonce: 0 });

  const openPalette = React.useCallback((page: PalettePage = "root", beadId?: string) => {
    if (readOnly && (page === "status" || page === "priority")) return;
    setPaletteRequest((current) => ({
      open: page === "root" && !beadId && current.open ? false : true,
      page,
      beadId: beadId ?? null,
      nonce: (paletteNonce.current += 1),
    }));
  }, [readOnly]);
  const closeAll = React.useCallback(() => {
    setPaletteRequest((current) => ({ ...current, open: false }));
    setHelpOpen(false);
    closeOverlaysAction();
  }, [closeOverlaysAction]);

  const actions = React.useMemo(
    () => ({
      projectId,
      readOnly,
      selectedId,
      openId,
      selectId: selectIdAction,
      setView: setViewAction,
      openDetail: openDetailAction,
      openCreate: openCreateAction,
      openPalette,
      openHelp: () => setHelpOpen(true),
      closeOverlays: closeAll,
      toggleTheme: toggleThemeAction,
    }),
    [
      projectId,
      readOnly,
      selectedId,
      openId,
      selectIdAction,
      setViewAction,
      openDetailAction,
      openCreateAction,
      openPalette,
      closeAll,
      toggleThemeAction,
    ],
  );
  useAppKeyboardShortcuts(actions);

  return (
    <>
      <CommandPalette
        key={`${paletteRequest.nonce}-${readOnly ? "ro" : "rw"}`}
        open={paletteRequest.open}
        onOpenChangeAction={(open) =>
          setPaletteRequest((current) => ({ ...current, open }))
        }
        onViewAction={projectId === null ? undefined : setViewAction}
        initialPage={paletteRequest.page}
        initialBeadId={paletteRequest.beadId}
      />
      <KeyboardHelpDialog open={helpOpen} onOpenChangeAction={setHelpOpen} scope={scope} />
    </>
  );
}

const noop = () => {};
const NO_BEADS: AppContextValue = {
  projectId: "",
  beads: [],
  index: new Map(),
  humanAllowlist: [],
  readOnly: true,
  loading: false,
  selectedBeadId: null,
  selectBead: noop,
  openDetail: noop,
  pushDetail: noop,
  peekDetail: noop,
  replaceDetail: noop,
  openCreate: noop,
  openEpic: noop,
};

/**
 * The keyboard layer for pages outside a project. `app` is the project the
 * bead keys and the palette's bead pages act in, such as the project of the
 * selected Needs You row; without one the palette has no beads to offer.
 */
export function GlobalKeyboardLayer({
  scope,
  app,
  selectedId = null,
  openDetailAction = noop,
}: {
  scope: Exclude<ShortcutScope, "project">;
  app?: AppContextValue;
  selectedId?: string | null;
  openDetailAction?: (id: string, action?: DetailAction) => void;
}) {
  const { toggle } = useTheme();
  const readOnly = useViewerMode().data?.readOnly ?? true;
  return (
    <AppProvider value={app ?? NO_BEADS}>
      <KeyboardLayer
        projectId={null}
        scope={scope}
        readOnly={readOnly}
        selectedId={selectedId}
        // Rows select themselves when focused, which is how J/K move.
        selectIdAction={noop}
        setViewAction={noop}
        openDetailAction={openDetailAction}
        openCreateAction={noop}
        closeOverlaysAction={noop}
        toggleThemeAction={toggle}
      />
    </AppProvider>
  );
}
