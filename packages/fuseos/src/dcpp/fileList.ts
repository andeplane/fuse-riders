import type { Random } from "./rng";
import type { CatalogueFile } from "./search";

export type FileListFolder = {
  name: string;
  /** Backslash path from the root, ending in "\"; "" for the root. */
  path: string;
  folders: FileListFolder[];
  files: CatalogueFile[];
  /** Everything below, files in subfolders included. */
  size: number;
};

/** Folders everyone had in 2003 and nobody downloads from. */
const FILLER: readonly CatalogueFile[] = [
  ["Pictures\\Vacation 2002\\", "IMG_0001.JPG", 812_331],
  ["Pictures\\Vacation 2002\\", "IMG_0002.JPG", 790_102],
  ["Pictures\\Vacation 2002\\", "IMG_0003.JPG", 844_020],
  ["Documents\\", "homework_final_FINAL2.doc", 48_640],
  ["Documents\\", "my_homepage.html", 9_812],
  ["Incomplete\\", "INCOMPLETE~Teh.Matricks.1999.DivX.CD1.avi", 412_000_000],
  ["Software\\", "Winamp 2.91 full.exe", 2_771_520],
  ["Software\\", "ICQ 2003a.exe", 7_960_576],
  ["Software\\", "DCPlusPlus-0.401.exe", 1_521_664],
].map(([path, name, size]) => ({
  name: String(name),
  path: String(path),
  size: Number(size),
  delivery: { kind: "joke" },
}));

function ensure(root: FileListFolder, path: string): FileListFolder {
  let folder = root;
  let walked = "";
  for (const part of path.split("\\").filter(Boolean)) {
    walked += `${part}\\`;
    let next = folder.folders.find((child) => child.name === part);
    if (!next) {
      next = { name: part, path: walked, folders: [], files: [], size: 0 };
      folder.folders.push(next);
    }
    folder = next;
  }
  return folder;
}

function finish(folder: FileListFolder): number {
  folder.folders.sort((a, b) => a.name.localeCompare(b.name));
  folder.files.sort((a, b) => a.name.localeCompare(b.name));
  folder.size =
    folder.files.reduce((sum, file) => sum + file.size, 0) +
    folder.folders.reduce((sum, child) => sum + finish(child), 0);
  return folder.size;
}

/** A folder tree from a flat list of shared files. */
export function buildFileList(files: readonly CatalogueFile[]): FileListFolder {
  const root: FileListFolder = {
    name: "",
    path: "",
    folders: [],
    files: [],
    size: 0,
  };
  for (const file of files) ensure(root, file.path).files.push(file);
  finish(root);
  return root;
}

/** Someone's share as their file list shows it: a seeded pick of the hub's files plus the usual filler. */
export function userFileList(
  random: Random,
  files: readonly CatalogueFile[],
): FileListFolder {
  const picked = files.filter(() => random() < 0.6);
  return buildFileList([...(picked.length > 0 ? picked : files), ...FILLER]);
}

/** The folder at `path` ("" for the root), or undefined. */
export function folderAt(
  root: FileListFolder,
  path: string,
): FileListFolder | undefined {
  let folder: FileListFolder | undefined = root;
  for (const part of path.split("\\").filter(Boolean))
    folder = folder?.folders.find((child) => child.name === part);
  return folder;
}

/** Number of files below a folder. */
export function countFiles(folder: FileListFolder): number {
  return (
    folder.files.length +
    folder.folders.reduce((sum, child) => sum + countFiles(child), 0)
  );
}
