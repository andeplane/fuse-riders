import type { RepoManifest } from "./repoTree";
import { parseRepoManifest } from "./repoTree";

/** A file's text and where it came from: the build's commit, or the fallback branch when that commit is not on GitHub. */
export type DiskText = {
  text: string;
  /** True when the build's commit had no such file on GitHub (an unpushed local build) and `fallbackRef` served it. */
  fromFallback: boolean;
};

/** Where the C: drive's contents come from. Production reads GitHub; tests hand in a map. */
export interface DiskSource {
  /** The build's manifest, fetched once and shared by every window; a failed fetch is retried on the next call. */
  manifest(): Promise<RepoManifest>;
  readText(path: string): Promise<DiskText>;
  /** URL of a file's raw bytes (for images); `fallback` picks the fallback branch instead of the commit. */
  fileUrl(manifest: RepoManifest, path: string, fallback?: boolean): string;
}

export class DiskError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DiskError";
  }
}

export const NOT_ON_GITHUB_NOTICE =
  "This build's commit is not on GitHub yet; showing the file as it is on main.";

export type GitHubDiskSourceDeps = {
  fetch: typeof fetch;
  manifestUrl: string;
  rawBase?: string;
};

const RAW_BASE = "https://raw.githubusercontent.com";

/** The manifest from the site, file contents from raw.githubusercontent.com at the manifest's commit. */
export class GitHubDiskSource implements DiskSource {
  private pending: Promise<RepoManifest> | undefined;
  /** Set once a read at the commit 404s: later reads skip straight to the fallback branch. */
  private commitMissing = false;
  private readonly rawBase: string;

  constructor(private readonly deps: GitHubDiskSourceDeps) {
    this.rawBase = deps.rawBase ?? RAW_BASE;
  }

  manifest(): Promise<RepoManifest> {
    this.pending ??= this.fetchManifest().catch((error: unknown) => {
      this.pending = undefined;
      throw error;
    });
    return this.pending;
  }

  private async fetchManifest(): Promise<RepoManifest> {
    const response = await this.deps.fetch(this.deps.manifestUrl, {
      cache: "no-cache",
    });
    if (!response.ok)
      throw new DiskError(
        `The drive manifest could not be read (HTTP ${response.status}).`,
        response.status,
      );
    return parseRepoManifest(await response.json());
  }

  fileUrl(manifest: RepoManifest, path: string, fallback = false): string {
    const ref = fallback ? manifest.fallbackRef : manifest.sha;
    return `${this.rawBase}/${manifest.repo}/${ref}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  async readText(path: string): Promise<DiskText> {
    const manifest = await this.manifest();
    if (!this.commitMissing) {
      const response = await this.deps.fetch(this.fileUrl(manifest, path));
      if (response.ok)
        return { text: await response.text(), fromFallback: false };
      if (response.status !== 404)
        throw new DiskError(
          `GitHub did not return ${path} (HTTP ${response.status}).`,
          response.status,
        );
      this.commitMissing = true;
    }
    const response = await this.deps.fetch(this.fileUrl(manifest, path, true));
    if (!response.ok)
      throw new DiskError(
        `GitHub did not return ${path} (HTTP ${response.status}).`,
        response.status,
      );
    return { text: await response.text(), fromFallback: true };
  }
}

export type MemoryDiskSourceOptions = {
  /** Paths that 404 at the commit (but not on the fallback branch), as an unpushed build sees them. */
  missingAtCommit?: readonly string[];
  /** Paths whose read fails outright. */
  failing?: readonly string[];
  /** Reject the manifest this many times before serving it. */
  manifestFailures?: number;
};

/** In-memory source for tests and previews: contents keyed by repository path. */
export class MemoryDiskSource implements DiskSource {
  readonly reads: string[] = [];
  private manifestFailures: number;

  constructor(
    private readonly data: RepoManifest,
    private readonly contents: Readonly<Record<string, string>>,
    private readonly options: MemoryDiskSourceOptions = {},
  ) {
    this.manifestFailures = options.manifestFailures ?? 0;
  }

  manifest(): Promise<RepoManifest> {
    if (this.manifestFailures > 0) {
      this.manifestFailures -= 1;
      return Promise.reject(
        new DiskError("The drive manifest could not be read (HTTP 503).", 503),
      );
    }
    return Promise.resolve(this.data);
  }

  fileUrl(manifest: RepoManifest, path: string, fallback = false): string {
    return `memory://${manifest.repo}/${fallback ? manifest.fallbackRef : manifest.sha}/${path}`;
  }

  readText(path: string): Promise<DiskText> {
    this.reads.push(path);
    const text = this.contents[path];
    if (text === undefined || this.options.failing?.includes(path))
      return Promise.reject(
        new DiskError(`GitHub did not return ${path} (HTTP 404).`, 404),
      );
    return Promise.resolve({
      text,
      fromFallback: this.options.missingAtCommit?.includes(path) ?? false,
    });
  }
}
