import type { DiskEntry } from "../disk/diskEntries";
import { MAX_TEXT_FILE_BYTES } from "../disk/fileTypes";
import { FLOPPY_JOKE_LOCATION, FLOPPY_ZIP_LOCATION } from "../disk/floppy";

import {
  CANNOT_OPEN_TITLE,
  cannotOpenMessage,
  decideOpen,
  TOO_LARGE_TITLE,
  tooLargeMessage,
} from "./openEntry";

const file = (
  location: string,
  fileKind: DiskEntry["fileKind"],
  size: number,
): DiskEntry => ({
  location,
  name: location.slice(location.lastIndexOf("/") + 1),
  kind: "file",
  icon: "file",
  typeLabel: "File",
  size,
  modified: false,
  fileKind,
});

describe(decideOpen.name, () => {
  it("navigates into folders and drives", () => {
    expect(
      decideOpen({
        location: "C:",
        name: "Fuse Riders (C:)",
        kind: "drive",
        icon: "drive",
        typeLabel: "Local Disk",
        modified: false,
      }),
    ).toEqual({ type: "navigate", location: "C:" });
    expect(
      decideOpen({
        location: "C:/docs",
        name: "docs",
        kind: "folder",
        icon: "folder",
        typeLabel: "File Folder",
        modified: false,
      }),
    ).toEqual({ type: "navigate", location: "C:/docs" });
  });

  it("hands the joke folder to the gate and the archive to WinZip", () => {
    expect(
      decideOpen({
        location: FLOPPY_JOKE_LOCATION,
        name: "porn",
        kind: "folder",
        icon: "folder",
        typeLabel: "File Folder",
        modified: false,
      }),
    ).toEqual({ type: "jokeFolder", location: FLOPPY_JOKE_LOCATION });
    expect(decideOpen(file(FLOPPY_ZIP_LOCATION, "binary", 1))).toEqual({
      type: "winzip",
    });
  });

  it("opens text in Notepad++ by its editor path, up to the size cap", () => {
    expect(
      decideOpen(file("C:/packages/fuseos/src/App.tsx", "text", 900)),
    ).toEqual({ type: "notepad", path: "packages/fuseos/src/App.tsx" });
    expect(
      decideOpen(file("C:/docs/x.md", "text", MAX_TEXT_FILE_BYTES)),
    ).toEqual({ type: "notepad", path: "docs/x.md" });
    expect(decideOpen(file("A:/porn/homework.txt", "text", 10))).toEqual({
      type: "notepad",
      path: "A:/porn/homework.txt",
    });
  });

  it("refuses text past the cap with a dialog that names the sizes", () => {
    const decision = decideOpen(
      file("C:/docs/huge.log", "text", MAX_TEXT_FILE_BYTES + 1),
    );
    expect(decision).toEqual({
      type: "error",
      title: TOO_LARGE_TITLE,
      message: tooLargeMessage("huge.log", MAX_TEXT_FILE_BYTES + 1),
    });
    expect(tooLargeMessage("huge.log", 900 * 1024)).toContain("900 KB");
    expect(tooLargeMessage("huge.log", 900 * 1024)).toContain("512 KB");
  });

  it("opens images in the viewer and refuses other binaries", () => {
    expect(decideOpen(file("C:/public/logo.png", "image", 10))).toEqual({
      type: "image",
      path: "public/logo.png",
    });
    expect(decideOpen(file("C:/public/theme.mp3", "binary", 10))).toEqual({
      type: "error",
      title: CANNOT_OPEN_TITLE,
      message: cannotOpenMessage("theme.mp3"),
    });
    expect(cannotOpenMessage("theme.mp3")).toContain("theme.mp3");
  });
});
