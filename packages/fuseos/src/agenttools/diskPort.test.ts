import { createTestDiskDeps } from "../__mocks__/disk";

import { createDiskPort } from "./diskPort";

describe(createDiskPort.name, () => {
  it("lists My Computer, a drive and a folder as Explorer would", async () => {
    const port = createDiskPort(createTestDiskDeps());
    const computer = await port.stat("");
    expect(
      computer?.kind === "folder" && computer.entries.map((e) => e.location),
    ).toEqual(["A:", "C:"]);
    const root = await port.stat("C:");
    expect(root?.kind === "folder" && root.entries.map((e) => e.name)).toEqual([
      "WINDOWS",
      "docs",
      "packages",
      "public",
      "README.md",
      "package.json",
    ]);
    const docs = await port.stat("C:/docs");
    expect(docs?.kind === "folder" && docs.entries.map((e) => e.name)).toEqual([
      "huge.log",
      "notes.txt",
    ]);
  });

  it("finds a file whatever the case of its name, with its kind and whether it has a saved copy", async () => {
    const port = createDiskPort(
      createTestDiskDeps({ overlay: { "README.md": "mine" } }),
    );
    const readme = await port.stat("C:/readme.MD");
    expect(readme).toMatchObject({
      kind: "file",
      entry: {
        location: "C:/README.md",
        name: "README.md",
        fileKind: "text",
        modified: true,
      },
    });
    expect(await port.stat("C:/public/gallery/fuseball.jpg")).toMatchObject({
      kind: "file",
      entry: { fileKind: "image" },
    });
  });

  it("knows nothing at a path that does not exist, on either drive or above them", async () => {
    const port = createDiskPort(createTestDiskDeps());
    expect(await port.stat("C:/nope.txt")).toBeUndefined();
    expect(await port.stat("C:/docs/nope/deeper.txt")).toBeUndefined();
    expect(await port.stat("A:/nope")).toBeUndefined();
    expect(await port.stat("Z:")).toBeUndefined();
  });

  it("lists the floppy without the manifest, so it works when GitHub cannot be reached", async () => {
    const deps = createTestDiskDeps({
      source: { manifestFailures: 1 },
    });
    const port = createDiskPort(deps);
    const floppy = await port.stat("A:");
    expect(
      floppy?.kind === "folder" && floppy.entries.map((e) => e.name),
    ).toEqual(["porn", "slackbacup.zip"]);
    // A:\\porn is behind its password for Clippy too, until it has been given in Explorer.
    await expect(port.stat("A:/PORN")).rejects.toThrow(
      "The password is incorrect. Access is denied.",
    );
    deps.jokeGate.tryPassword("mender");
    expect(await port.stat("A:/porn/definitely_not_porn.avi")).toMatchObject({
      kind: "file",
      entry: { name: "definitely_not_porn.avi", fileKind: "binary" },
    });
    await expect(port.stat("C:")).rejects.toThrow(
      "The drive manifest could not be read",
    );
  });
});
