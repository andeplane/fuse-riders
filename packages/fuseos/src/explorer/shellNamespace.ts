import type { StartMenuRegistration } from "../desktop/startMenuRegistry";
import type { DiskEntry, ListingInputs } from "../disk/diskEntries";
import { listEntries, locationExists } from "../disk/diskEntries";
import {
  driveOf,
  formatAddress,
  MY_COMPUTER,
  nameOf,
  parentOf,
  parseAddress,
} from "../disk/diskPath";
import type { RepoTree } from "../disk/repoTree";
import type { IconName } from "../ui/icons";
import type { WindowCommands } from "../windows/useWindowCommands";
import type { Size } from "../windows/windowManager";

/**
 * Explorer's namespace above the drives, as Windows 98 has it: Desktop at the root, My Computer under
 * it, and the system folders (Printers, Control Panel, ...) that are programs rather than places.
 * `disk/` keeps knowing only drives and files; everything "shell:" lives here.
 */
export const DESKTOP = "shell:desktop";

const SHELL_PREFIX = "shell:";

export const SYSTEM_FOLDER_TYPE = "System Folder";

/** A folder in the tree that opens a program (or says there is none) instead of listing files. */
export type ShellFolder = {
  id: string;
  name: string;
  icon: IconName;
  /** Where it shows: under My Computer or directly on the Desktop. */
  parent: typeof DESKTOP | typeof MY_COMPUTER;
  open: (commands: WindowCommands, viewport: Size) => void;
};

export const PRINTERS_MESSAGE =
  "No printers are installed.\n\nFuseOS has never met a printer that worked on the first try, so it did not bring one.";
export const DIAL_UP_MESSAGE =
  "No dial tone.\n\nFuseOS is already online: rooms connect peer to peer, no modem required.";
export const SCHEDULED_TASKS_MESSAGE =
  "There are no scheduled tasks.\n\nThe only thing FuseOS does on a schedule is the screen saver.";

/** The system folders every build has, in the order Windows 98 lists them under My Computer. */
const BUILT_IN_FOLDERS: readonly ShellFolder[] = [
  {
    id: "printers",
    name: "Printers",
    icon: "printers",
    parent: MY_COMPUTER,
    open: (commands) => commands.showInfo("Printers", PRINTERS_MESSAGE),
  },
  {
    id: "controlpanel",
    name: "Control Panel",
    icon: "controlPanelFolder",
    parent: MY_COMPUTER,
    open: (commands) => commands.open({ kind: "controlpanel", applet: "home" }),
  },
  {
    id: "dialup",
    name: "Dial-Up Networking",
    icon: "dialUp",
    parent: MY_COMPUTER,
    open: (commands) =>
      commands.showInfo("Dial-Up Networking", DIAL_UP_MESSAGE),
  },
  {
    id: "tasks",
    name: "Scheduled Tasks",
    icon: "scheduledTasks",
    parent: MY_COMPUTER,
    open: (commands) =>
      commands.showInfo("Scheduled Tasks", SCHEDULED_TASKS_MESSAGE),
  },
];

/**
 * Desktop folders that exist only when their program is in the build. Each is found by the id of its
 * Start menu registration, so installing the program (appending the registration) is what makes the
 * folder appear here; Explorer never imports the program itself.
 */
const OPTIONAL_FOLDERS: readonly {
  id: string;
  name: string;
  registrationIds: readonly string[];
}[] = [
  {
    id: "network",
    name: "Network Neighborhood",
    registrationIds: ["network-neighborhood", "network"],
  },
  {
    id: "recyclebin",
    name: "Recycle Bin",
    registrationIds: ["recycle-bin", "recyclebin"],
  },
];

/** Every system folder of this build: the built-in ones, then the programs found among the registrations. */
export function shellFolders(
  registrations: readonly StartMenuRegistration[],
): ShellFolder[] {
  const optional = OPTIONAL_FOLDERS.flatMap((folder): ShellFolder[] => {
    const registration = registrations.find((entry) =>
      folder.registrationIds.includes(entry.id),
    );
    const open = registration?.open;
    if (!registration || !open) return [];
    return [
      {
        id: folder.id,
        name: folder.name,
        icon: registration.icon,
        parent: DESKTOP,
        open,
      },
    ];
  });
  return [...BUILT_IN_FOLDERS, ...optional];
}

export function shellFolderLocation(folder: ShellFolder): string {
  return `${SHELL_PREFIX}${folder.id}`;
}

/** The system folder at a location; undefined for the Desktop, My Computer, drives and files. */
export function findShellFolder(
  location: string,
  folders: readonly ShellFolder[],
): ShellFolder | undefined {
  return folders.find((folder) => shellFolderLocation(folder) === location);
}

function shellFolderEntry(folder: ShellFolder): DiskEntry {
  return {
    location: shellFolderLocation(folder),
    name: folder.name,
    kind: "folder",
    icon: folder.icon,
    typeLabel: SYSTEM_FOLDER_TYPE,
    modified: false,
  };
}

export const MY_COMPUTER_ENTRY: DiskEntry = {
  location: MY_COMPUTER,
  name: "My Computer",
  kind: "folder",
  icon: "computer",
  typeLabel: SYSTEM_FOLDER_TYPE,
  modified: false,
};

/** Whether a location lists in Windows' own order (drive letters, then system folders) rather than by name. */
export function isVirtualFolder(location: string): boolean {
  return location === DESKTOP || location === MY_COMPUTER;
}

/** Everything directly inside `location`, the namespace's own folders included. */
export function listNamespace(
  location: string,
  inputs: ListingInputs,
  folders: readonly ShellFolder[],
): DiskEntry[] {
  const under = (parent: string) =>
    folders.filter((folder) => folder.parent === parent).map(shellFolderEntry);
  if (location === DESKTOP) return [MY_COMPUTER_ENTRY, ...under(DESKTOP)];
  if (location === MY_COMPUTER)
    return [...listEntries(location, inputs), ...under(MY_COMPUTER)];
  return listEntries(location, inputs);
}

/** The containing folder; My Computer sits on the Desktop, and nothing is above the Desktop. */
export function namespaceParent(location: string): string | undefined {
  if (location === DESKTOP) return undefined;
  if (location === MY_COMPUTER) return DESKTOP;
  return parentOf(location);
}

/** Every location from the Desktop down to `location`, inclusive. */
export function namespaceAncestors(location: string): string[] {
  const chain: string[] = [];
  let current: string | undefined = location;
  while (current !== undefined) {
    chain.unshift(current);
    current = namespaceParent(current);
  }
  return chain;
}

export function namespaceName(location: string): string {
  return location === DESKTOP ? "Desktop" : nameOf(location);
}

/** What the address bar shows: "Desktop", "My Computer", "C:\packages". */
export function namespaceAddress(location: string): string {
  return location === DESKTOP ? "Desktop" : formatAddress(location);
}

/** Parses what was typed in the address bar; "Desktop" (any case) is the root. */
export function parseNamespaceAddress(text: string): string | undefined {
  return text.trim().toLowerCase() === "desktop" ? DESKTOP : parseAddress(text);
}

export function namespaceExists(
  location: string,
  tree: RepoTree | undefined,
): boolean {
  return location === DESKTOP || locationExists(location, tree);
}

/** The small icon of a place: in the address bar, the tree and the status bar. */
export function namespaceIcon(location: string): IconName {
  if (location === DESKTOP) return "desktop";
  if (location === MY_COMPUTER) return "computer";
  if (parentOf(location) !== MY_COMPUTER) return "folderOpen";
  return driveOf(location) === "A" ? "floppy" : "drive";
}

/** The window title, as Windows Explorer words it: "Exploring - My Computer", "Exploring - C:\docs". */
export function explorerTitle(location: string): string {
  return `Exploring - ${namespaceAddress(location)}`;
}
