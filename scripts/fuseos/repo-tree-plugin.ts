/**
 * FuseOS's C: drive is this repository. Rather than ask the GitHub API at runtime (rate limits,
 * latency, a token), the build writes a manifest of every committed file with its size and the
 * commit it came from; the desktop fetches it once, when My Computer first opens, and reads file
 * contents from raw.githubusercontent.com at that commit (immutable, CORS-enabled, no API quota).
 *
 * The plugin emits the manifest into the bundle and serves the same JSON from the dev server, so
 * `vite dev` and a deployed build look alike. Sizes come from `git ls-tree -l HEAD`, so they are the
 * committed bytes, exactly what raw.githubusercontent.com serves for that commit; an uncommitted
 * edit is invisible to the desktop by design (see docs/fuseos/disk.md).
 */
import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

/** Where the manifest lives, relative to the site base. */
export const REPO_TREE_PATH = "fuseos/repo-tree.json";

/** The repository the manifest describes when no remote or CI variable says otherwise. */
export const DEFAULT_REPO = "andeplane/fuse-games";

/** Raw contents of a file at a commit the build may not have pushed fall back to this branch. */
export const FALLBACK_REF = "main";

export type RepoManifestFile = { path: string; size: number };

export interface RepoManifest {
  version: 1;
  /** "owner/name" on GitHub. */
  repo: string;
  /** The commit the deployed build was made from; file contents are read at this commit. */
  sha: string;
  /** ISO 8601 committer date of `sha`; every file on the drive shows it as its modified time. */
  committedAt: string;
  /** Branch to read a file from when `sha` is not on GitHub (a local, unpushed build). */
  fallbackRef: string;
  files: RepoManifestFile[];
}

/** What the manifest builder needs from git, so a test can hand it canned output. */
export interface GitReader {
  /** Runs `git <args>` in the repository and returns stdout. */
  run(args: readonly string[]): string;
}

export function execGit(cwd: string): GitReader {
  return {
    run: (args) =>
      execFileSync("git", [...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
  };
}

const LS_TREE_LINE = /^(\d+) (\w+) ([0-9a-f]+) +(\d+|-)\t([^]*)$/;

/**
 * Parses `git ls-tree -r -l -z HEAD`: NUL-separated `mode type sha size<TAB>path` records. Only
 * blobs with a size count (a submodule commit reports "-" and is not a file on the drive).
 */
export function parseLsTree(output: string): RepoManifestFile[] {
  const files: RepoManifestFile[] = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const match = LS_TREE_LINE.exec(record);
    if (!match) throw new Error(`Unexpected git ls-tree record: ${record}`);
    const [, , type, , size, path] = match;
    if (type !== "blob" || size === "-" || !path) continue;
    files.push({ path, size: Number(size) });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** "owner/name" from a GitHub remote URL (https or ssh, with or without `.git`); undefined for anything else. */
export function repoSlugFromRemote(url: string): string | undefined {
  const match =
    /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?\s*$/.exec(
      url,
    );
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export type ManifestOptions = {
  /** `GITHUB_REPOSITORY` in Actions; otherwise the origin remote decides. */
  env?: Readonly<Record<string, string | undefined>>;
};

export function buildRepoManifest(
  git: GitReader,
  options: ManifestOptions = {},
): RepoManifest {
  const env = options.env ?? {};
  let remote: string | undefined;
  try {
    remote = repoSlugFromRemote(git.run(["remote", "get-url", "origin"]));
  } catch {
    // No origin remote (a bare export): the default slug still names the public repository.
    remote = undefined;
  }
  const repo = env.GITHUB_REPOSITORY ?? remote ?? DEFAULT_REPO;
  const sha = git.run(["rev-parse", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error(`git rev-parse HEAD returned "${sha}", not a commit`);
  const committedAt = git.run(["log", "-1", "--format=%cI", "HEAD"]).trim();
  return {
    version: 1,
    repo,
    sha,
    committedAt,
    fallbackRef: FALLBACK_REF,
    files: parseLsTree(git.run(["ls-tree", "-r", "-l", "-z", "HEAD"])),
  };
}

export type RepoTreePluginOptions = {
  /** Repository root the git commands run in; defaults to the Vite root. */
  root?: string;
  /** Injected git for tests; defaults to running the real binary in `root`. */
  git?: GitReader;
  env?: Readonly<Record<string, string | undefined>>;
};

/** Emits `fuseos/repo-tree.json` into the build and serves it from the dev server. */
export function repoTree(options: RepoTreePluginOptions = {}): Plugin {
  let base = "/";
  let root = options.root ?? process.cwd();
  const manifest = () =>
    JSON.stringify(
      buildRepoManifest(options.git ?? execGit(root), {
        env: options.env ?? process.env,
      }),
    );
  return {
    name: "fuseos-repo-tree",
    configResolved(config) {
      base = config.base;
      root = options.root ?? config.root;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== `${base}${REPO_TREE_PATH}`) {
          next();
          return;
        }
        // Rebuilt per request: a new commit shows up on the next My Computer without a restart.
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(manifest());
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: REPO_TREE_PATH,
        source: manifest(),
      });
    },
  };
}
