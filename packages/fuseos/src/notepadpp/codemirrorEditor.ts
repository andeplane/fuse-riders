/**
 * The CodeMirror 6 editor behind Notepad++. Only `editorDeps.ts` imports this module, through a
 * dynamic import, so CodeMirror and its language packs stay out of the desktop's initial bundle.
 */
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import type { EditorLanguage } from "../disk/fileTypes";

import type { EditorHandle, EditorOptions } from "./editorDeps";

/** Notepad++'s default theme: white page, pale blue current line, grey gutter, Courier-ish mono. */
export const notepadPlusPlusTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#ffffff",
    color: "#000000",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: '"Courier New", Courier, monospace',
    lineHeight: "1.3",
  },
  ".cm-content": { caretColor: "#000000" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#000000" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "#c0c0c0" },
  ".cm-activeLine": { backgroundColor: "#e8e8ff" },
  ".cm-gutters": {
    backgroundColor: "#e4e4e4",
    color: "#808080",
    borderRight: "1px solid #c0c0c0",
  },
  ".cm-activeLineGutter": { backgroundColor: "#d0d0e8" },
  ".cm-matchingBracket": { backgroundColor: "#ffff80", color: "#ff0000" },
});

/** Notepad++'s "Default (stylers.xml)" colours, near enough. */
export const notepadPlusPlusHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#0000ff", fontWeight: "bold" },
  { tag: tags.controlKeyword, color: "#0000ff", fontWeight: "bold" },
  {
    tag: [tags.definitionKeyword, tags.modifier],
    color: "#0000ff",
    fontWeight: "bold",
  },
  { tag: tags.comment, color: "#008000" },
  { tag: tags.lineComment, color: "#008000" },
  { tag: tags.blockComment, color: "#008000" },
  { tag: tags.docComment, color: "#008080" },
  { tag: tags.string, color: "#808080" },
  { tag: tags.special(tags.string), color: "#808080" },
  { tag: tags.regexp, color: "#000080" },
  { tag: tags.number, color: "#ff8000" },
  { tag: tags.bool, color: "#0000ff", fontWeight: "bold" },
  { tag: tags.null, color: "#0000ff", fontWeight: "bold" },
  { tag: tags.operator, color: "#000080", fontWeight: "bold" },
  { tag: tags.punctuation, color: "#000080" },
  { tag: tags.bracket, color: "#000080", fontWeight: "bold" },
  { tag: tags.typeName, color: "#8000ff" },
  { tag: tags.className, color: "#8000ff" },
  { tag: tags.propertyName, color: "#000000" },
  { tag: tags.function(tags.variableName), color: "#000000" },
  { tag: tags.variableName, color: "#000000" },
  { tag: tags.tagName, color: "#0000ff" },
  { tag: tags.attributeName, color: "#ff0000" },
  { tag: tags.attributeValue, color: "#8000ff" },
  { tag: tags.heading, color: "#000080", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#0000ff", textDecoration: "underline" },
  { tag: tags.meta, color: "#808000" },
  { tag: tags.processingInstruction, color: "#808000" },
  { tag: tags.invalid, color: "#ff0000" },
]);

export function languageExtension(language: EditorLanguage): Extension {
  switch (language) {
    case "typescript":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "javascript":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "css":
      return css();
    case "html":
      return html();
    case "yaml":
      return yaml();
    case "plain":
      return [];
  }
}

export function createCodeMirrorEditor(options: EditorOptions): EditorHandle {
  const language = new Compartment();
  const wrap = new Compartment();
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        syntaxHighlighting(notepadPlusPlusHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        notepadPlusPlusTheme,
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              options.onSave();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        language.of(languageExtension(options.language)),
        wrap.of(options.wordWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            options.onCursor({
              line: line.number,
              column: head - line.from + 1,
            });
          }
        }),
      ],
    }),
  });

  return {
    getText: () => view.state.doc.toString(),
    setText: (text) => {
      if (text === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    setLanguage: (next) =>
      view.dispatch({ effects: language.reconfigure(languageExtension(next)) }),
    setWordWrap: (on) =>
      view.dispatch({
        effects: wrap.reconfigure(on ? EditorView.lineWrapping : []),
      }),
    focus: () => view.focus(),
    undo: () => {
      undo(view);
    },
    redo: () => {
      redo(view);
    },
    selectAll: () => {
      selectAll(view);
    },
    destroy: () => view.destroy(),
  };
}
