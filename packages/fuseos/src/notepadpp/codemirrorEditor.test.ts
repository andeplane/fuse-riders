import type { EditorLanguage } from "../disk/fileTypes";

import type { CursorPosition, EditorOptions } from "./editorDeps";
import {
  createCodeMirrorEditor,
  languageExtension,
  notepadPlusPlusHighlight,
  notepadPlusPlusTheme,
} from "./codemirrorEditor";

function mount(overrides: Partial<EditorOptions> = {}) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const changes: string[] = [];
  const cursors: CursorPosition[] = [];
  let saves = 0;
  const handle = createCodeMirrorEditor({
    parent,
    text: "const a = 1;\nconst b = 2;\n",
    language: "typescript",
    wordWrap: false,
    onChange: (text) => changes.push(text),
    onCursor: (position) => cursors.push(position),
    onSave: () => {
      saves += 1;
    },
    ...overrides,
  });
  return { parent, handle, changes, cursors, saves: () => saves };
}

describe(createCodeMirrorEditor.name, () => {
  it("mounts CodeMirror into the parent with the text, line numbers and the Notepad++ theme", () => {
    const { parent, handle } = mount();
    expect(handle.getText()).toBe("const a = 1;\nconst b = 2;\n");
    expect(parent.querySelector(".cm-editor")).not.toBeNull();
    expect(parent.querySelector(".cm-gutters")).not.toBeNull();
    expect(parent.textContent).toContain("const a = 1;");
    handle.destroy();
    expect(parent.querySelector(".cm-editor")).toBeNull();
  });

  it("reports edits and the cursor, replaces the text only when it differs, and keeps undo across a replace", () => {
    const { handle, changes, cursors } = mount();
    handle.setText("const a = 1;\nconst b = 2;\n");
    expect(changes).toEqual([]);

    handle.setText("hello\nworld");
    expect(changes).toEqual(["hello\nworld"]);
    expect(handle.getText()).toBe("hello\nworld");
    expect(cursors.at(-1)).toEqual({ line: 1, column: 1 });

    handle.undo();
    expect(handle.getText()).toBe("const a = 1;\nconst b = 2;\n");
    handle.redo();
    expect(handle.getText()).toBe("hello\nworld");

    handle.selectAll();
    expect(cursors.at(-1)).toEqual({ line: 2, column: 6 });
    handle.focus();
    handle.destroy();
  });

  it("switches language and word wrap on the live editor", () => {
    const { parent, handle } = mount();
    const languages: EditorLanguage[] = [
      "typescript",
      "tsx",
      "javascript",
      "jsx",
      "json",
      "markdown",
      "css",
      "html",
      "yaml",
      "plain",
    ];
    for (const language of languages) {
      expect(() => handle.setLanguage(language)).not.toThrow();
      expect(languageExtension(language)).toBeDefined();
    }
    expect(parent.querySelector(".cm-lineWrapping")).toBeNull();
    handle.setWordWrap(true);
    expect(parent.querySelector(".cm-lineWrapping")).not.toBeNull();
    handle.setWordWrap(false);
    expect(parent.querySelector(".cm-lineWrapping")).toBeNull();
    handle.destroy();
  });

  it("starts wrapped when asked and defines the theme and highlight style once", () => {
    const { parent, handle } = mount({ wordWrap: true, language: "markdown" });
    expect(parent.querySelector(".cm-lineWrapping")).not.toBeNull();
    expect(notepadPlusPlusTheme).toBeDefined();
    expect(notepadPlusPlusHighlight.module).toBeDefined();
    handle.destroy();
  });

  it("saves on Ctrl+S from inside the editor", () => {
    const { parent, handle, saves } = mount();
    const content = parent.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) throw new Error("no content");
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(saves()).toBe(1);
    handle.destroy();
  });
});
