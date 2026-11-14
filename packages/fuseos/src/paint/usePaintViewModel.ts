import { useCallback, useContext, useEffect, useMemo } from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";
import type { PaintWindowContent, WindowState } from "../state/appState";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import { createPaintControls } from "./paintControls";
import { PaintDepsContext } from "./paintDepsContext";
import { PaintRegistryContext } from "./paintRegistryContext";
import type { PaintDialog, PaintState } from "./paintState";
import { PaintStateContext } from "./paintStateContext";
import type { PaintTool, Point, Size } from "./paintTools";

/** What File > Open and File > Save say until Phase B (B5) wires local files in. */
export const LOCAL_FILES_NOTICE =
  "Opening and saving files on this computer arrives in a later update. Set As Wallpaper keeps a drawing on the desktop meanwhile.";

export type PaintViewModel = {
  windowId: string;
  /** Name of the file on the canvas; undefined for a fresh drawing. */
  fileName: string | undefined;
  tool: PaintTool;
  brushSize: number;
  foreground: string;
  background: string;
  size: Size;
  dirty: boolean;
  canUndo: boolean;
  status: string;
  dialog: PaintDialog;
  setTool: (tool: PaintTool) => void;
  setBrushSize: (size: number) => void;
  setForeground: (color: string) => void;
  setBackground: (color: string) => void;
  /** Called with the canvas element when it mounts and null when it unmounts. */
  attachCanvas: (canvas: HTMLCanvasElement | null) => void;
  pointerDown: (at: Point, button: number) => void;
  pointerMove: (at: Point) => void;
  pointerUp: (at: Point) => void;
  undo: () => void;
  clear: () => void;
  flip: (axis: "horizontal" | "vertical") => void;
  rotate: () => void;
  newImage: () => void;
  /** File > Open. */
  openImage: () => void;
  /** File > Save and Save As. */
  save: () => void;
  confirmDiscard: () => void;
  closeDialog: () => void;
  /** The Text dialog's field: replaces its draft as the user types. */
  setDialogText: (text: string) => void;
  /** OK on the Text dialog: draws the typed text at the recorded point and closes it. */
  submitText: () => void;
  /** Cancel on the Text dialog: closes it without drawing. */
  cancelText: () => void;
  setAsWallpaper: () => void;
  close: () => void;
};

function contentOf(window: WindowState | undefined): PaintWindowContent {
  return window?.kind === "paint" ? window : { kind: "paint" };
}

/**
 * Business logic of one Paint window over the per window PaintStateProvider. The toolbox, palette and canvas
 * go through `PaintControls`, which the window also publishes in the Paint registry so the Office Assistant
 * can drive the very same thing; the store's shadow keeps a tool change visible to the next pointer event
 * before React re-renders.
 */
export function usePaintViewModel(windowId: string): PaintViewModel {
  const store = useContext(PaintStateContext);
  if (!store) throw new Error("usePaintViewModel needs a PaintStateProvider");
  const { state, dispatch, session, shadow } = store;
  const { state: appState, dispatch: appDispatch } = useAppState();
  const commands = useWindowCommands();
  const deps = useContext(PaintDepsContext);
  const registry = useContext(PaintRegistryContext);
  const ui = useContext(DesktopUiContext);

  const content = contentOf(
    appState.windows.find((window) => window.id === windowId),
  );
  const fileName = content.fileName;

  const setFile = useCallback(
    (next: string | undefined) =>
      appDispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "paint" ? { ...window, fileName: next } : window,
      }),
    [appDispatch, windowId],
  );
  const openFile = useCallback(
    () => commands.showInfo("Paint", LOCAL_FILES_NOTICE),
    [commands],
  );

  const setDialog = useCallback(
    (dialog: PaintDialog) => dispatch({ type: "dialog", dialog }),
    [dispatch],
  );
  const changed = useCallback(
    (size?: Size) =>
      dispatch({ type: "changed", undoDepth: session.undoDepth, size }),
    [dispatch, session],
  );
  const controls = useMemo(
    () =>
      createPaintControls({
        session,
        getState: () => shadow.getState(),
        dispatch,
        setFile,
        openFile,
      }),
    [session, shadow, dispatch, setFile, openFile],
  );

  // Publish the live controls so the Office Assistant sees and drives this window like the mouse does.
  useEffect(() => {
    registry.set(windowId, controls);
    return () => {
      registry.delete(windowId);
    };
  }, [registry, windowId, controls]);

  const attachCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas) {
        session.attach(deps.createSurface(canvas));
        dispatch({ type: "loaded", key: undefined, size: session.size() });
      } else {
        session.detach();
      }
    },
    [session, deps, dispatch],
  );

  return {
    windowId,
    fileName,
    tool: state.tool,
    brushSize: state.brushSize,
    foreground: state.foreground,
    background: state.background,
    size: state.size,
    dirty: state.dirty,
    canUndo: state.undoDepth > 0,
    status: state.status,
    dialog: state.dialog,
    setTool: controls.setTool,
    setBrushSize: controls.setBrushSize,
    setForeground: controls.setForeground,
    setBackground: controls.setBackground,
    attachCanvas,
    pointerDown: controls.pointerDown,
    pointerMove: controls.pointerMove,
    pointerUp: controls.pointerUp,
    undo: () => {
      if (session.undo())
        dispatch({
          type: "undone",
          undoDepth: session.undoDepth,
          size: session.size(),
        });
    },
    clear: () => {
      session.clear(state.background);
      changed();
    },
    flip: (axis) => {
      session.flip(axis);
      changed();
    },
    rotate: () => {
      session.rotate();
      changed(session.size());
    },
    newImage: controls.newImage,
    openImage: controls.openImage,
    save: () => commands.showInfo("Paint", LOCAL_FILES_NOTICE),
    confirmDiscard: controls.confirmDiscard,
    closeDialog: () => setDialog({ kind: "none" }),
    setDialogText: controls.setDialogText,
    submitText: controls.submitText,
    cancelText: controls.cancelText,
    setAsWallpaper: () => {
      const url = session.toDataUrl("image/jpeg");
      if (url) {
        ui.setWallpaper(url, "paint");
        dispatch({
          type: "status",
          status: "The drawing is now the desktop wallpaper.",
        });
      }
    },
    close: () => commands.close(windowId),
  };
}

export function isPaintState(value: unknown): value is PaintState {
  return (
    typeof value === "object" &&
    value !== null &&
    "tool" in value &&
    "dialog" in value
  );
}
