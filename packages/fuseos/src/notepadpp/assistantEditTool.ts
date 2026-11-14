import { useMemo, useRef } from "react";

import type { AssistantTool } from "../assistant/assistantToolsContext";
import { useRegisterAssistantTool } from "../assistant/assistantToolsContext";

import type { EditorCommands } from "./editorCommands";
import { useEditorCommands } from "./editorCommands";

/** How much of the active file the system prompt carries; the local models have a small context. */
export const MAX_PROMPT_FILE_CHARS = 1500;

export const UNDO_ARG = "undo";

/** What Clippy says once an edit is on the C: drive; the drive is this browser's and nothing else's. */
export function editSavedSentence(path: string): string {
  return `Saved ${path} to your C: drive, which is this browser and nowhere else; GitHub never hears of it. Say "undo" to put it back.`;
}

export type EditToolView = {
  /** The paths open in Notepad++, in tab order. */
  paths: readonly string[];
  /** The active tab and its text as the editor shows it, once loaded. */
  active?: { path: string; text: string };
};

/** What an edit replaced, so it can be undone: the overlay copy before it, or nothing (the committed text showed). */
export type EditUndo = { path: string; previous: string | undefined };

export type EditToolDeps = {
  editor: Pick<
    EditorCommands,
    "readFile" | "writeFile" | "revert" | "listModified"
  >;
  /** Read on every call, so the prompt and the checks see the editor as it is now. */
  view: () => EditToolView;
  /** The last edit's undo, kept by the caller across prompts. */
  undo: { current: EditUndo | undefined };
};

export function truncateForPrompt(
  text: string,
  limit = MAX_PROMPT_FILE_CHARS,
): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n... (${text.length - limit} more characters not shown)`;
}

/**
 * Clippy's `[edit:<path>]`: the reply's fenced code block becomes the file's content on the C: drive
 * (the browser's overlay, through `EditorCommands`), and the open tab follows unless it has unsaved
 * typing. `[edit:undo]` puts back what the last edit replaced. The prompt line names the open files
 * and carries the active one's text, truncated, so the model has something to edit.
 */
export function createEditTool(deps: EditToolDeps): AssistantTool {
  return {
    name: "edit",
    describe: () => {
      const { paths, active } = deps.view();
      const open =
        paths.length > 0
          ? `Open in Notepad++: ${paths.join(", ")}.`
          : "Nothing is open in Notepad++.";
      const file = active
        ? `\n  The active file is ${active.path}; it currently reads:\n\`\`\`\n${truncateForPrompt(active.text)}\n\`\`\``
        : "";
      return `[edit:<path>] followed by a fenced code block replaces that file's content with the block, on the user's own C: drive (this browser only, never GitHub). Only a path open in Notepad++ may be edited. [edit:${UNDO_ARG}] puts back what the last edit replaced. ${open}${file}`;
    },
    sentence: ({ arg }) =>
      arg.trim() === UNDO_ARG ? "Undoing the last edit" : `Editing ${arg}`,
    run: async ({ arg, body }) => {
      const path = arg.trim();
      if (path === UNDO_ARG) {
        const undo = deps.undo.current;
        if (!undo) return { ok: false, sentence: "There is no edit to undo" };
        if (undo.previous === undefined) await deps.editor.revert(undo.path);
        else await deps.editor.writeFile(undo.path, undo.previous);
        deps.undo.current = undefined;
        return {
          ok: true,
          sentence: `Put ${undo.path} back the way it was on your C: drive`,
        };
      }
      const { paths } = deps.view();
      if (!paths.includes(path))
        return {
          ok: false,
          sentence: `${path || "That file"} is not open in Notepad++; open it first`,
        };
      if (body === undefined)
        return {
          ok: false,
          sentence: `No code block followed the marker, so ${path} is unchanged`,
        };
      // What to put back: the saved copy if there was one, else nothing (undo then reverts to the committed text).
      const hadSavedCopy = (await deps.editor.listModified()).includes(path);
      const previous = hadSavedCopy
        ? await deps.editor.readFile(path)
        : undefined;
      await deps.editor.writeFile(path, body);
      deps.undo.current = { path, previous };
      return { ok: true, sentence: editSavedSentence(path) };
    },
  };
}

/** Registers the edit tool for as long as the Notepad++ window is mounted. */
export function useNotepadEditTool(view: EditToolView): void {
  const editor = useEditorCommands();
  const viewRef = useRef(view);
  viewRef.current = view;
  const undo = useRef<EditUndo | undefined>(undefined);
  const tool = useMemo(
    () =>
      createEditTool({
        editor,
        view: () => viewRef.current,
        undo,
      }),
    [editor],
  );
  useRegisterAssistantTool(tool);
}
