import { useContext, useEffect, useRef, useState } from "react";

import type { EditorLanguage } from "../disk/fileTypes";

import type { CursorPosition, EditorHandle } from "./editorDeps";
import { EditorDepsContext } from "./editorDeps";

export type CodeEditorProps = {
  text: string;
  language: EditorLanguage;
  wordWrap: boolean;
  visible: boolean;
  onChange: (text: string) => void;
  onCursor: (position: CursorPosition) => void;
  onSave: () => void;
  /** The live editor, or null once it is gone; the window routes Edit menu commands through it. */
  onHandle: (handle: EditorHandle | null) => void;
};

export const EDITOR_LOADING_TEXT = "Loading editor...";

/**
 * One editor per open tab, kept mounted (hidden) when another tab is active so each keeps its
 * undo history and scroll position. The engine comes from `EditorDepsContext`: CodeMirror in the
 * app, a textarea in tests.
 */
export function CodeEditor({
  text,
  language,
  wordWrap,
  visible,
  onChange,
  onCursor,
  onSave,
  onHandle,
}: CodeEditorProps) {
  const { createEditor } = useContext(EditorDepsContext);
  const parentRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [ready, setReady] = useState(false);
  // The latest callbacks, so the editor built once can call what the window currently wants.
  const callbacks = useRef({ onChange, onCursor, onSave, onHandle });
  callbacks.current = { onChange, onCursor, onSave, onHandle };

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return undefined;
    let cancelled = false;
    void createEditor({
      parent,
      text,
      language,
      wordWrap,
      onChange: (next) => callbacks.current.onChange(next),
      onCursor: (position) => callbacks.current.onCursor(position),
      onSave: () => callbacks.current.onSave(),
    }).then((handle) => {
      if (cancelled) {
        handle.destroy();
        return;
      }
      handleRef.current = handle;
      callbacks.current.onHandle(handle);
      setReady(true);
    });
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      callbacks.current.onHandle(null);
    };
    // The editor is built once (so the deps list omits the initial text, language and wrap
    // deliberately); later prop changes are applied through its handle below.
  }, [createEditor]);

  useEffect(() => {
    const handle = handleRef.current;
    if (handle && handle.getText() !== text) handle.setText(text);
  }, [text, ready]);

  useEffect(() => {
    handleRef.current?.setLanguage(language);
  }, [language, ready]);

  useEffect(() => {
    handleRef.current?.setWordWrap(wordWrap);
  }, [wordWrap, ready]);

  useEffect(() => {
    if (visible && ready) handleRef.current?.focus();
  }, [visible, ready]);

  return (
    <div
      className="h-full min-h-0 w-full overflow-hidden bg-white"
      style={{ display: visible ? undefined : "none" }}
    >
      {!ready ? <p className="p-2">{EDITOR_LOADING_TEXT}</p> : null}
      <div ref={parentRef} className="h-full min-h-0" />
    </div>
  );
}
