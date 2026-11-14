import { createFixtureManifest, FIXTURE_SHA } from "../__mocks__/disk";

import { DiskError, GitHubDiskSource, MemoryDiskSource } from "./diskSource";

type Route = { status: number; body: string };

/** A fetch that answers from a table of URLs and records what was asked. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const route = routes[url];
    return Promise.resolve(
      route
        ? new Response(route.body, {
            status: route.status,
            headers: { "Content-Type": "text/plain" },
          })
        : new Response("not found", { status: 404 }),
    );
  };
  return { fetch, calls };
}

const MANIFEST_URL = "/fuse-riders/fuseos/repo-tree.json";
const manifest = createFixtureManifest();
const raw = (ref: string, path: string) =>
  `https://raw.githubusercontent.com/andeplane/fuse-riders/${ref}/${path}`;

describe(GitHubDiskSource.name, () => {
  it("fetches the manifest once and shares it", async () => {
    const { fetch, calls } = fakeFetch({
      [MANIFEST_URL]: { status: 200, body: JSON.stringify(manifest) },
    });
    const source = new GitHubDiskSource({ fetch, manifestUrl: MANIFEST_URL });
    const [first, second] = await Promise.all([
      source.manifest(),
      source.manifest(),
    ]);
    expect(first).toEqual(manifest);
    expect(second).toBe(first);
    expect(calls).toEqual([MANIFEST_URL]);
  });

  it("reports a manifest that is missing or not JSON, and retries on the next call", async () => {
    const routes: Record<string, Route> = {
      [MANIFEST_URL]: { status: 503, body: "" },
    };
    const { fetch, calls } = fakeFetch(routes);
    const source = new GitHubDiskSource({ fetch, manifestUrl: MANIFEST_URL });
    await expect(source.manifest()).rejects.toThrow("HTTP 503");
    routes[MANIFEST_URL] = { status: 200, body: "<!doctype html>" };
    await expect(source.manifest()).rejects.toThrow();
    routes[MANIFEST_URL] = { status: 200, body: JSON.stringify(manifest) };
    await expect(source.manifest()).resolves.toEqual(manifest);
    expect(calls).toHaveLength(3);
  });

  it("reads a file at the build's commit", async () => {
    const { fetch, calls } = fakeFetch({
      [MANIFEST_URL]: { status: 200, body: JSON.stringify(manifest) },
      [raw(FIXTURE_SHA, "README.md")]: { status: 200, body: "# hi" },
    });
    const source = new GitHubDiskSource({ fetch, manifestUrl: MANIFEST_URL });
    await expect(source.readText("README.md")).resolves.toEqual({
      text: "# hi",
      fromFallback: false,
    });
    expect(calls).toEqual([MANIFEST_URL, raw(FIXTURE_SHA, "README.md")]);
  });

  it("falls back to main when the commit is not on GitHub, and remembers that", async () => {
    const { fetch, calls } = fakeFetch({
      [MANIFEST_URL]: { status: 200, body: JSON.stringify(manifest) },
      [raw("main", "README.md")]: { status: 200, body: "# main" },
      [raw("main", "package.json")]: { status: 200, body: "{}" },
    });
    const source = new GitHubDiskSource({ fetch, manifestUrl: MANIFEST_URL });
    await expect(source.readText("README.md")).resolves.toEqual({
      text: "# main",
      fromFallback: true,
    });
    await expect(source.readText("package.json")).resolves.toEqual({
      text: "{}",
      fromFallback: true,
    });
    expect(calls).toEqual([
      MANIFEST_URL,
      raw(FIXTURE_SHA, "README.md"),
      raw("main", "README.md"),
      raw("main", "package.json"),
    ]);
  });

  it("surfaces other GitHub errors and a file missing everywhere", async () => {
    const { fetch } = fakeFetch({
      [MANIFEST_URL]: { status: 200, body: JSON.stringify(manifest) },
      [raw(FIXTURE_SHA, "README.md")]: { status: 500, body: "" },
    });
    const source = new GitHubDiskSource({ fetch, manifestUrl: MANIFEST_URL });
    const error = await source.readText("README.md").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiskError);
    expect((error as DiskError).status).toBe(500);
    await expect(source.readText("gone.txt")).rejects.toThrow("HTTP 404");
  });

  it("builds raw URLs with encoded segments, at the commit or the fallback branch", () => {
    const source = new GitHubDiskSource({
      fetch: fakeFetch({}).fetch,
      manifestUrl: MANIFEST_URL,
    });
    expect(source.fileUrl(manifest, "docs/a b/c#.md")).toBe(
      raw(FIXTURE_SHA, "docs/a%20b/c%23.md"),
    );
    expect(source.fileUrl(manifest, "README.md", true)).toBe(
      raw("main", "README.md"),
    );
    expect(
      new GitHubDiskSource({
        fetch: fakeFetch({}).fetch,
        manifestUrl: MANIFEST_URL,
        rawBase: "https://mirror.test",
      }).fileUrl(manifest, "x"),
    ).toBe(`https://mirror.test/andeplane/fuse-riders/${FIXTURE_SHA}/x`);
  });
});

describe(MemoryDiskSource.name, () => {
  it("serves the fixture, records reads, and fakes the fallback and failures", async () => {
    const source = new MemoryDiskSource(
      manifest,
      { "a.txt": "A", "b.txt": "B", "c.txt": "C" },
      { missingAtCommit: ["b.txt"], failing: ["c.txt"], manifestFailures: 1 },
    );
    await expect(source.manifest()).rejects.toThrow("HTTP 503");
    await expect(source.manifest()).resolves.toBe(manifest);
    await expect(source.readText("a.txt")).resolves.toEqual({
      text: "A",
      fromFallback: false,
    });
    await expect(source.readText("b.txt")).resolves.toEqual({
      text: "B",
      fromFallback: true,
    });
    await expect(source.readText("c.txt")).rejects.toThrow("HTTP 404");
    await expect(source.readText("nope")).rejects.toThrow("HTTP 404");
    expect(source.reads).toEqual(["a.txt", "b.txt", "c.txt", "nope"]);
    expect(source.fileUrl(manifest, "x.png")).toBe(
      `memory://andeplane/fuse-riders/${FIXTURE_SHA}/x.png`,
    );
    expect(source.fileUrl(manifest, "x.png", true)).toBe(
      "memory://andeplane/fuse-riders/main/x.png",
    );
  });
});
