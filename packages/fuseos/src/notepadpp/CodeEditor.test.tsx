import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FakeEditor } from "../__mocks__/editor";
import { createFakeEditorDeps } from "../__mocks__/editor";

import { CodeEditor, EDITOR_LOADING_TEXT } from "./CodeEditor";
import type { EditorHandle } from "./editorDeps";
import { EditorDepsContext } from "./editorDeps";

type Harness = {
  editors: FakeEditor[];
  handles: (EditorHandle | null)[];
  onChange: ReturnType<typeof vi.fn<(text: string) => void>>;
  onSave: ReturnType<typeof vi.fn<() => void>>;
  onCursor: ReturnType<
    typeof vi.fn<(position: { line: number; column: number }) => void>
  >;
};

function mount(
  props: Partial<Parameters<typeof CodeEditor>[0]> = {},
): Harness & {
  rerender: (next: Partial<Parameters<typeof CodeEditor>[0]>) => void;
  unmount: () => void;
} {
  const editors: FakeEditor[] = [];
  const handles: (EditorHandle | null)[] = [];
  const onChange = vi.fn<(text: string) => void>();
  const onSave = vi.fn<() => void>();
  const onCursor =
    vi.fn<(position: { line: number; column: number }) => void>();
  const deps = createFakeEditorDeps(editors);
  const element = (overrides: Partial<Parameters<typeof CodeEditor>[0]>) => (
    <EditorDepsContext.Provider value={deps}>
      <CodeEditor
        text="hello"
        language="plain"
        wordWrap={false}
        visible
        onChange={onChange}
        onCursor={onCursor}
        onSave={onSave}
        onHandle={(handle) => handles.push(handle)}
        {...props}
        {...overrides}
      />
    </EditorDepsContext.Provider>
  );
  const result = render(element({}));
  return {
    editors,
    handles,
    onChange,
    onSave,
    onCursor,
    rerender: (next) => result.rerender(element(next)),
    unmount: result.unmount,
  };
}

describe(CodeEditor.name, () => {
  it("builds one editor with the text, hands out its handle and focuses it when visible", async () => {
    const harness = mount();
    expect(screen.getByText(EDITOR_LOADING_TEXT)).toBeInTheDocument();
    const field = await screen.findByRole("textbox", { name: "Editor" });
    expect(field).toHaveValue("hello");
    expect(screen.queryByText(EDITOR_LOADING_TEXT)).not.toBeInTheDocument();
    expect(harness.editors).toHaveLength(1);
    expect(harness.handles).toEqual([harness.editors[0]]);
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("reports typing, the caret and Ctrl+S", async () => {
    const user = userEvent.setup();
    const harness = mount({ text: "a\nbc" });
    const field = await screen.findByRole("textbox", { name: "Editor" });
    await user.click(field);
    await user.keyboard("{End}d");
    expect(harness.onChange).toHaveBeenLastCalledWith("a\nbcd");
    expect(harness.onCursor).toHaveBeenLastCalledWith({ line: 2, column: 4 });
    await user.keyboard("{Control>}s{/Control}");
    expect(harness.onSave).toHaveBeenCalledTimes(1);
  });

  it("pushes new text, language, wrap and visibility into the live editor", async () => {
    const harness = mount();
    await screen.findByRole("textbox", { name: "Editor" });
    harness.rerender({ text: "replaced", language: "json", wordWrap: true });
    expect(harness.editors[0]?.getText()).toBe("replaced");
    expect(harness.editors[0]?.language).toBe("json");
    expect(harness.editors[0]?.wordWrap).toBe(true);
    harness.rerender({ text: "replaced", visible: false });
    expect(
      screen.getByRole("textbox", { name: "Editor", hidden: true })
        .parentElement?.parentElement,
    ).toHaveStyle({ display: "none" });
    // Still one editor: the hidden tab keeps its instance.
    expect(harness.editors).toHaveLength(1);
  });

  it("destroys the editor on unmount and forgets the handle", async () => {
    const harness = mount();
    await screen.findByRole("textbox", { name: "Editor" });
    harness.unmount();
    expect(harness.editors[0]?.destroyed).toBe(true);
    expect(harness.handles).toEqual([harness.editors[0], null]);
  });

  it("drops an editor that finishes building after the component is gone", async () => {
    let finish: (handle: FakeEditor) => void = () => undefined;
    const editors: FakeEditor[] = [];
    const slow = createFakeEditorDeps(editors);
    const deps = {
      createEditor: (options: Parameters<typeof slow.createEditor>[0]) =>
        new Promise<EditorHandle>((resolve) => {
          finish = (handle) => resolve(handle);
          void slow.createEditor(options);
        }),
    };
    const handles: (EditorHandle | null)[] = [];
    const { unmount } = render(
      <EditorDepsContext.Provider value={deps}>
        <CodeEditor
          text=""
          language="plain"
          wordWrap={false}
          visible
          onChange={() => undefined}
          onCursor={() => undefined}
          onSave={() => undefined}
          onHandle={(handle) => handles.push(handle)}
        />
      </EditorDepsContext.Provider>,
    );
    unmount();
    const built = editors[0];
    expect(built).toBeDefined();
    if (!built) return;
    finish(built);
    await waitFor(() => expect(built.destroyed).toBe(true));
    expect(handles).toEqual([null]);
  });
});
