import type { PaintSession } from "./paintSession";
import type { PaintAction, PaintDialog, PaintState } from "./paintState";
import type { PaintTool, Point, Size } from "./paintTools";
import { DEFAULT_CANVAS_SIZE, PAINT_TOOLS } from "./paintTools";

/** What a Paint window is doing right now: the toolbox, the palette, the canvas and the dialog it shows. */
export type PaintStatus = {
  size: Size;
  tool: PaintTool;
  brushSize: number;
  foreground: string;
  background: string;
  unsaved: boolean;
  canUndo: boolean;
  dialog: PaintDialog["kind"];
};

/**
 * Everything that drives one Paint window the way the mouse does: the toolbox, the
 * palette, the pointer on the canvas and File > New / Open. The window's view model
 * and the Office Assistant share one instance, so a scripted drawing goes through exactly the
 * session and reducer path a user does (undo, shape previews, the unsaved flag).
 */
export interface PaintControls {
  status(): PaintStatus;
  setTool(tool: PaintTool): void;
  setBrushSize(size: number): void;
  setForeground(color: string): void;
  setBackground(color: string): void;
  /** Pointer down on the canvas; with the Text tool, `text` places it right away instead of opening the Text dialog. */
  pointerDown(at: Point, button: number, options?: { text?: string }): void;
  pointerMove(at: Point): void;
  pointerUp(at: Point): void;
  /** File > New: a blank canvas, or the discard confirmation when there are unsaved changes. */
  newImage(): void;
  /** File > Open: the discard confirmation when there are unsaved changes, else `openFile` right away. */
  openImage(): void;
  /** Yes to the discard confirmation: the pending New or Open goes ahead. */
  confirmDiscard(): void;
  /** Types into the open Text dialog's field, replacing its draft; a no-op when no Text dialog is showing. */
  setDialogText(text: string): void;
  /** OK on the Text dialog: places the typed text at the recorded point, one undo step; blank text draws nothing. Closes the dialog either way. */
  submitText(): void;
  /** Cancel on the Text dialog: closes it without drawing. */
  cancelText(): void;
}

export type PaintControlsDeps = {
  session: PaintSession;
  /** The current reducer state, kept in step with every dispatch so a tool change is seen by the next pointer event. */
  getState: () => PaintState;
  dispatch: (action: PaintAction) => void;
  /** The file name the window is on (persisted in the window); undefined for a fresh drawing. */
  setFile: (name: string | undefined) => void;
  /** Starts File > Open: Phase B (B5) picks a local image here. */
  openFile: () => void;
};

export function createPaintControls(deps: PaintControlsDeps): PaintControls {
  const { session, getState, dispatch, setFile, openFile } = deps;
  const changed = (size?: Size) =>
    dispatch({ type: "changed", undoDepth: session.undoDepth, size });
  const startNew = () => {
    session.newImage(DEFAULT_CANVAS_SIZE, getState().background);
    setFile(undefined);
    dispatch({ type: "loaded", key: undefined, size: DEFAULT_CANVAS_SIZE });
  };
  return {
    status() {
      const state = getState();
      return {
        size: state.size,
        tool: state.tool,
        brushSize: state.brushSize,
        foreground: state.foreground,
        background: state.background,
        unsaved: state.dirty,
        canUndo: state.undoDepth > 0,
        dialog: state.dialog.kind,
      };
    },
    setTool(tool) {
      dispatch({ type: "setTool", tool });
      dispatch({
        type: "status",
        status: PAINT_TOOLS.find((item) => item.tool === tool)?.label ?? "",
      });
    },
    setBrushSize(size) {
      dispatch({ type: "setBrushSize", size });
    },
    setForeground(color) {
      dispatch({ type: "setForeground", color });
    },
    setBackground(color) {
      dispatch({ type: "setBackground", color });
    },
    pointerDown(at, button, options) {
      const state = getState();
      if (state.tool === "text") {
        const color = button === 2 ? state.background : state.foreground;
        if (options?.text !== undefined) {
          // A script gives the text directly: place it without opening the Text dialog.
          if (session.placeText(at, options.text, color)) changed();
        } else {
          dispatch({
            type: "dialog",
            dialog: { kind: "text", at, color, text: "" },
          });
        }
        return;
      }
      const result = session.begin(state.tool, at, button, {
        foreground: state.foreground,
        background: state.background,
        brushSize: state.brushSize,
      });
      if (result.picked)
        dispatch({
          type: button === 2 ? "setBackground" : "setForeground",
          color: result.picked,
        });
      if (result.changed) changed();
    },
    pointerMove(at) {
      session.move(at);
    },
    pointerUp(at) {
      if (session.end(at)) changed();
    },
    newImage() {
      if (getState().dirty)
        dispatch({
          type: "dialog",
          dialog: { kind: "confirmDiscard", next: "new" },
        });
      else startNew();
    },
    openImage() {
      if (getState().dirty)
        dispatch({
          type: "dialog",
          dialog: { kind: "confirmDiscard", next: "open" },
        });
      else openFile();
    },
    confirmDiscard() {
      const dialog = getState().dialog;
      if (dialog.kind !== "confirmDiscard") return;
      dispatch({ type: "dialog", dialog: { kind: "none" } });
      if (dialog.next === "new") startNew();
      else openFile();
    },
    setDialogText(text) {
      const dialog = getState().dialog;
      if (dialog.kind !== "text") return;
      dispatch({ type: "dialog", dialog: { ...dialog, text } });
    },
    submitText() {
      const dialog = getState().dialog;
      if (dialog.kind !== "text") return;
      dispatch({ type: "dialog", dialog: { kind: "none" } });
      if (session.placeText(dialog.at, dialog.text, dialog.color)) changed();
    },
    cancelText() {
      const dialog = getState().dialog;
      if (dialog.kind !== "text") return;
      dispatch({ type: "dialog", dialog: { kind: "none" } });
    },
  };
}
