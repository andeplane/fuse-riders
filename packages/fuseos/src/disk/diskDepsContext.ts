import { createContext } from "react";

import type { DiskOverlay } from "./diskOverlay";
import { IndexedDbDiskOverlay, MemoryDiskOverlay } from "./diskOverlay";
import type { DiskSource } from "./diskSource";
import { GitHubDiskSource } from "./diskSource";
import type { FloppyJokeGate } from "./floppy";
import { MemoryFloppyJokeGate } from "./floppy";
import { createFloppySeek } from "./floppySeek";

/** Everything the drives need from outside: GitHub, the browser's storage, the floppy's theatrics. */
export type DiskDeps = {
  source: DiskSource;
  overlay: DiskOverlay;
  jokeGate: FloppyJokeGate;
  /** Opening A: waits for this (the drive seeking; the noise is the "floppy" system sound) before showing the listing. */
  floppySeek: () => Promise<void>;
  /** The network password box holds "Connecting..." and then "Access granted" this long each. */
  logonPause: (step: LogonStep) => Promise<void>;
};

/** The two beats of a successful network logon. */
export type LogonStep = "connecting" | "granted";

/** How long each beat lasts in the app, in milliseconds. */
export const LOGON_PAUSE_MS: Record<LogonStep, number> = {
  connecting: 1400,
  granted: 900,
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
    logonPause: (step) =>
      new Promise((resolve) => {
        window.setTimeout(resolve, LOGON_PAUSE_MS[step]);
      }),
  };
  return production;
}

export const DiskDepsContext = createContext<DiskDeps | undefined>(undefined);
