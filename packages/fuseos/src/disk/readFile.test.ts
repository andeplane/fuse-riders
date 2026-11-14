import { createTestDiskDeps } from "../__mocks__/disk";

import { HOMEWORK_LOCATION, HOMEWORK_TEXT } from "./floppy";
import { loadFile } from "./readFile";

describe(loadFile.name, () => {
  it("reads a C: file with its saved copy, if any", async () => {
    const deps = createTestDiskDeps({
      overlay: { "README.md": "# edited" },
    });
    await expect(loadFile(deps, "README.md")).resolves.toEqual({
      original: "# Fuse Riders\n\nLight cycles for five.\n",
      saved: "# edited",
      fromFallback: false,
    });
    await expect(loadFile(deps, "package.json")).resolves.toMatchObject({
      saved: undefined,
      fromFallback: false,
    });
    expect(deps.source.reads).toEqual(["README.md", "package.json"]);
  });

  it("says when the text came from the fallback branch", async () => {
    const deps = createTestDiskDeps({
      source: { missingAtCommit: ["README.md"] },
    });
    await expect(loadFile(deps, "README.md")).resolves.toMatchObject({
      fromFallback: true,
    });
  });

  it("reads homework.txt from the floppy without touching GitHub", async () => {
    const deps = createTestDiskDeps();
    await expect(loadFile(deps, HOMEWORK_LOCATION)).resolves.toEqual({
      original: HOMEWORK_TEXT,
      saved: undefined,
      fromFallback: false,
    });
    expect(deps.source.reads).toEqual([]);
  });

  it("refuses other floppy paths, drive-prefixed C: paths and files GitHub lacks", async () => {
    const deps = createTestDiskDeps();
    await expect(loadFile(deps, "A:/slackbacup.zip")).rejects.toThrow(
      "no A:/slackbacup.zip on the floppy",
    );
    await expect(loadFile(deps, "C:/README.md")).rejects.toThrow(
      "not a path on the C: drive",
    );
    await expect(loadFile(deps, "nope.txt")).rejects.toThrow("HTTP 404");
  });
});
