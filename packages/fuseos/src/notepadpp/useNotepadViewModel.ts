import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { EditorLanguage } from "../disk/fileTypes";
import { editorLanguage } from "../disk/fileTypes";
import { loadFile } from "../disk/readFile";
import { useDiskDeps } from "../disk/useDisk";
import { useAppState } from "../state/useAppState";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { CursorPosition, EditorHandle } from "./editorDeps";
import type { FileState } from "./notepadState";
import {
  EMPTY_NOTEPAD_STATE,
  isDirty,
  isModified,
  notepadReducer,
} from "./notepadState";

export type NotepadTab = {
  path: string;
  name: string;
  active: boolean;
  dirty: boolean;
  modified: boolean;
};

/** A dirty tab is being closed: Notepad++ asks whether to save first. */
export type PendingClose = { path: string; name: string };

export type NotepadViewModel = {
  tabs: NotepadTab[];
  activePath: string | undefined;
  activeFile: FileState | undefined;
  fileAt: (path: string) => FileState | undefined;
  language: EditorLanguage;
  wordWrap: boolean;
  toggleWordWrap: () => void;
  cursor: CursorPosition;
  setCursor: (position: CursorPosition) => void;
  activate: (path: string) => void;
  edit: (path: string, text: string) => void;
  /** File > Save: the active tab's draft goes to the overlay. */
  save: () => void;
  saveAll: () => void;
  /** File > Revert to original: the overlay copy is dropped and the committed text shown again. */
  revert: () => void;
  canRevert: boolean;
  closeTab: (path: string) => void;
  pendingClose: PendingClose | undefined;
  /** Yes / No / Cancel on the "Save file?" box. */
  resolveClose: (choice: "save" | "discard" | "cancel") => void;
  registerEditor: (path: string, handle: EditorHandle | null) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  close: () => void;
};

export function useNotepadViewModel(
  windowId: string,
  paths: readonly string[],
  requestedActive: string | undefined,
): NotepadViewModel {
  const deps = useDiskDeps();
  const { dispatch: appDispatch } = useAppState();
  const commands = useWindowCommands();
  const [files, dispatch] = useReducer(notepadReducer, EMPTY_NOTEPAD_STATE);
  const [wordWrap, setWordWrap] = useState(false);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [pendingClose, setPendingClose] = useState<PendingClose | undefined>(
    undefined,
  );
  const editors = useRef(new Map<string, EditorHandle>());

  const activePath =
    requestedActive !== undefined && paths.includes(requestedActive)
      ? requestedActive
      : paths[paths.length - 1];

  // Load every tab the window lists that we have not read yet.
  useEffect(() => {
    for (const path of paths) {
      if (files[path]) continue;
      dispatch({ type: "load", path });
      loadFile(deps, path).then(
        (file) => dispatch({ type: "loaded", path, ...file }),
        (error: unknown) =>
          dispatch({
            type: "failed",
            path,
            message:
              error instanceof Error
                ? error.message
                : "The file could not be read.",
          }),
      );
    }
  }, [paths, files, deps]);

  // A save or revert from elsewhere (Explorer, another window, the Office Assistant) shows up here.
  useEffect(
    () =>
      deps.overlay.subscribe((change) =>
        dispatch({
          type: "overlayChanged",
          path: change.path,
          content: change.content,
        }),
      ),
    [deps.overlay],
  );

  const patchWindow = useCallback(
    (
      update: (window: { paths: string[]; activePath?: string }) => {
        paths: string[];
        activePath?: string;
      },
    ) =>
      appDispatch({
        type: "patch",
        id: windowId,
        patch: (window) =>
          window.kind === "notepadpp"
            ? { ...window, ...update(window) }
            : window,
      }),
    [appDispatch, windowId],
  );

  const activate = useCallback(
    (path: string) =>
      patchWindow((window) => ({ ...window, activePath: path })),
    [patchWindow],
  );

  const saveFile = useCallback(
    (path: string) => {
      const file = files[path];
      if (file?.status !== "ready") return;
      const text = file.draft;
      void deps.overlay
        .write(path, text)
        .then(() => dispatch({ type: "saved", path, text }))
        .catch((error: unknown) =>
          commands.showError(
            "Notepad++",
            `${path} could not be saved: ${error instanceof Error ? error.message : "storage error"}`,
          ),
        );
    },
    [files, deps.overlay, commands],
  );

  const save = useCallback(() => {
    if (activePath !== undefined) saveFile(activePath);
  }, [activePath, saveFile]);

  const saveAll = useCallback(() => {
    for (const path of paths) if (isDirty(files[path])) saveFile(path);
  }, [paths, files, saveFile]);

  const revert = useCallback(() => {
    if (activePath === undefined || !isModified(files[activePath])) return;
    const path = activePath;
    void deps.overlay
      .remove(path)
      .then(() => dispatch({ type: "reverted", path }));
  }, [activePath, files, deps.overlay]);

  const removeTab = useCallback(
    (path: string) => {
      const remaining = paths.filter((other) => other !== path);
      dispatch({ type: "forget", path });
      if (remaining.length === 0) {
        commands.close(windowId);
        return;
      }
      patchWindow((window) => ({
        paths: remaining,
        activePath:
          window.activePath === path
            ? remaining[remaining.length - 1]
            : window.activePath,
      }));
    },
    [paths, commands, windowId, patchWindow],
  );

  const closeTab = useCallback(
    (path: string) => {
      if (isDirty(files[path]))
        setPendingClose({ path, name: path.slice(path.lastIndexOf("/") + 1) });
      else removeTab(path);
    },
    [files, removeTab],
  );

  const resolveClose = useCallback(
    (choice: "save" | "discard" | "cancel") => {
      const pending = pendingClose;
      setPendingClose(undefined);
      if (!pending || choice === "cancel") return;
      if (choice === "save") saveFile(pending.path);
      removeTab(pending.path);
    },
    [pendingClose, saveFile, removeTab],
  );

  const registerEditor = useCallback(
    (path: string, handle: EditorHandle | null) => {
      if (handle) editors.current.set(path, handle);
      else editors.current.delete(path);
    },
    [],
  );
  const activeEditor = () =>
    activePath === undefined ? undefined : editors.current.get(activePath);

  const activeFile = activePath === undefined ? undefined : files[activePath];

  return {
    tabs: paths.map((path) => ({
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      active: path === activePath,
      dirty: isDirty(files[path]),
      modified: isModified(files[path]),
    })),
    activePath,
    activeFile,
    fileAt: (path) => files[path],
    language: activePath === undefined ? "plain" : editorLanguage(activePath),
    wordWrap,
    toggleWordWrap: () => setWordWrap((on) => !on),
    cursor,
    setCursor,
    activate,
    edit: (path, text) => dispatch({ type: "edit", path, draft: text }),
    save,
    saveAll,
    revert,
    canRevert: isModified(activeFile),
    closeTab,
    pendingClose,
    resolveClose,
    registerEditor,
    undo: () => activeEditor()?.undo(),
    redo: () => activeEditor()?.redo(),
    selectAll: () => activeEditor()?.selectAll(),
    close: () => commands.close(windowId),
  };
}
