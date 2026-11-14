import type { EditorLanguage } from "../disk/fileTypes";
import type {
  EditorDeps,
  EditorHandle,
  EditorOptions,
} from "../notepadpp/editorDeps";

/** A Notepad++ editor without CodeMirror: a plain textarea the tests can type into. */
export class FakeEditor implements EditorHandle {
  readonly textarea: HTMLTextAreaElement;
  language: EditorLanguage;
  wordWrap: boolean;
  destroyed = false;
  undoCalls = 0;
  redoCalls = 0;

  constructor(private readonly options: EditorOptions) {
    this.language = options.language;
    this.wordWrap = options.wordWrap;
    this.textarea = options.parent.ownerDocument.createElement("textarea");
    this.textarea.setAttribute("aria-label", "Editor");
    this.textarea.value = options.text;
    this.textarea.addEventListener("input", () => {
      options.onChange(this.textarea.value);
      this.reportCursor();
    });
    this.textarea.addEventListener("keyup", () => this.reportCursor());
    this.textarea.addEventListener("click", () => this.reportCursor());
    this.textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        options.onSave();
      }
    });
    options.parent.appendChild(this.textarea);
  }

  private reportCursor(): void {
    const before = this.textarea.value.slice(0, this.textarea.selectionStart);
    const lines = before.split("\n");
    this.options.onCursor({
      line: lines.length,
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
    });
  }

  getText(): string {
    return this.textarea.value;
  }

  setText(text: string): void {
    this.textarea.value = text;
  }

  setLanguage(language: EditorLanguage): void {
    this.language = language;
  }

  setWordWrap(wrap: boolean): void {
    this.wordWrap = wrap;
  }

  focus(): void {
    this.textarea.focus();
  }

  undo(): void {
    this.undoCalls += 1;
  }

  redo(): void {
    this.redoCalls += 1;
  }

  selectAll(): void {
    this.textarea.select();
  }

  destroy(): void {
    this.destroyed = true;
    this.textarea.remove();
  }
}

/** Editor deps that build `FakeEditor`s synchronously; every editor created is collected in `editors`. */
export function createFakeEditorDeps(editors: FakeEditor[]): EditorDeps {
  return {
    createEditor: (options) => {
      const editor = new FakeEditor(options);
      editors.push(editor);
      return Promise.resolve(editor);
    },
  };
}
