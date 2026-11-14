/**
 * What Notepad++ knows about each open file, keyed by its editor path. Which tabs exist and which
 * is active live in the window's stored content (so a reload reopens them); the text does not,
 * except through the overlay once saved.
 */

export type FileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      /** The committed text (GitHub or the floppy). */
      original: string;
      /** What the editor shows. */
      draft: string;
      /** The copy in the overlay; undefined when the file has never been saved here. */
      saved: string | undefined;
      /** The commit of this build is not on GitHub; `original` came from the fallback branch. */
      fromFallback: boolean;
    };

export type NotepadState = Readonly<Record<string, FileState>>;

export type NotepadAction =
  | { type: "load"; path: string }
  | {
      type: "loaded";
      path: string;
      original: string;
      saved: string | undefined;
      fromFallback: boolean;
    }
  | { type: "failed"; path: string; message: string }
  | { type: "edit"; path: string; draft: string }
  | { type: "saved"; path: string; text: string }
  | { type: "reverted"; path: string }
  /** The overlay changed under us (another window, Clippy): follow it unless the editor has unsaved typing. */
  | { type: "overlayChanged"; path: string; content: string | undefined }
  | { type: "forget"; path: string };

export const EMPTY_NOTEPAD_STATE: NotepadState = {};

export function notepadReducer(
  state: NotepadState,
  action: NotepadAction,
): NotepadState {
  const current = state[action.path];
  switch (action.type) {
    case "load":
      return current
        ? state
        : { ...state, [action.path]: { status: "loading" } };
    case "loaded":
      return {
        ...state,
        [action.path]: {
          status: "ready",
          original: action.original,
          draft: action.saved ?? action.original,
          saved: action.saved,
          fromFallback: action.fromFallback,
        },
      };
    case "failed":
      return {
        ...state,
        [action.path]: { status: "error", message: action.message },
      };
    case "edit":
      if (current?.status !== "ready") return state;
      return { ...state, [action.path]: { ...current, draft: action.draft } };
    case "saved":
      if (current?.status !== "ready") return state;
      return {
        ...state,
        [action.path]: { ...current, draft: action.text, saved: action.text },
      };
    case "reverted":
      if (current?.status !== "ready") return state;
      return {
        ...state,
        [action.path]: {
          ...current,
          draft: current.original,
          saved: undefined,
        },
      };
    case "overlayChanged": {
      if (current?.status !== "ready") return state;
      const shown = current.saved ?? current.original;
      const dirty = current.draft !== shown;
      const next = action.content ?? current.original;
      return {
        ...state,
        [action.path]: {
          ...current,
          saved: action.content,
          draft: dirty ? current.draft : next,
        },
      };
    }
    case "forget": {
      if (!current) return state;
      const { [action.path]: _gone, ...rest } = state;
      return rest;
    }
  }
}

/** The editor holds typing that is neither committed nor saved to the overlay. */
export function isDirty(file: FileState | undefined): boolean {
  return (
    file?.status === "ready" && file.draft !== (file.saved ?? file.original)
  );
}

/** The browser holds a saved copy that differs from the committed text. */
export function isModified(file: FileState | undefined): boolean {
  return file?.status === "ready" && file.saved !== undefined;
}
