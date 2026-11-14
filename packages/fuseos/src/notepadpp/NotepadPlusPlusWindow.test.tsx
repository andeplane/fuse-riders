import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FIXTURE_FILES } from "../__mocks__/disk";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { NOT_ON_GITHUB_NOTICE } from "../disk/diskSource";
import { HOMEWORK_LOCATION, HOMEWORK_TEXT } from "../disk/floppy";

import { LOCAL_SAVE_NOTICE } from "./NotepadPlusPlusWindow";

const APP = "packages/fuseos/src/App.tsx";
const MAIN = "packages/fuseos/src/main.tsx";
const README = "README.md";

const notepad = (paths: string[], activePath?: string) =>
  ({ kind: "notepadpp", paths, activePath }) as const;

const editor = () => screen.findByRole("textbox", { name: "Editor" });

async function openMenu(menu: string, item: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("menuitem", { name: menu }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: item }));
}

describe("Notepad++", () => {
  it("opens a file from the C: drive with its language and the local-save notice", async () => {
    renderWithProviders(<Desktop />, { initialOpen: [notepad([APP])] });
    expect(screen.getByText("Opening App.tsx...")).toBeInTheDocument();
    expect(await editor()).toHaveValue(FIXTURE_FILES[APP]);
    expect(
      screen.getByRole("dialog", { name: "App.tsx - Notepad++" }),
    ).toBeInTheDocument();
    expect(screen.getByText("TypeScript React")).toBeInTheDocument();
    expect(screen.getByText(LOCAL_SAVE_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/length : \d+ lines : 4/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /App\.tsx/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("marks typing as unsaved, saves with Ctrl+S to the overlay only, and reverts", async () => {
    const user = userEvent.setup();
    const { diskDeps, editors } = renderWithProviders(<Desktop />, {
      initialOpen: [notepad([README])],
    });
    const field = await editor();
    await user.click(field);
    await user.keyboard("{End}!");
    expect(
      screen.getByRole("tab", { name: /README\.md \*/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /README\.md ●/ }),
      ).toBeInTheDocument(),
    );
    await expect(diskDeps.overlay.read(README)).resolves.toBe(
      `${FIXTURE_FILES[README]}!`,
    );
    expect(diskDeps.source.reads).toEqual([README]);
    await openMenu("File", "Revert to original");
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /README\.md/ }),
      ).not.toHaveTextContent(/[*●]/),
    );
    expect(editors[0]?.getText()).toBe(FIXTURE_FILES[README]);
    await expect(diskDeps.overlay.list()).resolves.toEqual([]);
  });

  it("shows the saved copy over the committed text, and Save All saves every dirty tab", async () => {
    const user = userEvent.setup();
    const { diskDeps } = renderWithProviders(<Desktop />, {
      initialOpen: [notepad([README, MAIN], README)],
      disk: { overlay: { [README]: "# saved before" } },
    });
    expect(await editor()).toHaveValue("# saved before");
    expect(
      screen.getByRole("tab", { name: /README\.md ●/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Save" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Save All" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("textbox", { name: "Editor" }));
    await user.keyboard("{End}+");
    await user.click(screen.getByRole("tab", { name: /main\.tsx/ }));
    expect(
      screen.getByRole("dialog", { name: "main.tsx - Notepad++" }),
    ).toBeInTheDocument();
    await user.click(await editor());
    await user.keyboard("{End}+");
    await openMenu("File", "Save All");
    await waitFor(async () =>
      expect(await diskDeps.overlay.list()).toEqual([README, MAIN]),
    );
  });

  it("asks before closing a tab with unsaved typing: Yes saves, No discards, Cancel keeps it", async () => {
    const user = userEvent.setup();
    const { diskDeps, store } = renderWithProviders(<Desktop />, {
      initialOpen: [notepad([README, MAIN], README)],
    });
    await user.click(await editor());
    await user.keyboard("{End}?");
    await user.click(screen.getByRole("button", { name: "Close README.md" }));
    const dialog = screen.getByRole("dialog", { name: "Save file?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("tab", { name: /README\.md \*/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close README.md" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Save file?" })).getByRole(
        "button",
        { name: "Yes" },
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("tab", { name: /README/ }),
      ).not.toBeInTheDocument(),
    );
    await expect(diskDeps.overlay.read(README)).resolves.toBe(
      `${FIXTURE_FILES[README]}?`,
    );
    // The remaining tab becomes active; closing it closes the window.
    expect(
      screen.getByRole("dialog", { name: "main.tsx - Notepad++" }),
    ).toBeInTheDocument();
    await user.click(await editor());
    await user.keyboard("{End}?");
    await user.click(screen.getByRole("button", { name: "Close main.tsx" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Save file?" })).getByRole(
        "button",
        { name: "No" },
      ),
    );
    await waitFor(() => expect(store.load().windows).toEqual([]));
    await expect(diskDeps.overlay.read(MAIN)).resolves.toBeUndefined();
  });

  it("follows a save made elsewhere unless the editor has unsaved typing", async () => {
    const user = userEvent.setup();
    const { diskDeps, editors } = renderWithProviders(<Desktop />, {
      initialOpen: [notepad([README])],
    });
    await editor();
    await act(async () => {
      await diskDeps.overlay.write(README, "# from clippy");
    });
    await waitFor(() => expect(editors[0]?.getText()).toBe("# from clippy"));
    expect(
      screen.getByRole("tab", { name: /README\.md ●/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Editor" }));
    await user.keyboard("{End}~");
    await act(async () => {
      await diskDeps.overlay.write(README, "# again");
    });
    expect(editors[0]?.getText()).toBe("# from clippy~");
    await act(async () => {
      await diskDeps.overlay.remove(README);
    });
    expect(editors[0]?.getText()).toBe("# from clippy~");
    expect(
      screen.getByRole("tab", { name: /README\.md \*/ }),
    ).toBeInTheDocument();
  });

  it("reports a file it cannot read, and a file served from the fallback branch", async () => {
    renderWithProviders(<Desktop />, {
      initialOpen: [notepad(["gone.txt", APP], "gone.txt")],
      disk: { source: { missingAtCommit: [APP] } },
    });
    expect(
      await screen.findByText(/Notepad\+\+ cannot open gone\.txt: .*HTTP 404/),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /App\.tsx/ }));
    await editor();
    expect(screen.getByText(NOT_ON_GITHUB_NOTICE)).toBeInTheDocument();
  });

  it("opens the floppy's homework.txt as a plain text file", async () => {
    renderWithProviders(<Desktop />, {
      initialOpen: [notepad([HOMEWORK_LOCATION])],
    });
    expect(await editor()).toHaveValue(HOMEWORK_TEXT);
    expect(screen.getByText("Normal text file")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "homework.txt - Notepad++" }),
    ).toBeInTheDocument();
  });

  it("routes Edit and View through the editor handle", async () => {
    const { editors } = renderWithProviders(<Desktop />, {
      initialOpen: [notepad([README])],
    });
    await editor();
    await openMenu("Edit", "Undo");
    await openMenu("Edit", "Redo");
    expect(editors[0]?.undoCalls).toBe(1);
    expect(editors[0]?.redoCalls).toBe(1);
    await openMenu("Edit", "Select All");
    expect(editors[0]?.wordWrap).toBe(false);
    await openMenu("View", "Word wrap");
    await waitFor(() => expect(editors[0]?.wordWrap).toBe(true));
    const field = screen.getByRole("textbox", { name: "Editor" });
    if (!(field instanceof HTMLTextAreaElement)) throw new Error("no textarea");
    field.setSelectionRange(13, 13);
    fireEvent.click(field);
    expect(screen.getByText(/Ln : 1 Col : 14/)).toBeInTheDocument();
  });

  it("exits from the File menu and opens About from Help", async () => {
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [notepad([README])],
    });
    await editor();
    await openMenu("Help", "About Notepad++");
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "notepadpp",
      "about",
    ]);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "README.md - Notepad++" }),
    );
    await openMenu("File", "Exit");
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "about",
    ]);
  });

  it("is on the Start menu under Accessories, opening the README", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("menuitem", { name: "Programs" }));
    await user.click(screen.getByRole("menuitem", { name: "Accessories" }));
    await user.click(screen.getByRole("menuitem", { name: "Notepad++" }));
    expect(store.load().windows).toEqual([
      expect.objectContaining({ kind: "notepadpp", paths: ["README.md"] }),
    ]);
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("menuitem", { name: "Programs" }));
    await user.click(screen.getByRole("menuitem", { name: "Accessories" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Windows Explorer" }),
    );
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "notepadpp",
      "explorer",
    ]);
  });
});
