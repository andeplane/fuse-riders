import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, createServer } from "vite";
import type { GitReader } from "../scripts/fuseos/repo-tree-plugin.ts";
import {
  buildRepoManifest,
  DEFAULT_REPO,
  parseLsTree,
  REPO_TREE_PATH,
  repoSlugFromRemote,
  repoTree,
} from "../scripts/fuseos/repo-tree-plugin.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const LS_TREE = [
  "100644 blob a0ac247170497abbc58c5263c4d62430089a5643    5397\t.c8rc.json",
  "100755 blob a5490a898718acd43201b6b3c4d5ab05d4bac6a5     462\tscripts/x.sh",
  "160000 commit 1111111111111111111111111111111111111111       -\tvendor/sub",
  "100644 blob b5490a898718acd43201b6b3c4d5ab05d4bac6a5       0\tpackages/fuseos/src/App.tsx",
].join("\0");

/** Canned git: answers what the plugin asks and records it. */
function fakeGit(overrides: Partial<Record<string, string>> = {}): GitReader & {
  calls: string[];
} {
  const answers: Record<string, string> = {
    "remote get-url origin": "git@github.com:someone/fork.git\n",
    "rev-parse HEAD": `${SHA}\n`,
    "log -1 --format=%cI HEAD": "2026-11-14T14:39:08+01:00\n",
    "ls-tree -r -l -z HEAD": LS_TREE,
    ...overrides,
  };
  const calls: string[] = [];
  return {
    calls,
    run(args) {
      const key = args.join(" ");
      calls.push(key);
      const answer = answers[key];
      if (answer === undefined) throw new Error(`fake git has no ${key}`);
      return answer;
    },
  };
}

test("parseLsTree keeps blobs with their sizes, sorted, and skips submodules", () => {
  assert.deepEqual(parseLsTree(LS_TREE), [
    { path: ".c8rc.json", size: 5397 },
    { path: "packages/fuseos/src/App.tsx", size: 0 },
    { path: "scripts/x.sh", size: 462 },
  ]);
  assert.deepEqual(parseLsTree(""), []);
  assert.throws(() => parseLsTree("garbage"), /Unexpected git ls-tree record/);
});

test("repoSlugFromRemote reads https and ssh remotes, with or without .git", () => {
  assert.equal(
    repoSlugFromRemote("https://github.com/andeplane/fuse-riders"),
    "andeplane/fuse-riders",
  );
  assert.equal(
    repoSlugFromRemote("https://github.com/andeplane/fuse-riders.git\n"),
    "andeplane/fuse-riders",
  );
  assert.equal(
    repoSlugFromRemote("git@github.com:andeplane/fuse-riders.git"),
    "andeplane/fuse-riders",
  );
  assert.equal(repoSlugFromRemote("https://gitlab.com/a/b"), undefined);
  assert.equal(repoSlugFromRemote(""), undefined);
});

test("buildRepoManifest names the repo from CI, else the remote, else the default", () => {
  const git = fakeGit();
  const fromEnv = buildRepoManifest(git, {
    env: { GITHUB_REPOSITORY: "andeplane/fuse-riders" },
  });
  assert.equal(fromEnv.repo, "andeplane/fuse-riders");
  assert.equal(fromEnv.sha, SHA);
  assert.equal(fromEnv.committedAt, "2026-11-14T14:39:08+01:00");
  assert.equal(fromEnv.fallbackRef, "main");
  assert.equal(fromEnv.version, 1);
  assert.equal(fromEnv.files.length, 3);
  assert.equal(buildRepoManifest(git, { env: {} }).repo, "someone/fork");

  const noRemote = fakeGit();
  noRemote.run = (args) => {
    if (args[0] === "remote") throw new Error("fatal: No such remote");
    return git.run(args);
  };
  assert.equal(buildRepoManifest(noRemote, { env: {} }).repo, DEFAULT_REPO);
  assert.throws(
    () =>
      buildRepoManifest(fakeGit({ "rev-parse HEAD": "HEAD\n" }), { env: {} }),
    /not a commit/,
  );
});

/** A throwaway Vite root with one page, enough for the plugin to run in a dev server and a build. */
function tempRoot(): string {
  // realpath: macOS's tmpdir is a symlink, and Vite names emitted files relative to the real root.
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "fuseos-repo-tree-")),
  );
  writeFileSync(
    path.join(root, "index.html"),
    "<!doctype html><title>t</title><p>hi</p>",
  );
  return root;
}

test("the dev server answers the manifest under the base and leaves other paths alone", async () => {
  const root = tempRoot();
  const git = fakeGit();
  const vite = await createServer({
    root,
    base: "/fuse-riders/",
    logLevel: "silent",
    configFile: false,
    server: { middlewareMode: true },
    plugins: [repoTree({ git, env: {} })],
  });
  const http = createHttpServer(vite.middlewares);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/fuse-riders/${REPO_TREE_PATH}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const manifest: unknown = await response.json();
    assert.ok(typeof manifest === "object" && manifest !== null);
    assert.equal((manifest as { sha: string }).sha, SHA);
    assert.equal((manifest as { repo: string }).repo, "someone/fork");
    // Not under the base: not ours.
    const other = await fetch(`${origin}/${REPO_TREE_PATH}`);
    assert.notEqual(other.headers.get("content-type"), "application/json");
    // Rebuilt per request, so a new commit shows up without a restart.
    await fetch(`${origin}/fuse-riders/${REPO_TREE_PATH}`);
    assert.equal(
      git.calls.filter((call) => call === "rev-parse HEAD").length,
      2,
    );
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await vite.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the build emits the manifest beside the site", async () => {
  const root = tempRoot();
  const outDir = path.join(root, "dist");
  try {
    await build({
      root,
      logLevel: "silent",
      configFile: false,
      build: { outDir },
      plugins: [
        repoTree({ git: fakeGit(), env: { GITHUB_REPOSITORY: "a/b" } }),
      ],
    });
    const written: unknown = JSON.parse(
      readFileSync(path.join(outDir, REPO_TREE_PATH), "utf8"),
    );
    assert.deepEqual(written, {
      version: 1,
      repo: "a/b",
      sha: SHA,
      committedAt: "2026-11-14T14:39:08+01:00",
      fallbackRef: "main",
      files: parseLsTree(LS_TREE),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository's plugin registration produces a manifest of this checkout", () => {
  const config = readFileSync("vite.config.ts", "utf8");
  assert.match(config, /repoTree\(\)/);
  assert.match(config, /scripts\/fuseos\/repo-tree-plugin\.ts/);
});

/** Static imports reachable from a module, by specifier; dynamic `import()` is not followed. */
function staticImports(file: string, seen = new Set<string>()): Set<string> {
  const specifiers = new Set<string>();
  const walk = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(
      /^(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm,
    )) {
      const specifier = match[1] ?? match[2];
      if (!specifier || /^import\s+type\b/.test(match[0])) continue;
      specifiers.add(specifier);
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(current), specifier);
      const resolved = [
        `${target}.ts`,
        `${target}.tsx`,
        target,
        `${target}/index.ts`,
      ].find((candidate) => {
        try {
          return readFileSync(candidate).length >= 0;
        } catch {
          return false;
        }
      });
      if (resolved && /\.(ts|tsx)$/.test(resolved)) walk(resolved);
    }
  };
  walk(file);
  return specifiers;
}

test("CodeMirror is not statically reachable from the desktop's entry", () => {
  const reachable = staticImports("packages/fuseos/src/main.tsx");
  const editor = [...reachable].filter(
    (specifier) =>
      specifier.startsWith("@codemirror/") || specifier.startsWith("@lezer/"),
  );
  assert.deepEqual(editor, []);
  // The walk really does reach the editor's host module.
  assert.ok(
    [...reachable].some((specifier) => specifier.endsWith("/editorDeps")),
    "editorDeps.ts is in the static graph",
  );
});
