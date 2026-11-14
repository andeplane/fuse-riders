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
  HOMEWORK_LOCATION,
  HOMEWORK_NAME,
  HOMEWORK_TEXT,
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

export type ListingInputs = {
  /** Undefined while the manifest is still loading; C: then lists nothing. */
  tree: RepoTree | undefined;
  committedAt: string;
  /** Paths (as Notepad++ addresses them) with a saved copy in the overlay. */
  overlayPaths: ReadonlySet<string>;
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

export function floppyEntries(
  location: string,
  overlayPaths: ReadonlySet<string> = new Set(),
): DiskEntry[] {
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
        location: HOMEWORK_LOCATION,
        name: HOMEWORK_NAME,
        kind: "file",
        icon: "textFile",
        typeLabel: "Text Document",
        size: HOMEWORK_TEXT.length,
        modifiedAt: FLOPPY_JOKE_FOLDER_MODIFIED,
        modified: overlayPaths.has(HOMEWORK_LOCATION),
        fileKind: "text",
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
      return floppyEntries(location, inputs.overlayPaths);
    case "C":
      return repoEntries(location, inputs);
    default:
      return [];
  }
}

/** Whether a location names something Explorer can show: My Computer, a drive, or a folder that exists. */
export function locationExists(
  location: string,
  tree: RepoTree | undefined,
): boolean {
  if (location === MY_COMPUTER) return true;
  switch (driveOf(location)) {
    case "A":
      return location === DRIVE_A || location === FLOPPY_JOKE_LOCATION;
    case "C":
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
