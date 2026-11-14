import type {
  RepoManifest,
  RepoManifestFile,
} from "../../../../scripts/fuseos/repo-tree-plugin";

export type { RepoManifest, RepoManifestFile };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isManifestFile(value: unknown): value is RepoManifestFile {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    !value.path.startsWith("/") &&
    !value.path.split("/").includes("..") &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0
  );
}

/** Validates the fetched manifest; the build writes it, but a stale cache or a proxy page is not trusted. */
export function parseRepoManifest(value: unknown): RepoManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.repo !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repo) ||
    typeof value.sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sha) ||
    typeof value.committedAt !== "string" ||
    typeof value.fallbackRef !== "string" ||
    value.fallbackRef.length === 0 ||
    !Array.isArray(value.files) ||
    !value.files.every(isManifestFile)
  )
    throw new Error("The drive manifest is not in a shape this build knows.");
  return {
    version: 1,
    repo: value.repo,
    sha: value.sha,
    committedAt: value.committedAt,
    fallbackRef: value.fallbackRef,
    files: value.files,
  };
}

export type RepoFolder = {
  /** Repository path of the folder; "" at the root. */
  path: string;
  /** Child folder paths, sorted. */
  folders: string[];
  /** Files directly inside, sorted by path. */
  files: RepoManifestFile[];
};

/** The manifest's flat file list as folders, so Explorer can list and expand without scanning 4000 paths each time. */
export class RepoTree {
  private readonly folders = new Map<string, RepoFolder>();
  private readonly byPath = new Map<string, RepoManifestFile>();

  constructor(files: readonly RepoManifestFile[]) {
    this.ensure("");
    for (const file of files) {
      this.byPath.set(file.path, file);
      const cut = file.path.lastIndexOf("/");
      const parent = cut < 0 ? "" : file.path.slice(0, cut);
      this.ensure(parent).files.push(file);
    }
    for (const folder of this.folders.values()) {
      folder.folders.sort();
      folder.files.sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      );
    }
  }

  private ensure(path: string): RepoFolder {
    const existing = this.folders.get(path);
    if (existing) return existing;
    const folder: RepoFolder = { path, folders: [], files: [] };
    this.folders.set(path, folder);
    if (path !== "") {
      const cut = path.lastIndexOf("/");
      const parent = cut < 0 ? "" : path.slice(0, cut);
      this.ensure(parent).folders.push(path);
    }
    return folder;
  }

  /** The folder at `path`, or undefined when no committed file lives under it. */
  folder(path: string): RepoFolder | undefined {
    return this.folders.get(path);
  }

  file(path: string): RepoManifestFile | undefined {
    return this.byPath.get(path);
  }

  get fileCount(): number {
    return this.byPath.size;
  }
}
