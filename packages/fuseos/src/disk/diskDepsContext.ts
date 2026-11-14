import { createContext } from "react";

import type { DiskOverlay } from "./diskOverlay";
import { IndexedDbDiskOverlay, MemoryDiskOverlay } from "./diskOverlay";
import type { DiskSource } from "./diskSource";
import { GitHubDiskSource } from "./diskSource";
import type { FloppyJokeGate } from "./floppy";
import { MemoryFloppyJokeGate } from "./floppy";
import { createFloppySeek } from "./floppySound";

/** Everything the drives need from outside: GitHub, the browser's storage, the floppy's theatrics. */
export type DiskDeps = {
  source: DiskSource;
  overlay: DiskOverlay;
  jokeGate: FloppyJokeGate;
  /** Opening A: waits for this (the seek noise and its delay) before showing the listing. */
  floppySeek: () => Promise<void>;
};

/** Where the build wrote the manifest: beside the site, under its base. */
export const manifestUrl = (base: string): string =>
  `${base}fuseos/repo-tree.json`;

let production: DiskDeps | undefined;

/** Built on first use, so importing this module (for the context) costs no IndexedDB open or fetch. */
export function defaultDiskDeps(): DiskDeps {
  production ??= {
    source: new GitHubDiskSource({
      fetch: (input, init) => fetch(input, init),
      manifestUrl: manifestUrl(import.meta.env.BASE_URL),
    }),
    overlay:
      typeof indexedDB === "object" && indexedDB !== null
        ? new IndexedDbDiskOverlay(indexedDB)
        : new MemoryDiskOverlay(),
    jokeGate: new MemoryFloppyJokeGate(),
    floppySeek: createFloppySeek(),
  };
  return production;
}

export const DiskDepsContext = createContext<DiskDeps | undefined>(undefined);
