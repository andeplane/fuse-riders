import type { IconName } from "../ui/icons";

import {
  DRIVE_A,
  DRIVE_C,
  DRIVE_LABELS,
  driveOf,
  joinLocation,
  MY_COMPUTER,
  pathWithin,
} from "./diskPath";
import { fileIcon, fileKind, fileTypeLabel } from "./fileTypes";
import type { FileKind } from "./fileTypes";
import {
  FLOPPY_JOKE_FOLDER,
  FLOPPY_JOKE_FOLDER_MODIFIED,
  FLOPPY_JOKE_LOCATION,
  FLOPPY_ZIP_MODIFIED,
  FLOPPY_ZIP_NAME,
  FLOPPY_ZIP_SIZE,
  RICKROLL_LOCATION,
  RICKROLL_NAME,
  RICKROLL_SIZE,
} from "./floppy";
import type { RepoTree } from "./repoTree";

export type DiskEntryKind = "drive" | "folder" | "file";

/** One row of an Explorer listing. */
export type DiskEntry = {
  location: string;
  name: string;
  kind: DiskEntryKind;
  icon: IconName;
  typeLabel: string;
  /** Bytes; absent for drives and folders. */
  size?: number;
  /** ISO 8601; absent for drives. */
  modifiedAt?: string;
  /** The file has a saved copy in the browser's overlay. */
  modified: boolean;
  /** How the file opens; absent for drives and folders. */
  fileKind?: FileKind;
};

/**
 * C:\WINDOWS and C:\WINDOWS\SYSTEM32: not in the repository, listed on C: so the drive looks like a Windows
 * one. SYSTEM32 is the folder the delete-SYSTEM32 gag removes (`src/system32`); nothing in either is a real file.
 */
export const WINDOWS_LOCATION = `${DRIVE_C}/WINDOWS`;
export const SYSTEM32_LOCATION = `${WINDOWS_LOCATION}/SYSTEM32`;
/** The date Windows 98's own files carry. */
export const WINDOWS_MODIFIED = "1998-05-11T20:01:00Z";

/** What SYSTEM32 "holds": name and size in bytes. None of them opens. */
export const SYSTEM32_FILES: readonly (readonly [string, number])[] = [
  ["CLIPPY.ACS", 1_873_408],
  ["FUSE.VXD", 524_288],
  ["GDI32.DLL", 155_648],
  ["KERNEL32.DLL", 471_040],
  ["USER32.DLL", 55_296],
  ["WINSOCK.DLL", 21_504],
];

function windowsFolder(location: string): DiskEntry {
  return {
    location,
    name: location.slice(location.lastIndexOf("/") + 1),
    kind: "folder",
    icon: "folder",
    typeLabel: "File Folder",
    modifiedAt: WINDOWS_MODIFIED,
    modified: false,
  };
}

/** The listing of the fake WINDOWS tree at `location`; undefined when `location` is not in it. */
function windowsEntries(
  location: string,
  system32Present: boolean,
): DiskEntry[] | undefined {
  if (location === WINDOWS_LOCATION)
    return system32Present ? [windowsFolder(SYSTEM32_LOCATION)] : [];
  if (location === SYSTEM32_LOCATION)
    return system32Present
      ? SYSTEM32_FILES.map(([name, size]) => ({
          location: `${SYSTEM32_LOCATION}/${name}`,
          name,
          kind: "file",
          icon: "unknownFile",
          typeLabel: "System file",
          size,
          modifiedAt: WINDOWS_MODIFIED,
          modified: false,
          fileKind: "binary",
        }))
      : [];
  return undefined;
}

export type ListingInputs = {
  /** Undefined while the manifest is still loading; C: then lists nothing. */
  tree: RepoTree | undefined;
  committedAt: string;
  /** Paths (as Notepad++ addresses them) with a saved copy in the overlay. */
  overlayPaths: ReadonlySet<string>;
  /** Whether C:\WINDOWS still has its SYSTEM32 folder (the gag removes it for a while); default true. */
  system32Present?: boolean;
};

/** The two drives under My Computer. */
export function driveEntries(): DiskEntry[] {
  return [
    {
      location: DRIVE_A,
      name: DRIVE_LABELS.A,
      kind: "drive",
      icon: "floppy",
      typeLabel: "3½ Inch Floppy Disk",
      modified: false,
    },
    {
      location: DRIVE_C,
      name: DRIVE_LABELS.C,
      kind: "drive",
      icon: "drive",
      typeLabel: "Local Disk",
      modified: false,
    },
  ];
}

/** A: lists the folder and the archive; behind the password the folder holds only the "video". */
export function floppyEntries(location: string): DiskEntry[] {
  if (location === DRIVE_A)
    return [
      {
        location: FLOPPY_JOKE_LOCATION,
        name: FLOPPY_JOKE_FOLDER,
        kind: "folder",
        icon: "folder",
        typeLabel: "File Folder",
        modifiedAt: FLOPPY_JOKE_FOLDER_MODIFIED,
        modified: false,
      },
      {
        location: `A:/${FLOPPY_ZIP_NAME}`,
        name: FLOPPY_ZIP_NAME,
        kind: "file",
        icon: "zip",
        typeLabel: "WinZip File",
        size: FLOPPY_ZIP_SIZE,
        modifiedAt: FLOPPY_ZIP_MODIFIED,
        modified: false,
        fileKind: "binary",
      },
    ];
  if (location === FLOPPY_JOKE_LOCATION)
    return [
      {
        location: RICKROLL_LOCATION,
        name: RICKROLL_NAME,
        kind: "file",
        icon: "video",
        typeLabel: "Video Clip",
        size: RICKROLL_SIZE,
        modifiedAt: FLOPPY_JOKE_FOLDER_MODIFIED,
        modified: false,
        fileKind: "binary",
      },
    ];
  return [];
}

function repoEntries(location: string, inputs: ListingInputs): DiskEntry[] {
  const folder = inputs.tree?.folder(pathWithin(location));
  if (!folder) return [];
  const folders: DiskEntry[] = folder.folders.map((path) => ({
    location: `${DRIVE_C}/${path}`,
    name: path.slice(path.lastIndexOf("/") + 1),
    kind: "folder",
    icon: "folder",
    typeLabel: "File Folder",
    modifiedAt: inputs.committedAt,
    modified: false,
  }));
  const files: DiskEntry[] = folder.files.map((file) => ({
    location: `${DRIVE_C}/${file.path}`,
    name: file.path.slice(file.path.lastIndexOf("/") + 1),
    kind: "file",
    icon: fileIcon(file.path),
    typeLabel: fileTypeLabel(file.path),
    size: file.size,
    modifiedAt: inputs.committedAt,
    modified: inputs.overlayPaths.has(file.path),
    fileKind: fileKind(file.path),
  }));
  return [...folders, ...files];
}

/** Everything directly inside `location`. Folders first, as Explorer lists them. */
export function listEntries(
  location: string,
  inputs: ListingInputs,
): DiskEntry[] {
  if (location === MY_COMPUTER) return driveEntries();
  switch (driveOf(location)) {
    case "A":
      return floppyEntries(location);
    case "C": {
      const windows = windowsEntries(location, inputs.system32Present ?? true);
      if (windows) return windows;
      const entries = repoEntries(location, inputs);
      // WINDOWS sits in the drive's root once the drive has been read.
      return location === DRIVE_C && inputs.tree
        ? [windowsFolder(WINDOWS_LOCATION), ...entries]
        : entries;
    }
    default:
      return [];
  }
}

/** Whether a location names something Explorer can show: My Computer, a drive, or a folder that exists. */
export function locationExists(
  location: string,
  tree: RepoTree | undefined,
  system32Present = true,
): boolean {
  if (location === MY_COMPUTER) return true;
  switch (driveOf(location)) {
    case "A":
      return location === DRIVE_A || location === FLOPPY_JOKE_LOCATION;
    case "C":
      if (location === WINDOWS_LOCATION) return true;
      if (location === SYSTEM32_LOCATION) return system32Present;
      return (
        tree !== undefined && tree.folder(pathWithin(location)) !== undefined
      );
    default:
      return false;
  }
}

/** The path Notepad++ and the overlay use for a file at `location`: the repository path on C:, the location itself on A:. */
export function editorPathOf(location: string): string {
  return driveOf(location) === "C" ? pathWithin(location) : location;
}

/** The inverse: where Explorer would show an editor path. */
export function locationOfEditorPath(path: string): string {
  return driveOf(path) ? path : joinLocation(DRIVE_C, path);
}
