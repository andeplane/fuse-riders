import { useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";
import type { PaintWindowContent, WindowState } from "../state/appState";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import { createPaintControls } from "./paintControls";
import { PaintDepsContext } from "./paintDepsContext";
import type { PaintFile } from "./paintFileActions";
import { createPaintFileActions } from "./paintFileActions";
import { PaintPrefsStoreContext } from "./paintPrefsStore";
import { PaintRegistryContext } from "./paintRegistryContext";
import type { PaintDialog, PaintState } from "./paintState";
import { PaintStateContext } from "./paintStateContext";
import type { ImageMimeType, PaintTool, Point, Size } from "./paintTools";
import { mimeTypeForName } from "./paintTools";

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
  /** What the Save As dialog starts with: the current name (or `untitled`) and the format last saved in. */
  saveDefaults: { name: string; format: ImageMimeType };
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
  /** File > Open: the discard confirmation when there are unsaved changes, then the browser's file picker. */
  openImage: () => void;
  /** File > Save: downloads under the current name, or opens Save As for an untitled drawing. */
  save: () => void;
  /** File > Save As: the name and format dialog. */
  showSaveAs: () => void;
  /** Save on the Save As dialog: encodes the canvas and downloads it. */
  requestSave: (name: string, mimeType: ImageMimeType) => void;
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
 * before React re-renders. Files go through `PaintFileActions` over the injected `PaintDeps.files`.
 */
export function usePaintViewModel(windowId: string): PaintViewModel {
  const store = useContext(PaintStateContext);
  if (!store) throw new Error("usePaintViewModel needs a PaintStateProvider");
  const { state, dispatch, session, shadow } = store;
  const { state: appState, dispatch: appDispatch } = useAppState();
  const commands = useWindowCommands();
  const deps = useContext(PaintDepsContext);
  const prefs = useContext(PaintPrefsStoreContext);
  const registry = useContext(PaintRegistryContext);
  const ui = useContext(DesktopUiContext);

  const content = contentOf(
    appState.windows.find((window) => window.id === windowId),
  );
  const fileName = content.fileName;
  const sourceUrl = content.sourceUrl;

  const setFile = useCallback(
    (next: PaintFile | undefined) =>
      appDispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "paint"
            ? { ...window, fileName: next?.name, sourceUrl: next?.sourceUrl }
            : window,
      }),
    [appDispatch, windowId],
  );
  const showError = useCallback(
    (message: string) => commands.showError("Paint", message),
    [commands],
  );
  const fileActions = useMemo(
    () =>
      createPaintFileActions({
        session,
        files: deps.files,
        prefs,
        dispatch,
        setFile,
        showError,
      }),
    [session, deps, prefs, dispatch, setFile, showError],
  );
  const openFile = useCallback(
    () => void fileActions.openPicked(),
    [fileActions],
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
        setFile: (name) => setFile(name === undefined ? undefined : { name }),
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

  // A window opened on a URL (Explorer, a deep link) fetches it once the canvas is there; each URL is loaded once
  // per mount, so no re-render or dependency change can fetch it again.
  const loadedUrl = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!sourceUrl || loadedUrl.current === sourceUrl) return;
    loadedUrl.current = sourceUrl;
    void fileActions.openUrl(sourceUrl, fileName ?? "untitled");
  }, [sourceUrl, fileName, fileActions]);

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

  const requestSave = (name: string, mimeType: ImageMimeType) =>
    void fileActions.saveAs(name, mimeType);

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
    saveDefaults: {
      name: fileName ?? "untitled",
      format: prefs.get().format ?? "image/png",
    },
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
    save: () => {
      if (fileName) requestSave(fileName, mimeTypeForName(fileName));
      else setDialog({ kind: "saveAs" });
    },
    showSaveAs: () => setDialog({ kind: "saveAs" }),
    requestSave,
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
