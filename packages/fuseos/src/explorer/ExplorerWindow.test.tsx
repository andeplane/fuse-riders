import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createTestDiskDeps,
  FIXTURE_BINARY,
  FIXTURE_IMAGE,
  FIXTURE_SHA,
} from "../__mocks__/disk";
import { FakePaintFileDeps } from "../__mocks__/paintFiles";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { DRIVE_A, DRIVE_C, MY_COMPUTER } from "../disk/diskPath";
import { HOMEWORK_LOCATION, HOMEWORK_TEXT } from "../disk/floppy";
import type { AppState, WindowState } from "../state/appState";

import { MODIFIED_LABEL } from "./IconView";
import { addressNotFoundMessage } from "./useExplorerViewModel";
import { WINZIP_STEP_MS } from "./WinZipDialog";

const explorerAt = (location: string) =>
  ({ kind: "explorer", location }) as const;

function contents() {
  return within(screen.getByLabelText("Folder contents"));
}

function row(name: string | RegExp) {
  return contents().getByRole("row", { name });
}

async function openMenu(menu: string, item: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("menuitem", { name: menu }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: item }));
}

function windowsOf(store: { load: () => AppState }): WindowState[] {
  return store.load().windows;
}

describe("Explorer", () => {
  it("opens My Computer with both drives, the folders pane and the address bar", async () => {
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    expect(
      screen.getByRole("dialog", { name: "My Computer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "My Computer",
    );
    expect(row(/3½ Floppy \(A:\)/)).toBeInTheDocument();
    expect(row(/Fuse Riders \(C:\)/)).toBeInTheDocument();
    const tree = within(screen.getByRole("list", { name: "Folders" }));
    expect(tree.getByRole("link", { name: "My Computer" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() =>
      expect(screen.getByText("2 object(s)")).toBeInTheDocument(),
    );
  });

  it("lists the repository on C: from the manifest with sizes, types and the commit date", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await user.dblClick(row(/Fuse Riders \(C:\)/));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\",
    );
    await waitFor(() => expect(row(/README\.md/)).toBeInTheDocument());
    expect(
      contents()
        .getAllByRole("row")
        .slice(1)
        .map((item) => item.textContent),
    ).toEqual([
      "docsFile Folder11/14/26, 1:39 PM",
      "packagesFile Folder11/14/26, 1:39 PM",
      "publicFile Folder11/14/26, 1:39 PM",
      "package.json1 KBJSON Document11/14/26, 1:39 PM",
      "README.md1 KBMarkdown Document11/14/26, 1:39 PM",
    ]);
    expect(
      screen.getByText(`andeplane/fuse-games @ ${FIXTURE_SHA.slice(0, 7)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Exploring - C:\\" }),
    ).toBeInTheDocument();
  });

  it("navigates with the tree, Up, Back and Forward", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(row(/packages/)).toBeInTheDocument());
    await user.click(
      screen.getByRole("button", { name: "Expand Fuse Riders (C:)" }),
    );
    const tree = within(screen.getByRole("list", { name: "Folders" }));
    await user.click(tree.getByRole("link", { name: "packages" }));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\packages",
    );
    expect(row(/fuseos/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Up" }));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\",
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\packages",
    );
    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\",
    );
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("accepts a typed address and complains about one it cannot find", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(row(/packages/)).toBeInTheDocument());
    const address = screen.getByRole("textbox", { name: "Address" });
    await user.clear(address);
    await user.type(address, "c:\\packages\\fuseos\\src{Enter}");
    expect(row(/App\.tsx/)).toBeInTheDocument();
    await user.clear(address);
    await user.type(address, "C:\\nowhere{Enter}");
    expect(
      screen.getByText(addressNotFoundMessage("C:\\nowhere")),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));
    // The typed text stays for correction; the listing did not move.
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\nowhere",
    );
    expect(row(/App\.tsx/)).toBeInTheDocument();
  });

  it("opens text in Notepad++, adding a tab to the window that is already open", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt("C:/packages/fuseos/src")],
    });
    await waitFor(() => expect(row(/App\.tsx/)).toBeInTheDocument());
    await user.dblClick(row(/App\.tsx/));
    expect(
      await screen.findByRole("tab", { name: /App\.tsx/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Exploring/ }));
    await user.dblClick(row(/main\.tsx/));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    const notepads = windowsOf(store).filter(
      (window) => window.kind === "notepadpp",
    );
    expect(notepads).toEqual([
      expect.objectContaining({
        paths: ["packages/fuseos/src/App.tsx", "packages/fuseos/src/main.tsx"],
        activePath: "packages/fuseos/src/main.tsx",
      }),
    ]);
  });

  it("refuses files that are too large or not text, and opens pictures in Paint", async () => {
    const user = userEvent.setup();
    const paintFiles = new FakePaintFileDeps();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt("C:/docs")],
      paintDeps: { files: paintFiles },
    });
    await waitFor(() => expect(row(/huge\.log/)).toBeInTheDocument());
    await user.dblClick(row(/huge\.log/));
    expect(screen.getByText(/huge\.log is 900 KB/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));

    const address = screen.getByRole("textbox", { name: "Address" });
    await user.clear(address);
    await user.type(address, "C:\\public\\music{Enter}");
    await user.dblClick(row(new RegExp(FIXTURE_BINARY.split("/").pop() ?? "")));
    expect(
      screen.getByText(/Windows cannot open this file/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.clear(address);
    await user.type(address, "C:\\public\\gallery{Enter}");
    // A picture opens in Paint, fetched from the commit's raw URL.
    const url = `memory://andeplane/fuse-games/${FIXTURE_SHA}/${FIXTURE_IMAGE}`;
    paintFiles.images.set(url, new Blob(["jpg"], { type: "image/jpeg" }));
    await user.dblClick(row(/fuseball\.jpg/));
    expect(
      await screen.findByRole("dialog", { name: "fuseball.jpg - Paint" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(paintFiles.fetched).toEqual([url]));
  });

  it("seeks the floppy once on the way into A:, then lists the archive and the folder", async () => {
    const user = userEvent.setup();
    let finishSeek = () => undefined as void;
    const diskDeps = createTestDiskDeps({
      floppySeek: () =>
        new Promise<void>((resolve) => {
          finishSeek = resolve;
        }),
    });
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
      diskDeps,
    });
    await user.dblClick(row(/3½ Floppy/));
    expect(contents().getByText("Reading drive A:...")).toBeInTheDocument();
    expect(diskDeps.seeks).toBe(1);
    await act(async () => {
      finishSeek();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        row(/slackbacup\.zip 1\.35 MB WinZip File 8\/14\/97, 3:12 AM/),
      ).toBeInTheDocument(),
    );
    expect(row(/porn/)).toBeInTheDocument();
    // A subfolder of A: is already spinning: no second seek.
    diskDeps.jokeGate.tryOpen();
    await user.dblClick(row(/porn/));
    expect(diskDeps.seeks).toBe(1);
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "A:\\porn",
    );
  });

  it("extracts slackbacup.zip until the disk turns out to be a coaster", async () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_A)] });
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.doubleClick(row(/slackbacup/));
      const dialog = screen.getByRole("dialog", {
        name: "WinZip - slackbacup.zip",
      });
      expect(within(dialog).getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "0",
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WINZIP_STEP_MS * 12);
      });
      expect(within(dialog).getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "40",
      );
      expect(within(dialog).getByText(/slackware\//)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WINZIP_STEP_MS * 40);
      });
      expect(
        screen.queryByRole("dialog", { name: "WinZip - slackbacup.zip" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/may be a coaster\./)).toHaveTextContent(
        /slackbacup\.zip is corrupt\. Disk in drive A: may be a coaster\./,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("can cancel the extraction", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_A)] });
    await user.dblClick(row(/slackbacup/));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "WinZip - slackbacup.zip" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/may be a coaster/)).not.toBeInTheDocument();
  });

  it("denies the joke folder once, then opens it to homework.txt in Notepad++", async () => {
    const user = userEvent.setup();
    const { diskDeps } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_A)],
    });
    await user.dblClick(row(/porn/));
    const denied = screen.getByRole("dialog", { name: "porn" });
    expect(within(denied).getByText(/Access is denied\./)).toHaveTextContent(
      /^A:\\porn is not accessible\. Access is denied\.$/,
    );
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "A:\\",
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.dblClick(row(/porn/));
    expect(diskDeps.jokeGate.attempts()).toBe(2);
    expect(row(/homework\.txt 1 KB Text Document/)).toBeInTheDocument();
    await user.dblClick(row(/homework\.txt/));
    expect(
      await screen.findByRole("tab", { name: /homework\.txt/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Editor" })).toHaveValue(
      HOMEWORK_TEXT,
    );
    expect(diskDeps.source.reads).toEqual([]);
  });

  it("marks files with a saved copy and reverts them from the context menu", async () => {
    const user = userEvent.setup();
    const { diskDeps } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_C)],
      disk: { overlay: { "README.md": "# changed" } },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: MODIFIED_LABEL }),
      ).toBeInTheDocument(),
    );
    expect(row(/README\.md/)).toContainElement(
      screen.getByRole("img", { name: MODIFIED_LABEL }),
    );
    fireEvent.contextMenu(row(/README\.md/), { clientX: 10, clientY: 10 });
    await user.click(
      screen.getByRole("menuitem", { name: "Revert to original" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: MODIFIED_LABEL }),
      ).not.toBeInTheDocument(),
    );
    await expect(diskDeps.overlay.list()).resolves.toEqual([]);
    // The File menu does the same for the selection; disabled once nothing is modified.
    await user.click(row(/README\.md/));
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Revert to original" }),
    ).toBeDisabled();
  });

  it("reverts the floppy's homework too", async () => {
    const user = userEvent.setup();
    const { diskDeps } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt("A:/porn")],
      disk: { overlay: { [HOMEWORK_LOCATION]: "PS." } },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: MODIFIED_LABEL }),
      ).toBeInTheDocument(),
    );
    await user.click(row(/homework/));
    await openMenu("File", "Revert to original");
    await expect(diskDeps.overlay.list()).resolves.toEqual([]);
  });

  it("moves the selection with the keyboard, opens with Enter and goes up with Backspace", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(row(/packages/)).toBeInTheDocument());
    const pane = screen.getByLabelText("Folder contents");
    pane.focus();
    await user.keyboard("{ArrowDown}");
    expect(row(/^docs/)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(row(/^packages/)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\packages",
    );
    await user.keyboard("{Backspace}");
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\",
    );
    await user.keyboard("{ArrowUp}{Escape}");
    expect(contents().queryAllByRole("row", { selected: true })).toHaveLength(
      0,
    );
  });

  it("switches between Details and Large Icons, hides the folders pane and sorts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(row(/packages/)).toBeInTheDocument());
    await openMenu("View", "Large Icons");
    const icons = within(screen.getByRole("listbox", { name: "Large icons" }));
    expect(icons.getAllByRole("option")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByRole("button", { name: "Name ▲" }));
    expect(
      contents()
        .getAllByRole("row")
        .slice(1)
        .map((item) => item.querySelector("td")?.textContent),
    ).toEqual(["public", "packages", "docs", "README.md", "package.json"]);
    await user.click(screen.getByRole("button", { name: "Folders" }));
    expect(
      screen.queryByRole("list", { name: "Folders" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Folders" }));
    expect(screen.getByRole("list", { name: "Folders" })).toBeInTheDocument();
  });

  it("shows the manifest failure on C: with a Retry that asks again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_C)],
      disk: { source: { manifestFailures: 1 } },
    });
    expect(
      await screen.findByText(/Drive C: is not ready: .*HTTP 503/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(row(/packages/)).toBeInTheDocument());
  });

  it("opens the background context menu with the view choices and a keyboard menu on the selection", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(row(/packages/)).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByLabelText("Folder contents"), {
      clientX: 5,
      clientY: 5,
    });
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Large Icons" }),
    );
    expect(
      screen.getByRole("listbox", { name: "Large icons" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /packages/ }));
    fireEvent.keyDown(screen.getByLabelText("Folder contents"), {
      key: "F10",
      shiftKey: true,
    });
    await user.click(screen.getByRole("menuitem", { name: "Explore" }));
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue(
      "C:\\packages",
    );
  });

  it("closes from the File menu and opens About from Help", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await openMenu("Help", "About Explorer");
    expect(windowsOf(store).map((window) => window.kind)).toEqual([
      "explorer",
      "about",
    ]);
    await user.click(
      within(screen.getByRole("toolbar", { name: "Taskbar" })).getByRole(
        "button",
        { name: "My Computer" },
      ),
    );
    await openMenu("File", "Close");
    expect(windowsOf(store).map((window) => window.kind)).toEqual(["about"]);
  });

  it("starts from the desktop icon and the Start menu", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />);
    await user.dblClick(
      within(screen.getByRole("list", { name: "Desktop icons" })).getByRole(
        "button",
        { name: "My Computer" },
      ),
    );
    expect(windowsOf(store)).toEqual([
      expect.objectContaining({ kind: "explorer", location: MY_COMPUTER }),
    ]);
  });
});
