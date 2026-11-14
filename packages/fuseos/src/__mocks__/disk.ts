import type { DiskDeps } from "../disk/diskDepsContext";
import { MemoryDiskOverlay } from "../disk/diskOverlay";
import type { MemoryDiskSourceOptions } from "../disk/diskSource";
import { MemoryDiskSource } from "../disk/diskSource";
import { MemoryFloppyJokeGate } from "../disk/floppy";
import type { RepoManifest } from "../disk/repoTree";

export const FIXTURE_SHA = "0123456789abcdef0123456789abcdef01234567";

/** A small repository: a README, a package with two source files, a picture, an archive and a big file. */
export const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "README.md": "# Fuse Riders\n\nLight cycles for five.\n",
  "package.json": '{\n  "name": "fuse-riders",\n  "private": true\n}\n',
  "packages/fuseos/src/App.tsx":
    "export function App() {\n  return <p>FuseOS</p>;\n}\n",
  "packages/fuseos/src/main.tsx": 'import "./App";\n',
  "packages/fuseos/package.json": '{ "name": "fuseos" }\n',
  "docs/notes.txt": "plain notes\n",
};

export const FIXTURE_LARGE_FILE = "docs/huge.log";
export const FIXTURE_IMAGE = "public/gallery/fuseball.jpg";
export const FIXTURE_BINARY = "public/music/theme.mp3";

export function createFixtureManifest(): RepoManifest {
  const files = Object.entries(FIXTURE_FILES).map(([path, text]) => ({
    path,
    size: text.length,
  }));
  files.push(
    { path: FIXTURE_LARGE_FILE, size: 900 * 1024 },
    { path: FIXTURE_IMAGE, size: 48_123 },
    { path: FIXTURE_BINARY, size: 2_048_000 },
  );
  return {
    version: 1,
    repo: "andeplane/fuse-riders",
    sha: FIXTURE_SHA,
    committedAt: "2026-11-14T13:39:08Z",
    fallbackRef: "main",
    files,
  };
}

export type TestDiskOptions = {
  source?: MemoryDiskSourceOptions;
  /** Paths already saved in the browser when the desktop boots. */
  overlay?: Readonly<Record<string, string>>;
  /** Controls when the floppy seek ends; by default it is over at once. */
  floppySeek?: () => Promise<void>;
};

export type TestDiskDeps = DiskDeps & {
  source: MemoryDiskSource;
  overlay: MemoryDiskOverlay;
  jokeGate: MemoryFloppyJokeGate;
  seeks: number;
};

/** Disk deps over the fixture repository: no network, no IndexedDB, no sound. */
export function createTestDiskDeps(
  options: TestDiskOptions = {},
): TestDiskDeps {
  const deps: TestDiskDeps = {
    source: new MemoryDiskSource(
      createFixtureManifest(),
      FIXTURE_FILES,
      options.source,
    ),
    overlay: new MemoryDiskOverlay(options.overlay),
    jokeGate: new MemoryFloppyJokeGate(),
    seeks: 0,
    floppySeek: () => {
      deps.seeks += 1;
      return options.floppySeek ? options.floppySeek() : Promise.resolve();
    },
  };
  return deps;
}
