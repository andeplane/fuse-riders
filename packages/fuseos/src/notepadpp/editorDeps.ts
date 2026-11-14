import { createContext } from "react";

import type { EditorLanguage } from "../disk/fileTypes";

export type CursorPosition = { line: number; column: number };

/** What the window needs from a live editor, whichever engine renders it. */
export interface EditorHandle {
  getText(): string;
  /** Replaces the whole document (a revert, an outside save); keeps the undo history. */
  setText(text: string): void;
  setLanguage(language: EditorLanguage): void;
  setWordWrap(wrap: boolean): void;
  focus(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  destroy(): void;
}

export type EditorOptions = {
  parent: HTMLElement;
  text: string;
  language: EditorLanguage;
  wordWrap: boolean;
  onChange: (text: string) => void;
  onCursor: (position: CursorPosition) => void;
  /** Ctrl+S inside the editor. */
  onSave: () => void;
};

export type EditorDeps = {
  /** Builds the editor into `parent`; the production one loads CodeMirror on first call. */
  createEditor(options: EditorOptions): Promise<EditorHandle>;
};

/** CodeMirror and its language packs arrive only when the first Notepad++ window mounts. */
export const defaultEditorDeps: EditorDeps = {
  createEditor: async (options) => {
    const { createCodeMirrorEditor } = await import("./codemirrorEditor");
    return createCodeMirrorEditor(options);
  },
};

export const EditorDepsContext = createContext<EditorDeps>(defaultEditorDeps);
