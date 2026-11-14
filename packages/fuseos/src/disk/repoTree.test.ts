import { createFixtureManifest, FIXTURE_SHA } from "../__mocks__/disk";

import { parseRepoManifest, RepoTree } from "./repoTree";

describe(parseRepoManifest.name, () => {
  it("accepts what the build writes", () => {
    const manifest = createFixtureManifest();
    expect(parseRepoManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(
      manifest,
    );
  });

  it.each([
    ["not an object", "nope"],
    ["an old version", { ...createFixtureManifest(), version: 2 }],
    ["a short sha", { ...createFixtureManifest(), sha: "abc" }],
    ["a repo with a path", { ...createFixtureManifest(), repo: "a/b/c" }],
    ["an empty fallback ref", { ...createFixtureManifest(), fallbackRef: "" }],
    [
      "an absolute file path",
      { ...createFixtureManifest(), files: [{ path: "/etc/passwd", size: 1 }] },
    ],
    [
      "a parent escape",
      { ...createFixtureManifest(), files: [{ path: "../x", size: 1 }] },
    ],
    [
      "a negative size",
      { ...createFixtureManifest(), files: [{ path: "x", size: -1 }] },
    ],
    ["an HTML page", { version: 1 }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseRepoManifest(value)).toThrow(/manifest/);
  });

  it("drops fields it does not know", () => {
    const parsed = parseRepoManifest({
      ...createFixtureManifest(),
      extra: true,
    });
    expect("extra" in parsed).toBe(false);
    expect(parsed.sha).toBe(FIXTURE_SHA);
  });
});

describe(RepoTree.name, () => {
  const tree = new RepoTree(createFixtureManifest().files);

  it("lists the root's folders and files, sorted", () => {
    const root = tree.folder("");
    expect(root?.folders).toEqual(["docs", "packages", "public"]);
    expect(root?.files.map((file) => file.path)).toEqual([
      "README.md",
      "package.json",
    ]);
  });

  it("builds every intermediate folder from the flat list", () => {
    expect(tree.folder("packages")?.folders).toEqual(["packages/fuseos"]);
    expect(tree.folder("packages/fuseos")?.folders).toEqual([
      "packages/fuseos/src",
    ]);
    expect(
      tree.folder("packages/fuseos/src")?.files.map((file) => file.path),
    ).toEqual(["packages/fuseos/src/App.tsx", "packages/fuseos/src/main.tsx"]);
    expect(tree.folder("public/gallery")?.files).toHaveLength(1);
  });

  it("finds files by path and reports the count", () => {
    expect(tree.file("README.md")?.size).toBe(
      "# Fuse Riders\n\nLight cycles for five.\n".length,
    );
    expect(tree.file("missing.txt")).toBeUndefined();
    expect(tree.folder("nowhere")).toBeUndefined();
    expect(tree.fileCount).toBe(9);
  });

  it("is empty but valid for a repository with no files", () => {
    const empty = new RepoTree([]);
    expect(empty.folder("")).toEqual({ path: "", folders: [], files: [] });
    expect(empty.fileCount).toBe(0);
  });
});
