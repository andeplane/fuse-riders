import { renderHook, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";

import { FIXTURE_FILES } from "../__mocks__/disk";
import {
  createWrapper,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { HOMEWORK_LOCATION, HOMEWORK_TEXT } from "../disk/floppy";

import type { EditorCommands } from "./editorCommands";
import {
  EditorCommandsContext,
  EditorCommandsProvider,
  useEditorCommands,
} from "./editorCommands";

const APP = "packages/fuseos/src/App.tsx";

describe(useEditorCommands.name, () => {
  it("reads committed text, the saved copy over it, and the floppy", async () => {
    const context = createWrapper({
      disk: { overlay: { "README.md": "# saved" } },
    });
    const { result } = renderHook(() => useEditorCommands(), {
      wrapper: context.Wrapper,
    });
    await expect(result.current.readFile(APP)).resolves.toBe(
      FIXTURE_FILES[APP],
    );
    await expect(result.current.readFile("README.md")).resolves.toBe("# saved");
    await expect(result.current.readFile(HOMEWORK_LOCATION)).resolves.toBe(
      HOMEWORK_TEXT,
    );
    await expect(result.current.readFile("nope.txt")).rejects.toThrow("404");
  });

  it("writes to the overlay only, lists what is modified and reverts", async () => {
    const context = createWrapper();
    const { result } = renderHook(() => useEditorCommands(), {
      wrapper: context.Wrapper,
    });
    await result.current.writeFile(APP, "edited");
    await expect(result.current.listModified()).resolves.toEqual([APP]);
    await expect(result.current.readFile(APP)).resolves.toBe("edited");
    await expect(context.diskDeps.overlay.read(APP)).resolves.toBe("edited");
    await result.current.revert(APP);
    await expect(result.current.listModified()).resolves.toEqual([]);
    await expect(result.current.readFile(APP)).resolves.toBe(
      FIXTURE_FILES[APP],
    );
    // GitHub was only ever read.
    expect(context.diskDeps.source.reads).toEqual([APP, APP]);
  });

  it("opens a file in Notepad++, reusing the window and following later writes", async () => {
    const context = createWrapper();
    const { result } = renderHook(() => useEditorCommands(), {
      wrapper: context.Wrapper,
    });
    result.current.open(APP);
    await waitFor(() =>
      expect(context.store.load().windows).toEqual([
        expect.objectContaining({
          kind: "notepadpp",
          paths: [APP],
          activePath: APP,
        }),
      ]),
    );
    result.current.open("README.md");
    await waitFor(() =>
      expect(context.store.load().windows).toEqual([
        expect.objectContaining({
          kind: "notepadpp",
          paths: [APP, "README.md"],
          activePath: "README.md",
        }),
      ]),
    );
  });

  it("drives an open editor through the overlay", async () => {
    function Probe() {
      const commands = useEditorCommands();
      return (
        <button
          type="button"
          onClick={() => void commands.writeFile("README.md", "# via commands")}
        >
          Write
        </button>
      );
    }
    const { editors } = renderWithProviders(
      <>
        <Desktop />
        <Probe />
      </>,
      { initialOpen: [{ kind: "notepadpp", paths: ["README.md"] }] },
    );
    await screen.findByRole("textbox", { name: "Editor" });
    screen.getByRole("button", { name: "Write" }).click();
    await waitFor(() => expect(editors[0]?.getText()).toBe("# via commands"));
    expect(
      screen.getByRole("tab", { name: /README\.md ●/ }),
    ).toBeInTheDocument();
  });

  it("prefers commands injected through the context and provides its own to a subtree", () => {
    const injected: EditorCommands = {
      open: vi.fn(),
      readFile: vi.fn(async () => "x"),
      writeFile: vi.fn(async () => undefined),
      listModified: vi.fn(async () => []),
      revert: vi.fn(async () => undefined),
    };
    const context = createWrapper();
    const { result } = renderHook(() => useEditorCommands(), {
      wrapper: ({ children }) => (
        <context.Wrapper>
          <EditorCommandsContext.Provider value={injected}>
            {children}
          </EditorCommandsContext.Provider>
        </context.Wrapper>
      ),
    });
    expect(result.current).toBe(injected);

    const provided = renderHook(() => useContext(EditorCommandsContext), {
      wrapper: ({ children }) => (
        <context.Wrapper>
          <EditorCommandsProvider>{children}</EditorCommandsProvider>
        </context.Wrapper>
      ),
    });
    expect(provided.result.current).toBeDefined();
    expect(typeof provided.result.current?.open).toBe("function");
  });
});
