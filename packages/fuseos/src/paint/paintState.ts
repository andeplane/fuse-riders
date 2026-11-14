import type { PaintTool, Point, Size } from "./paintTools";
import { DEFAULT_CANVAS_SIZE } from "./paintTools";

/** The Win98 dialog a Paint window is showing, if any. Transient, never persisted. */
export type PaintDialog =
  | { kind: "none" }
  /** Discard the changes before New or Open. */
  | { kind: "confirmDiscard"; next: "new" | "open" }
  /** The Text tool was clicked at `at`; `color` is the foreground or background at click time, `text` the draft typed so far. */
  | { kind: "text"; at: Point; color: string; text: string }
  | { kind: "busy"; message: string };

export type PaintState = {
  tool: PaintTool;
  brushSize: number;
  foreground: string;
  background: string;
  /** Unsaved changes since the last load, save or new image. */
  dirty: boolean;
  undoDepth: number;
  size: Size;
  /** Name of the file currently on the canvas; undefined for a fresh drawing. */
  loadedKey: string | undefined;
  dialog: PaintDialog;
  status: string;
};

export const DEFAULT_STATUS = "For Help, click Help Topics on the Help Menu.";

export const INITIAL_PAINT_STATE: PaintState = {
  tool: "pencil",
  brushSize: 5,
  foreground: "#000000",
  background: "#ffffff",
  dirty: false,
  undoDepth: 0,
  size: DEFAULT_CANVAS_SIZE,
  loadedKey: undefined,
  dialog: { kind: "none" },
  status: DEFAULT_STATUS,
};

export type PaintAction =
  | { type: "setTool"; tool: PaintTool }
  | { type: "setBrushSize"; size: number }
  | { type: "setForeground"; color: string }
  | { type: "setBackground"; color: string }
  /** The canvas changed by a user action; `size` when the operation changed it. */
  | { type: "changed"; undoDepth: number; size?: Size }
  | { type: "undone"; undoDepth: number; size: Size }
  /** A file (or a blank image) now fills the canvas; nothing to undo or save. */
  | { type: "loaded"; key: string | undefined; size: Size }
  | { type: "saved"; key: string; name: string }
  | { type: "dialog"; dialog: PaintDialog }
  | { type: "status"; status: string };

export function paintReducer(
  state: PaintState,
  action: PaintAction,
): PaintState {
  switch (action.type) {
    case "setTool":
      return { ...state, tool: action.tool };
    case "setBrushSize":
      return { ...state, brushSize: action.size };
    case "setForeground":
      return { ...state, foreground: action.color };
    case "setBackground":
      return { ...state, background: action.color };
    case "changed":
      return {
        ...state,
        dirty: true,
        undoDepth: action.undoDepth,
        size: action.size ?? state.size,
      };
    case "undone":
      return {
        ...state,
        undoDepth: action.undoDepth,
        size: action.size,
        dirty: true,
      };
    case "loaded":
      return {
        ...state,
        dirty: false,
        undoDepth: 0,
        size: action.size,
        loadedKey: action.key,
        dialog: { kind: "none" },
      };
    case "saved":
      return {
        ...state,
        dirty: false,
        loadedKey: action.key,
        dialog: { kind: "none" },
        status: `Saved ${action.name}`,
      };
    case "dialog":
      return { ...state, dialog: action.dialog };
    case "status":
      return { ...state, status: action.status };
  }
}

/**
 * The reducer state as it is right after a dispatch, before React re-renders: the
 * view model dispatches through it so a tool change is seen by the next pointer
 * event in the same tick (the agent bridge selects a tool and draws in one call),
 * and it resyncs from React after every render. Only ever read from callbacks.
 */
export class PaintShadow {
  private state: PaintState;

  constructor(initial: PaintState) {
    this.state = initial;
  }

  getState(): PaintState {
    return this.state;
  }

  apply(action: PaintAction): void {
    this.state = paintReducer(this.state, action);
  }

  sync(state: PaintState): void {
    this.state = state;
  }
}
