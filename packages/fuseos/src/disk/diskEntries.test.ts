import { createFixtureManifest } from "../__mocks__/disk";

import {
  driveEntries,
  editorPathOf,
  listEntries,
  locationExists,
  locationOfEditorPath,
} from "./diskEntries";
import { MY_COMPUTER } from "./diskPath";
import { HOMEWORK_LOCATION } from "./floppy";
import { RepoTree } from "./repoTree";

const manifest = createFixtureManifest();
const inputs = {
  tree: new RepoTree(manifest.files),
  committedAt: manifest.committedAt,
  overlayPaths: new Set(["README.md", HOMEWORK_LOCATION]),
};

describe(listEntries.name, () => {
  it("lists the two drives under My Computer", () => {
    expect(listEntries(MY_COMPUTER, inputs)).toEqual(driveEntries());
    expect(driveEntries().map((entry) => entry.name)).toEqual([
      "3½ Floppy (A:)",
      "Fuse Riders (C:)",
    ]);
  });

  it("lists a C: folder with folders first, the commit date and the overlay marker", () => {
    const root = listEntries("C:", inputs);
    expect(root.map((entry) => [entry.name, entry.kind])).toEqual([
      ["docs", "folder"],
      ["packages", "folder"],
      ["public", "folder"],
      ["README.md", "file"],
      ["package.json", "file"],
    ]);
    const readme = root.find((entry) => entry.name === "README.md");
    expect(readme).toMatchObject({
      location: "C:/README.md",
      modified: true,
      fileKind: "text",
      icon: "codeFile",
      typeLabel: "Markdown Document",
      modifiedAt: manifest.committedAt,
    });
    expect(root.find((entry) => entry.name === "package.json")?.modified).toBe(
      false,
    );
  });

  it("lists nothing on C: until the manifest is there, and nothing for a missing folder", () => {
    expect(listEntries("C:", { ...inputs, tree: undefined })).toEqual([]);
    expect(listEntries("C:/nowhere", inputs)).toEqual([]);
    expect(listEntries("D:", inputs)).toEqual([]);
  });

  it("lists the floppy: the joke folder and the one archive, then homework.txt inside", () => {
    const floppy = listEntries("A:", inputs);
    expect(floppy.map((entry) => entry.name)).toEqual([
      "porn",
      "slackbacup.zip",
    ]);
    expect(floppy[1]).toMatchObject({
      size: 1_415_577,
      icon: "zip",
      fileKind: "binary",
      modifiedAt: "1997-08-14T03:12:00Z",
    });
    const inside = listEntries("A:/porn", inputs);
    expect(inside).toHaveLength(1);
    expect(inside[0]).toMatchObject({
      name: "homework.txt",
      location: HOMEWORK_LOCATION,
      fileKind: "text",
      modified: true,
    });
    expect(listEntries("A:/elsewhere", inputs)).toEqual([]);
  });
});

describe(locationExists.name, () => {
  it("knows My Computer, the drives, real folders and the joke folder", () => {
    expect(locationExists(MY_COMPUTER, inputs.tree)).toBe(true);
    expect(locationExists("A:", inputs.tree)).toBe(true);
    expect(locationExists("A:/porn", inputs.tree)).toBe(true);
    expect(locationExists("A:/other", inputs.tree)).toBe(false);
    expect(locationExists("C:", inputs.tree)).toBe(true);
    expect(locationExists("C:/packages/fuseos", inputs.tree)).toBe(true);
    expect(locationExists("C:/packages/nope", inputs.tree)).toBe(false);
    expect(locationExists("C:/README.md", inputs.tree)).toBe(false);
    expect(locationExists("C:", undefined)).toBe(false);
    expect(locationExists("D:", inputs.tree)).toBe(false);
  });
});

describe("editor paths", () => {
  it("maps C: locations to repository paths and keeps floppy locations", () => {
    expect(editorPathOf("C:/packages/fuseos/src/App.tsx")).toBe(
      "packages/fuseos/src/App.tsx",
    );
    expect(editorPathOf(HOMEWORK_LOCATION)).toBe(HOMEWORK_LOCATION);
    expect(locationOfEditorPath("packages/fuseos/src/App.tsx")).toBe(
      "C:/packages/fuseos/src/App.tsx",
    );
    expect(locationOfEditorPath(HOMEWORK_LOCATION)).toBe(HOMEWORK_LOCATION);
  });
});
