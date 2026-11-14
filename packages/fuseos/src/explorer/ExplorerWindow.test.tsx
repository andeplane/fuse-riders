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
import type { FakeSoundService } from "../__mocks__/soundService";
import { Desktop } from "../desktop/Desktop";
import type { StartMenuRegistration } from "../desktop/startMenuRegistry";
import {
  START_MENU_REGISTRATIONS,
  StartMenuRegistryContext,
} from "../desktop/startMenuRegistry";
import { DRIVE_A, DRIVE_C, MY_COMPUTER } from "../disk/diskPath";
import {
  CLIPPY_PORN_HELP,
  PASSWORD_DIALOG_TITLE,
  RICKROLL_NAME,
  RICKROLL_TITLE,
} from "../disk/floppy";
import type { AppState, WindowState } from "../state/appState";

import { MODIFIED_LABEL } from "./IconView";
import { CONNECTING_STATUS, GRANTED_STATUS } from "./NetworkPasswordDialog";
import {
  DESKTOP,
  DIAL_UP_MESSAGE,
  PRINTERS_MESSAGE,
  SCHEDULED_TASKS_MESSAGE,
} from "./shellNamespace";
import {
  addressNotFoundMessage,
  deleteDeniedMessage,
} from "./useExplorerViewModel";
import { WINZIP_STEP_MS } from "./WinZipDialog";

const explorerAt = (location: string) =>
  ({ kind: "explorer", location }) as const;

/** What the drives were heard doing; the start-up chime the desktop plays on mount is not theirs. */
function driveSounds(sounds: FakeSoundService): string[] {
  return sounds.plays
    .map((play) => play.event)
    .filter((event) => event === "floppy" || event === "seek");
}

function contents() {
  return within(screen.getByLabelText("Folder contents"));
}

/** An entry in the icon views (List is the view Explorer opens in). */
function item(name: string | RegExp) {
  return contents().getByRole("option", { name });
}

/** An entry in the Details view. */
function row(name: string | RegExp) {
  return contents().getByRole("row", { name });
}

function tree() {
  return within(screen.getByRole("tree", { name: "Folders" }));
}

function address() {
  return screen.getByRole("textbox", { name: "Address" });
}

function statusBar() {
  return within(screen.getByRole("contentinfo", { name: "Status bar" }));
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
      screen.getByRole("dialog", { name: "Exploring - My Computer" }),
    ).toBeInTheDocument();
    expect(address()).toHaveValue("My Computer");
    // Windows' own order: the drives by letter, then the system folders.
    expect(
      contents()
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "3½ Floppy (A:)",
      "Fuse Riders (C:)",
      "Printers",
      "Control Panel",
      "Dial-Up Networking",
      "Scheduled Tasks",
    ]);
    expect(screen.getByRole("listbox", { name: "List" })).toBeInTheDocument();
    expect(
      tree().getByRole("treeitem", { name: "My Computer" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      tree()
        .getAllByRole("treeitem")
        .map((node) => node.textContent),
    ).toEqual([
      "Desktop",
      "My Computer",
      "3½ Floppy (A:)",
      "Fuse Riders (C:)",
      "Printers",
      "Control Panel",
      "Dial-Up Networking",
      "Scheduled Tasks",
      // Installed in this build (D4), so it sits on the Desktop next to My Computer.
      "Network Neighborhood",
    ]);
    await waitFor(() =>
      expect(statusBar().getByText("6 object(s)")).toBeInTheDocument(),
    );
    expect(statusBar().getByText("My Computer")).toBeInTheDocument();
  });

  it("lists the repository on C: from the manifest with sizes, types and the commit date", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await user.dblClick(item(/Fuse Riders \(C:\)/));
    expect(address()).toHaveValue("C:\\");
    await waitFor(() => expect(item(/README\.md/)).toBeInTheDocument());
    await openMenu("View", "Details");
    expect(
      contents()
        .getAllByRole("row")
        .slice(1)
        .map((item) => item.textContent),
    ).toEqual([
      "docsFile Folder11/14/26, 1:39 PM",
      "packagesFile Folder11/14/26, 1:39 PM",
      "publicFile Folder11/14/26, 1:39 PM",
      "WINDOWSFile Folder5/11/98, 8:01 PM",
      "package.json1 KBJSON Document11/14/26, 1:39 PM",
      "README.md1 KBMarkdown Document11/14/26, 1:39 PM",
    ]);
    // The status bar: how many, how much, and which commit C: is a copy of.
    expect(statusBar().getByText("6 object(s)")).toBeInTheDocument();
    expect(statusBar().getByText("1 KB")).toBeInTheDocument();
    expect(
      statusBar().getByText(
        `andeplane/fuse-games @ ${FIXTURE_SHA.slice(0, 7)}`,
      ),
    ).toBeInTheDocument();
    await user.click(row(/README\.md/));
    expect(statusBar().getByText("1 object(s) selected")).toBeInTheDocument();
    expect(statusBar().getByText("1 KB")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Exploring - C:\\" }),
    ).toBeInTheDocument();
  });

  it("navigates with the tree, Up, Back and Forward", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
    await user.click(
      screen.getByRole("button", { name: "Expand Fuse Riders (C:)" }),
    );
    await user.click(tree().getByRole("treeitem", { name: "packages" }));
    expect(address()).toHaveValue("C:\\packages");
    expect(item(/fuseos/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Up" }));
    expect(address()).toHaveValue("C:\\");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(address()).toHaveValue("C:\\packages");
    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(address()).toHaveValue("C:\\");
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward menu" })).toBeDisabled();
  });

  it("goes back several places at once from the Back button's drop-down", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    expect(screen.getByRole("button", { name: "Back menu" })).toBeDisabled();
    await user.dblClick(item(/Fuse Riders/));
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
    await user.dblClick(item(/packages/));
    await user.dblClick(item(/fuseos/));
    expect(address()).toHaveValue("C:\\packages\\fuseos");
    await user.click(screen.getByRole("button", { name: "Back menu" }));
    const back = within(screen.getByRole("menu", { name: "Back menu" }));
    // Nearest first, each by the name of the place.
    expect(
      back.getAllByRole("menuitem").map((step) => step.textContent),
    ).toEqual(["packages", "Fuse Riders (C:)", "My Computer"]);
    await user.click(back.getByRole("menuitem", { name: "Fuse Riders (C:)" }));
    expect(address()).toHaveValue("C:\\");
    await user.click(screen.getByRole("button", { name: "Forward menu" }));
    await user.click(
      within(screen.getByRole("menu", { name: "Forward menu" })).getByRole(
        "menuitem",
        { name: "fuseos" },
      ),
    );
    expect(address()).toHaveValue("C:\\packages\\fuseos");
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });

  it("opens the tree down to the folder shown, with a box only where there are folders inside", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Expand Fuse Riders (C:)" }),
      ).toBeInTheDocument(),
    );
    // System folders are programs, not places with folders in them.
    expect(
      screen.queryByRole("button", { name: /(Expand|Collapse) Printers/ }),
    ).not.toBeInTheDocument();
    await user.clear(address());
    await user.type(address(), "C:\\packages\\fuseos{Enter}");
    expect(tree().getByRole("treeitem", { name: "fuseos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Collapse packages" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse packages" }));
    expect(
      tree().queryByRole("treeitem", { name: "fuseos" }),
    ).not.toBeInTheDocument();
    // A double click on a folder in the tree opens and closes it too.
    await user.dblClick(tree().getByRole("treeitem", { name: "packages" }));
    expect(
      tree().getByRole("treeitem", { name: "fuseos" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Collapse My Computer" }),
    );
    expect(
      tree().queryByRole("treeitem", { name: "Fuse Riders (C:)" }),
    ).not.toBeInTheDocument();
    // The Desktop itself has no box and stays open.
    await user.dblClick(tree().getByRole("treeitem", { name: "Desktop" }));
    expect(
      tree().getByRole("treeitem", { name: "My Computer" }),
    ).toBeInTheDocument();
  });

  it("puts My Computer on the Desktop: Up, the tree and the address all reach it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await user.click(screen.getByRole("button", { name: "Up" }));
    expect(address()).toHaveValue("Desktop");
    expect(
      screen.getByRole("dialog", { name: "Exploring - Desktop" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Up" })).toBeDisabled();
    expect(
      contents()
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["My Computer", "Network Neighborhood"]);
    await user.dblClick(item("My Computer"));
    expect(address()).toHaveValue("My Computer");
    await user.clear(address());
    await user.type(address(), "desktop{Enter}");
    expect(tree().getByRole("treeitem", { name: "Desktop" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await openMenu("Go", "My Computer");
    expect(address()).toHaveValue("My Computer");
    await openMenu("Favorites", "Desktop");
    expect(address()).toHaveValue("Desktop");
    await openMenu("Favorites", "Fuse Riders (C:)");
    expect(address()).toHaveValue("C:\\");
    await openMenu("Favorites", "3½ Floppy (A:)");
    expect(address()).toHaveValue("A:\\");
  });

  it("lists the places above and beside this folder in the Address drop-down", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt("C:/packages")],
    });
    await waitFor(() => expect(item(/fuseos/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Address list" }));
    const places = within(screen.getByRole("menu", { name: "Address list" }));
    expect(
      places.getAllByRole("menuitem").map((place) => place.textContent),
    ).toEqual([
      "Desktop",
      "My Computer",
      "Fuse Riders (C:)",
      "packages",
      "3½ Floppy (A:)",
    ]);
    await user.click(places.getByRole("menuitem", { name: "My Computer" }));
    expect(address()).toHaveValue("My Computer");
    expect(
      screen.queryByRole("menu", { name: "Address list" }),
    ).not.toBeInTheDocument();
  });

  it("opens Control Panel from its system folder and explains the ones with no program", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await user.dblClick(item("Printers"));
    expect(screen.getByRole("dialog", { name: "Printers" })).toHaveTextContent(
      PRINTERS_MESSAGE.split("\n")[0] ?? "",
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.click(
      tree().getByRole("treeitem", { name: "Dial-Up Networking" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Dial-Up Networking" }),
    ).toHaveTextContent(DIAL_UP_MESSAGE.split("\n")[0] ?? "");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.dblClick(item("Scheduled Tasks"));
    expect(
      screen.getByRole("dialog", { name: "Scheduled Tasks" }),
    ).toHaveTextContent(SCHEDULED_TASKS_MESSAGE.split("\n")[0] ?? "");
    await user.click(screen.getByRole("button", { name: "OK" }));
    // None of them is a place: Explorer stays where it was.
    expect(address()).toHaveValue("My Computer");
    await user.dblClick(item("Control Panel"));
    expect(windowsOf(store).map((window) => window.kind)).toEqual([
      "explorer",
      "controlpanel",
    ]);
  });

  it("shows Network Neighborhood and the Recycle Bin on the Desktop once their programs are installed", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    const installed: StartMenuRegistration[] = [
      {
        slot: "programs",
        id: "network-neighborhood",
        label: "Network Neighborhood",
        icon: "network",
        open: () => opened.push("network"),
      },
      {
        slot: "programs",
        id: "recycle-bin",
        label: "Recycle Bin",
        icon: "recycle",
        open: () => opened.push("recycle"),
      },
      // Registered but not in this build: no folder for it.
      { slot: "programs", id: "network", label: "Network", icon: "network" },
    ];
    const { unmount } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DESKTOP)],
    });
    expect(
      tree().queryByRole("treeitem", { name: "Recycle Bin" }),
    ).not.toBeInTheDocument();
    unmount();
    renderWithProviders(
      <StartMenuRegistryContext.Provider
        value={[
          // This build's own Network Neighborhood gives way to the recording one.
          ...START_MENU_REGISTRATIONS.filter(
            (entry) => entry.id !== "network-neighborhood",
          ),
          ...installed,
        ]}
      >
        <Desktop />
      </StartMenuRegistryContext.Provider>,
      { initialOpen: [explorerAt(DESKTOP)] },
    );
    expect(
      contents()
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["My Computer", "Network Neighborhood", "Recycle Bin"]);
    await user.dblClick(item("Recycle Bin"));
    await user.click(
      tree().getByRole("treeitem", { name: "Network Neighborhood" }),
    );
    expect(opened).toEqual(["recycle", "network"]);
  });

  it("accepts a typed address and complains about one it cannot find", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
    await user.clear(address());
    await user.type(address(), "c:\\packages\\fuseos\\src{Enter}");
    expect(item(/App\.tsx/)).toBeInTheDocument();
    await user.clear(address());
    await user.type(address(), "C:\\nowhere{Enter}");
    expect(
      screen.getByText(addressNotFoundMessage("C:\\nowhere")),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));
    // The typed text stays for correction; the listing did not move.
    expect(address()).toHaveValue("C:\\nowhere");
    expect(item(/App\.tsx/)).toBeInTheDocument();
  });

  it("opens text in Notepad++, adding a tab to the window that is already open", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt("C:/packages/fuseos/src")],
    });
    await waitFor(() => expect(item(/App\.tsx/)).toBeInTheDocument());
    await user.dblClick(item(/App\.tsx/));
    expect(
      await screen.findByRole("tab", { name: /App\.tsx/ }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("toolbar", { name: "Taskbar" })).getByRole(
        "button",
        { name: /Exploring/ },
      ),
    );
    await user.dblClick(item(/main\.tsx/));
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
    await waitFor(() => expect(item(/huge\.log/)).toBeInTheDocument());
    await user.dblClick(item(/huge\.log/));
    expect(screen.getByText(/huge\.log is 900 KB/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.clear(address());
    await user.type(address(), "C:\\public\\music{Enter}");
    await user.dblClick(
      item(new RegExp(FIXTURE_BINARY.split("/").pop() ?? "")),
    );
    expect(
      screen.getByText(/Windows cannot open this file/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));

    await user.clear(address());
    await user.type(address(), "C:\\public\\gallery{Enter}");
    // A picture opens in Paint, fetched from the commit's raw URL.
    const url = `memory://andeplane/fuse-games/${FIXTURE_SHA}/${FIXTURE_IMAGE}`;
    paintFiles.images.set(url, new Blob(["jpg"], { type: "image/jpeg" }));
    await user.dblClick(item(/fuseball\.jpg/));
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
    const { sounds } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
      diskDeps,
    });
    await user.dblClick(item(/3½ Floppy/));
    expect(contents().getByText("Reading drive A:...")).toBeInTheDocument();
    expect(diskDeps.seeks).toBe(1);
    // The drive is heard spinning up while the listing waits.
    expect(driveSounds(sounds)).toEqual(["floppy"]);
    await act(async () => {
      finishSeek();
      await Promise.resolve();
    });
    await waitFor(() => expect(item(/slackbacup\.zip/)).toBeInTheDocument());
    await openMenu("View", "Details");
    expect(
      row(/slackbacup\.zip 1\.35 MB WinZip File 8\/14\/97, 3:12 AM/),
    ).toBeInTheDocument();
    await openMenu("View", "List");
    expect(item(/porn/)).toBeInTheDocument();
    // A subfolder of A: is already spinning: no second seek.
    diskDeps.jokeGate.tryPassword("mender");
    await user.dblClick(item(/porn/));
    expect(diskDeps.seeks).toBe(1);
    // ...only the short seek every folder gets.
    expect(driveSounds(sounds)).toEqual(["floppy", "seek"]);
    expect(address()).toHaveValue("A:\\porn");
  });

  it("extracts slackbacup.zip until the disk turns out to be a coaster", async () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_A)] });
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.doubleClick(item(/slackbacup/));
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
    await user.dblClick(item(/slackbacup/));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "WinZip - slackbacup.zip" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/may be a coaster/)).not.toBeInTheDocument();
  });

  it("asks for A:\\porn's network password, refuses wrong ones and brings Clippy in on the third", async () => {
    const user = userEvent.setup();
    const { diskDeps } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_A)],
    });
    await user.dblClick(item(/porn/));
    const box = screen.getByRole("dialog", { name: PASSWORD_DIALOG_TITLE });
    expect(box).toHaveTextContent(
      "You must supply a password to make this connection:",
    );
    expect(within(box).getByTestId("password-resource")).toHaveTextContent(
      "\\\\A:\\porn",
    );
    const field = within(box).getByLabelText("Password:");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveFocus();
    expect(address()).toHaveValue("A:\\");
    for (const guess of ["password", "hunter2", "letmein"]) {
      await user.type(within(box).getByLabelText("Password:"), guess);
      await user.click(within(box).getByRole("button", { name: "OK" }));
      const error = screen
        .getAllByRole("dialog", { name: PASSWORD_DIALOG_TITLE })
        .find((dialog) => dialog !== box);
      expect(error).toHaveTextContent(
        "The password is incorrect. Access is denied.",
      );
      if (!error) return;
      expect(within(box).getByLabelText("Password:")).toHaveValue("");
      if (guess !== "letmein")
        expect(screen.queryByText(CLIPPY_PORN_HELP)).not.toBeInTheDocument();
      await user.click(within(error).getByRole("button", { name: "OK" }));
    }
    expect(diskDeps.jokeGate.failures()).toBe(3);
    expect(screen.getByText(CLIPPY_PORN_HELP)).toBeInTheDocument();
    // Cancel leaves the folder shut.
    await user.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: PASSWORD_DIALOG_TITLE }),
    ).not.toBeInTheDocument();
    expect(contents().queryByText(RICKROLL_NAME)).not.toBeInTheDocument();
  });

  it("logs on with the password in any case, shows the one video and plays it in the Media Player", async () => {
    const user = userEvent.setup();
    const beats: (() => void)[] = [];
    const diskDeps = createTestDiskDeps({
      logonPause: () =>
        new Promise<void>((resolve) => {
          beats.push(resolve);
        }),
    });
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_A)],
      diskDeps,
    });
    await user.dblClick(item(/porn/));
    const box = screen.getByRole("dialog", { name: PASSWORD_DIALOG_TITLE });
    await user.type(within(box).getByLabelText("Password:"), "MeNdEr{Enter}");
    expect(box).toHaveTextContent(CONNECTING_STATUS);
    expect(within(box).getByRole("button", { name: "OK" })).toBeDisabled();
    await act(async () => {
      beats.shift()?.();
      await Promise.resolve();
    });
    expect(box).toHaveTextContent(GRANTED_STATUS);
    await act(async () => {
      beats.shift()?.();
      await Promise.resolve();
    });
    expect(diskDeps.logonSteps).toEqual(["connecting", "granted"]);
    expect(
      screen.queryByRole("dialog", { name: PASSWORD_DIALOG_TITLE }),
    ).not.toBeInTheDocument();
    expect(address()).toHaveValue("A:\\porn");
    expect(
      contents()
        .getAllByRole("option")
        .map((entry) => entry.textContent),
    ).toEqual([RICKROLL_NAME]);
    expect(
      screen.getByRole("dialog", {
        name: `${RICKROLL_TITLE} - Windows Media Player`,
      }),
    ).toBeInTheDocument();
    expect(windowsOf(store)).toContainEqual(
      expect.objectContaining({ kind: "mediaplayer", stream: "rickroll" }),
    );
    // Once in, the folder opens without asking, and the video opens the same player again.
    await user.click(screen.getByRole("button", { name: "Up" }));
    await user.dblClick(item(/porn/));
    expect(
      screen.queryByRole("dialog", { name: PASSWORD_DIALOG_TITLE }),
    ).not.toBeInTheDocument();
    await user.dblClick(item(/definitely_not_porn/));
    expect(
      windowsOf(store).filter((window) => window.kind === "mediaplayer"),
    ).toHaveLength(1);
  });

  it("keeps A:\\porn shut from the address bar and from a window restored inside it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt("A:/porn")],
    });
    expect(
      await screen.findByRole("dialog", { name: PASSWORD_DIALOG_TITLE }),
    ).toBeInTheDocument();
    await waitFor(() => expect(address()).toHaveValue("A:\\"));
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: PASSWORD_DIALOG_TITLE }),
    ).not.toBeInTheDocument();
    await user.type(address(), "{Control>}a{/Control}A:\\porn{Enter}");
    expect(
      screen.getByRole("dialog", { name: PASSWORD_DIALOG_TITLE }),
    ).toBeInTheDocument();
    expect(contents().queryByText(RICKROLL_NAME)).not.toBeInTheDocument();
  });

  it("deletes SYSTEM32 into the gag's questions, and lists what it holds without opening any of it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_C)],
    });
    await waitFor(() => expect(item(/WINDOWS/)).toBeInTheDocument());
    await user.dblClick(item(/WINDOWS/));
    expect(address()).toHaveValue("C:\\WINDOWS");
    // From the context menu: the first of the three questions, and No keeps the folder.
    fireEvent.contextMenu(item(/SYSTEM32/), { clientX: 10, clientY: 10 });
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Are you sure you want to remove the folder 'SYSTEM32'",
    );
    await user.click(screen.getByRole("button", { name: "No" }));
    expect(item(/SYSTEM32/)).toBeInTheDocument();
    // The Delete key asks the same; File > Delete too, and three times Yes and the folder is gone.
    await user.click(item(/SYSTEM32/));
    await user.keyboard("{Delete}");
    await user.click(screen.getByRole("button", { name: "No" }));
    await user.click(item(/SYSTEM32/));
    await openMenu("File", "Delete");
    for (let question = 0; question < 3; question += 1)
      await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(contents().queryByText("SYSTEM32")).not.toBeInTheDocument();
  });

  it("lists SYSTEM32's files by address, and none of them opens", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_C)],
    });
    await waitFor(() => expect(item(/WINDOWS/)).toBeInTheDocument());
    await user.type(
      address(),
      "{Control>}a{/Control}C:\\WINDOWS\\SYSTEM32{Enter}",
    );
    await waitFor(() => expect(item(/KERNEL32\.DLL/)).toBeInTheDocument());
    await user.dblClick(item(/KERNEL32\.DLL/));
    expect(screen.getByRole("dialog", { name: "Open With" })).toHaveTextContent(
      "Windows cannot open this file",
    );
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
    expect(item(/README\.md/)).toContainElement(
      screen.getByRole("img", { name: MODIFIED_LABEL }),
    );
    fireEvent.contextMenu(item(/README\.md/), { clientX: 10, clientY: 10 });
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
    await user.click(item(/README\.md/));
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Revert to original" }),
    ).toBeDisabled();
  });

  it("moves the selection with the keyboard, opens with Enter and goes up with Backspace", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
    const pane = screen.getByLabelText("Folder contents");
    pane.focus();
    await user.keyboard("{ArrowDown}");
    expect(item(/^docs/)).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(item(/^packages/)).toHaveAttribute("aria-selected", "true");
    expect(statusBar().getByText("1 object(s) selected")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(address()).toHaveValue("C:\\packages");
    await user.keyboard("{Backspace}");
    expect(address()).toHaveValue("C:\\");
    await user.keyboard("{ArrowUp}{Escape}");
    expect(
      contents().queryAllByRole("option", { selected: true }),
    ).toHaveLength(0);
  });

  it("steps through Large Icons, Small Icons, List and Details from the Views button and its menu", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
    expect(screen.getByRole("listbox", { name: "List" })).toBeInTheDocument();
    // The button itself takes the next view, round and round.
    await user.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.getByRole("table", { name: "Details" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Views" }));
    const large = screen.getByRole("listbox", { name: "Large icons" });
    expect(within(large).getAllByRole("option")).toHaveLength(6);
    expect(large.querySelector("svg")).toHaveAttribute("width", "32");
    await user.click(screen.getByRole("button", { name: "Views" }));
    const small = screen.getByRole("listbox", { name: "Small icons" });
    expect(small.querySelector("svg")).toHaveAttribute("width", "16");
    await user.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.getByRole("listbox", { name: "List" })).toBeInTheDocument();
    // Its arrow names them, with the current one checked.
    await user.click(screen.getByRole("button", { name: "Views menu" }));
    const views = within(screen.getByRole("menu", { name: "Views menu" }));
    expect(
      views.getByRole("menuitemcheckbox", { name: "List" }),
    ).toHaveAttribute("aria-checked", "true");
    await user.click(
      views.getByRole("menuitemcheckbox", { name: "Small Icons" }),
    );
    expect(
      screen.getByRole("listbox", { name: "Small icons" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "Views menu" }),
    ).not.toBeInTheDocument();
  });

  it("sorts Details by a column header and closes the All Folders pane from its x", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
    await openMenu("View", "Details");
    const names = () =>
      contents()
        .getAllByRole("row")
        .slice(1)
        .map((entry) => entry.querySelector("td")?.textContent);
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual([
      "WINDOWS",
      "public",
      "packages",
      "docs",
      "README.md",
      "package.json",
    ]);
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await user.click(screen.getByRole("button", { name: "Size" }));
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "none",
    );
    // A row has the same menu as an icon: Explore is its default.
    fireEvent.contextMenu(row(/packages/), { clientX: 10, clientY: 10 });
    await user.click(screen.getByRole("menuitem", { name: "Properties" }));
    expect(
      screen.getByRole("dialog", { name: "packages Properties" }),
    ).toHaveTextContent("Type: File Folder");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.click(row(/packages/));
    await openMenu("File", "Explore");
    expect(address()).toHaveValue("C:\\packages");
    await user.click(screen.getByRole("button", { name: "Up" }));
    await user.click(screen.getByRole("button", { name: "Close All Folders" }));
    expect(
      screen.queryByRole("tree", { name: "Folders" }),
    ).not.toBeInTheDocument();
    await openMenu("View", "All Folders");
    expect(screen.getByRole("tree", { name: "Folders" })).toBeInTheDocument();
  });

  it("sorts My Computer by name once a column is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await openMenu("View", "Details");
    await user.click(screen.getByRole("button", { name: "Type" }));
    expect(
      contents()
        .getAllByRole("row")
        .slice(1)
        .map((entry) => entry.querySelector("td")?.textContent),
    ).toEqual([
      "3½ Floppy (A:)",
      "Fuse Riders (C:)",
      "Control Panel",
      "Dial-Up Networking",
      "Printers",
      "Scheduled Tasks",
    ]);
  });

  it("refuses to delete from the read-only disk, and Delete on a saved copy reverts it", async () => {
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
    // Nothing selected: the button is grey, like the clipboard ones always are.
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    for (const label of ["Cut", "Copy", "Paste", "Undo"])
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    await user.click(item(/package\.json/));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      screen.getByRole("dialog", { name: "Error Deleting File" }),
    ).toHaveTextContent(
      deleteDeniedMessage("package.json").split("\n")[0] ?? "",
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.click(item(/README\.md/));
    await openMenu("File", "Delete");
    await waitFor(() =>
      expect(
        screen.queryByRole("img", { name: MODIFIED_LABEL }),
      ).not.toBeInTheDocument(),
    );
    await expect(diskDeps.overlay.list()).resolves.toEqual([]);
    // With the selection gone again, Delete does nothing.
    await user.keyboard("{Escape}");
    fireEvent.contextMenu(item(/docs/), { clientX: 10, clientY: 10 });
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(
      screen.getByRole("dialog", { name: "Error Deleting File" }),
    ).toBeInTheDocument();
  });

  it("shows Properties for the selection, and for the folder itself with nothing selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(DRIVE_C)],
      disk: { overlay: { "README.md": "# changed" } },
    });
    await waitFor(() => expect(item(/README\.md/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Properties" }));
    const drive = screen.getByRole("dialog", {
      name: "Fuse Riders (C:) Properties",
    });
    expect(drive).toHaveTextContent("Type: Drive");
    expect(drive).toHaveTextContent("Contains: 6 object(s)");
    await user.click(within(drive).getByRole("button", { name: "OK" }));

    await user.click(item(/README\.md/));
    screen.getByLabelText("Folder contents").focus();
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    const file = screen.getByRole("dialog", { name: "README.md Properties" });
    expect(file).toHaveTextContent("Type: Markdown Document");
    expect(file).toHaveTextContent("Location: C:\\");
    expect(file).toHaveTextContent("Size: 1 KB");
    expect(file).toHaveTextContent("Modified: 11/14/26, 1:39 PM");
    expect(file).toHaveTextContent("Attributes: Saved copy on this computer");
    await user.click(within(file).getByRole("button", { name: "OK" }));

    // A drive has neither a size nor a date; a folder and the Desktop say what they are.
    await openMenu("Go", "My Computer");
    await user.click(item(/3½ Floppy/));
    await openMenu("File", "Properties");
    const floppy = screen.getByRole("dialog", {
      name: "3½ Floppy (A:) Properties",
    });
    expect(floppy).toHaveTextContent("Type: 3½ Inch Floppy Disk");
    expect(floppy).not.toHaveTextContent("Size:");
    await user.click(within(floppy).getByRole("button", { name: "OK" }));
    await user.keyboard("{Escape}");
    fireEvent.contextMenu(screen.getByLabelText("Folder contents"), {
      clientX: 5,
      clientY: 5,
    });
    await user.click(screen.getByRole("menuitem", { name: "Properties" }));
    expect(
      screen.getByRole("dialog", { name: "My Computer Properties" }),
    ).toHaveTextContent("Type: System Folder");
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.clear(address());
    await user.type(address(), "C:\\packages{Enter}");
    await openMenu("File", "Properties");
    expect(
      screen.getByRole("dialog", { name: "packages Properties" }),
    ).toHaveTextContent("Type: File Folder");
  });

  it("keeps the clipboard and network commands in the menus, greyed out", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialOpen: [explorerAt(MY_COMPUTER)],
    });
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    for (const label of ["Undo", "Cut", "Copy", "Paste"])
      expect(
        screen.getByRole("menuitemcheckbox", { name: label }),
      ).toBeDisabled();
    // With a menu open, the pointer alone moves along the bar.
    await user.hover(screen.getByRole("menuitem", { name: "Tools" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Map Network Drive..." }),
    ).toBeDisabled();
    await user.hover(screen.getByRole("menuitem", { name: "Favorites" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Add to Favorites..." }),
    ).toBeDisabled();
    // The logo at the end of the menu band is still while nothing is being read.
    expect(screen.getByRole("img", { name: "FuseOS" })).toBeInTheDocument();
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
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
  });

  it("opens the background context menu with the view choices and a keyboard menu on the selection", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [explorerAt(DRIVE_C)] });
    await waitFor(() => expect(item(/packages/)).toBeInTheDocument());
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
    fireEvent.contextMenu(screen.getByLabelText("Folder contents"), {
      clientX: 5,
      clientY: 5,
    });
    await user.click(screen.getByRole("menuitem", { name: "Refresh" }));
    await user.click(screen.getByRole("option", { name: /packages/ }));
    fireEvent.keyDown(screen.getByLabelText("Folder contents"), {
      key: "F10",
      shiftKey: true,
    });
    await user.click(screen.getByRole("menuitem", { name: "Explore" }));
    expect(address()).toHaveValue("C:\\packages");
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
        { name: "Exploring - My Computer" },
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
