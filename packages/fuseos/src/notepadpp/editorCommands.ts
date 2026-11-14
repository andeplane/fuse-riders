import type { ReactNode } from "react";
import { createContext, createElement, useContext, useMemo } from "react";

import { loadFile } from "../disk/readFile";
import { useDiskDeps } from "../disk/useDisk";

import { useOpenInNotepad } from "./useOpenInNotepad";

/**
 * Notepad++ as something else on the desktop can drive: the Office Assistant's `[edit:<path>]`
 * tool (Phase C) opens, reads and rewrites files through this and nothing else. Paths are editor
 * paths: a repository path on C: ("packages/fuseos/src/App.tsx") or an "A:/..." location.
 * Writes land in the browser's overlay only; nothing here can reach GitHub.
 */
export interface EditorCommands {
  /** Opens the file in Notepad++ (a new tab, or the existing one brought to the front). */
  open(path: string): void;
  /** The text as Notepad++ would show it: the saved copy when there is one, else the committed text. */
  readFile(path: string): Promise<string>;
  /** Saves to the overlay; an open tab without unsaved typing follows the change. */
  writeFile(path: string, content: string): Promise<void>;
  /** Every path with a saved copy on this computer. */
  listModified(): Promise<string[]>;
  /** File > Revert to original: drops the saved copy. */
  revert(path: string): Promise<void>;
}

/** Set by `EditorCommandsProvider` (or a test); `useEditorCommands` builds the real thing when unset. */
export const EditorCommandsContext = createContext<EditorCommands | undefined>(
  undefined,
);

export function useEditorCommands(): EditorCommands {
  const injected = useContext(EditorCommandsContext);
  const deps = useDiskDeps();
  const open = useOpenInNotepad();
  const built = useMemo<EditorCommands>(
    () => ({
      open,
      readFile: async (path) => {
        const file = await loadFile(deps, path);
        return file.saved ?? file.original;
      },
      writeFile: (path, content) => deps.overlay.write(path, content),
      listModified: () => deps.overlay.list(),
      revert: (path) => deps.overlay.remove(path),
    }),
    [deps, open],
  );
  return injected ?? built;
}

/** Makes one `EditorCommands` available to a subtree (the Office Assistant, say) through the context. */
export function EditorCommandsProvider({ children }: { children: ReactNode }) {
  const commands = useEditorCommands();
  return createElement(
    EditorCommandsContext.Provider,
    { value: commands },
    children,
  );
}
