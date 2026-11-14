import { createFixtureManifest } from "../__mocks__/disk";
import type { StartMenuRegistration } from "../desktop/startMenuRegistry";
import { START_MENU_REGISTRATIONS } from "../desktop/startMenuRegistry";
import type { ListingInputs } from "../disk/diskEntries";
import { DRIVE_A, DRIVE_C, MY_COMPUTER } from "../disk/diskPath";
import { RepoTree } from "../disk/repoTree";
import type { WindowContent } from "../state/appState";
import type { WindowCommands } from "../windows/useWindowCommands";

import {
  DESKTOP,
  DIAL_UP_MESSAGE,
  explorerTitle,
  findShellFolder,
  isVirtualFolder,
  listNamespace,
  MY_COMPUTER_ENTRY,
  namespaceAddress,
  namespaceAncestors,
  namespaceExists,
  namespaceIcon,
  namespaceName,
  namespaceParent,
  parseNamespaceAddress,
  PRINTERS_MESSAGE,
  SCHEDULED_TASKS_MESSAGE,
  shellFolderLocation,
  shellFolders,
} from "./shellNamespace";

const VIEWPORT = { width: 800, height: 600 };

/** Window commands that write down what they were asked to do. */
function recordingCommands() {
  const opened: WindowContent[] = [];
  const messages: { title: string; message: string }[] = [];
  const commands: WindowCommands = {
    open: (content) => opened.push(content),
    close: () => undefined,
    focus: () => undefined,
    minimize: () => undefined,
    toggleMaximize: () => undefined,
    showError: (title, message) => messages.push({ title, message }),
    showInfo: (title, message) => messages.push({ title, message }),
  };
  return { commands, opened, messages };
}

function inputs(): ListingInputs {
  const manifest = createFixtureManifest();
  return {
    tree: new RepoTree(manifest.files),
    committedAt: manifest.committedAt,
    overlayPaths: new Set(),
  };
}

describe("Explorer's namespace", () => {
  // A build without the optional Desktop folders (Network Neighborhood, the Recycle Bin); the tests that install
  // them say so.
  const folders = shellFolders(
    START_MENU_REGISTRATIONS.filter(
      (entry) =>
        ![
          "network-neighborhood",
          "network",
          "recycle-bin",
          "recyclebin",
        ].includes(entry.id),
    ),
  );

  it("has the four system folders of every build under My Computer", () => {
    expect(
      folders.map((folder) => [folder.id, folder.name, folder.parent]),
    ).toEqual([
      ["printers", "Printers", MY_COMPUTER],
      ["controlpanel", "Control Panel", MY_COMPUTER],
      ["dialup", "Dial-Up Networking", MY_COMPUTER],
      ["tasks", "Scheduled Tasks", MY_COMPUTER],
    ]);
  });

  it("opens Control Panel, and says why the others have nothing to open", () => {
    const { commands, opened, messages } = recordingCommands();
    for (const folder of folders) folder.open(commands, VIEWPORT);
    expect(opened).toEqual([{ kind: "controlpanel", applet: "home" }]);
    expect(messages).toEqual([
      { title: "Printers", message: PRINTERS_MESSAGE },
      { title: "Dial-Up Networking", message: DIAL_UP_MESSAGE },
      { title: "Scheduled Tasks", message: SCHEDULED_TASKS_MESSAGE },
    ]);
  });

  it("adds a Desktop folder for each optional program that is installed", () => {
    const calls: string[] = [];
    const registrations: StartMenuRegistration[] = [
      {
        slot: "programs",
        id: "recyclebin",
        label: "Recycle Bin",
        icon: "recycle",
        open: (_commands, viewport) => calls.push(`bin ${viewport.width}`),
      },
      // Planned but not in the build: a registration without `open` is no folder.
      {
        slot: "programs",
        id: "network-neighborhood",
        label: "Network Neighborhood",
        icon: "network",
      },
    ];
    const installed = shellFolders(registrations).filter(
      (folder) => folder.parent === DESKTOP,
    );
    expect(installed.map((folder) => [folder.id, folder.icon])).toEqual([
      ["recyclebin", "recycle"],
    ]);
    installed[0]?.open(recordingCommands().commands, VIEWPORT);
    expect(calls).toEqual(["bin 800"]);
  });

  it("lists the Desktop, My Computer and real folders", () => {
    const listing = inputs();
    expect(listNamespace(DESKTOP, listing, folders)).toEqual([
      MY_COMPUTER_ENTRY,
    ]);
    expect(
      listNamespace(MY_COMPUTER, listing, folders).map((entry) => [
        entry.location,
        entry.kind,
        entry.typeLabel,
      ]),
    ).toEqual([
      [DRIVE_A, "drive", "3½ Inch Floppy Disk"],
      [DRIVE_C, "drive", "Local Disk"],
      ["shell:printers", "folder", "System Folder"],
      ["shell:controlpanel", "folder", "System Folder"],
      ["shell:dialup", "folder", "System Folder"],
      ["shell:tasks", "folder", "System Folder"],
    ]);
    expect(
      listNamespace("C:/packages", listing, folders).map((entry) => entry.name),
    ).toEqual(["fuseos"]);
    // A system folder is a program: nothing lists inside it.
    expect(listNamespace("shell:printers", listing, folders)).toEqual([]);
  });

  it("finds a system folder by its location and nothing else", () => {
    const printers = folders[0];
    expect(printers && shellFolderLocation(printers)).toBe("shell:printers");
    expect(findShellFolder("shell:printers", folders)).toBe(printers);
    for (const location of [DESKTOP, MY_COMPUTER, DRIVE_C, "C:/docs"])
      expect(findShellFolder(location, folders)).toBeUndefined();
  });

  it("puts My Computer on the Desktop and nothing above the Desktop", () => {
    expect(namespaceParent(DESKTOP)).toBeUndefined();
    expect(namespaceParent(MY_COMPUTER)).toBe(DESKTOP);
    expect(namespaceParent(DRIVE_C)).toBe(MY_COMPUTER);
    expect(namespaceParent("C:/packages/fuseos")).toBe("C:/packages");
    expect(namespaceAncestors("C:/packages/fuseos")).toEqual([
      DESKTOP,
      MY_COMPUTER,
      DRIVE_C,
      "C:/packages",
      "C:/packages/fuseos",
    ]);
    expect(namespaceAncestors(DESKTOP)).toEqual([DESKTOP]);
    expect(isVirtualFolder(DESKTOP)).toBe(true);
    expect(isVirtualFolder(MY_COMPUTER)).toBe(true);
    expect(isVirtualFolder(DRIVE_C)).toBe(false);
  });

  it("names, addresses and titles every kind of place", () => {
    expect(
      [DESKTOP, MY_COMPUTER, DRIVE_A, "C:/docs"].map((location) => [
        namespaceName(location),
        namespaceAddress(location),
        namespaceIcon(location),
        explorerTitle(location),
      ]),
    ).toEqual([
      ["Desktop", "Desktop", "desktop", "Exploring - Desktop"],
      ["My Computer", "My Computer", "computer", "Exploring - My Computer"],
      ["3½ Floppy (A:)", "A:\\", "floppy", "Exploring - A:\\"],
      ["docs", "C:\\docs", "folderOpen", "Exploring - C:\\docs"],
    ]);
    expect(namespaceIcon(DRIVE_C)).toBe("drive");
  });

  it("parses Desktop in any case, and everything else as a disk address", () => {
    expect(parseNamespaceAddress(" Desktop ")).toBe(DESKTOP);
    expect(parseNamespaceAddress("DESKTOP")).toBe(DESKTOP);
    expect(parseNamespaceAddress("my computer")).toBe(MY_COMPUTER);
    expect(parseNamespaceAddress("c:\\docs")).toBe("C:/docs");
    expect(parseNamespaceAddress("Q:\\")).toBeUndefined();
  });

  it("knows which places exist", () => {
    const { tree } = inputs();
    expect(namespaceExists(DESKTOP, undefined)).toBe(true);
    expect(namespaceExists(MY_COMPUTER, undefined)).toBe(true);
    expect(namespaceExists("C:/packages", tree)).toBe(true);
    expect(namespaceExists("C:/nowhere", tree)).toBe(false);
    expect(namespaceExists("shell:printers", tree)).toBe(false);
  });
});
