import {
  FLOPPY_JOKE_FOLDER,
  FLOPPY_ZIP_NAME,
  FLOPPY_ZIP_SIZE,
  HOMEWORK_NAME,
  HOMEWORK_TEXT,
} from "../disk/floppy";

import type { DefragFile } from "./defragDisk";
import { DefragDisk } from "./defragDisk";

/** The drives Disk Defragmenter can be pointed at. */
export type DefragDrive = "C" | "A";
/** What the Select Drive list offers: a drive, or every hard drive (there is one). */
export type DefragChoice = DefragDrive | "all";

export type DefragStage = "select" | "settings" | "running";

export type DefragOptions = {
  /** "Rearrange program files so my programs start faster." */
  rearrange: boolean;
  /** "Check the drive for errors." */
  checkErrors: boolean;
  /** "Every time I defragment my hard drive" rather than "This time only". */
  everyTime: boolean;
};

export type DefragDialog =
  | { kind: "restart"; message: string; detail: string }
  | { kind: "confirmStop" }
  | { kind: "complete" };

export type DefragSnapshot = {
  stage: DefragStage;
  choice: DefragChoice;
  /** The drive being defragmented (C for "All Hard Drives"). */
  drive: DefragDrive;
  options: DefragOptions;
  details: boolean;
  legend: boolean;
  paused: boolean;
  percent: number;
  status: string;
  /** One code per cluster (an index into `CELL_STATES`); empty until the drive has been read. */
  cells: Uint8Array;
  dialog: DefragDialog | undefined;
  /** The program asked to quit; whoever hosts the session closes its window. */
  exited: boolean;
};

/** A pending timer, opaque to the code that holds it. */
export type DefragTimerHandle = unknown;

export type DefragSessionDeps = {
  setTimeout: (callback: () => void, ms: number) => DefragTimerHandle;
  clearTimeout: (handle: DefragTimerHandle) => void;
  /** Decides when the disk "changes" and who gets the blame; [0, 1). */
  random: () => number;
  /** The user asked the system for less motion: no read/write flashes, fewer and bigger steps. */
  reducedMotion: () => boolean;
  /** The track Winamp is playing right now; undefined when it is silent or closed. */
  winampTrack: () => string | undefined;
  /** The floppy drive's grinding; absent where nothing can make a sound. */
  floppySound?: () => void;
};

export type DefragSession = {
  getSnapshot(): DefragSnapshot;
  subscribe(listener: () => void): () => void;
  /** The C: drive's real file list, once the manifest is in; `seed` makes the mess this commit's own. */
  setHardDrive(files: readonly DefragFile[], seed: number): void;
  choose(choice: DefragChoice): void;
  openSettings(): void;
  saveSettings(options: DefragOptions): void;
  cancelSettings(): void;
  start(): void;
  exit(): void;
  togglePause(): void;
  requestStop(): void;
  answerStop(stop: boolean): void;
  toggleDetails(): void;
  setLegend(open: boolean): void;
  dismissRestart(): void;
  answerComplete(quit: boolean): void;
  dispose(): void;
};

/** The grid Show Details draws: 68 squares across, 32 down. */
export const GRID_COLUMNS = 68;
export const GRID_ROWS = 32;
export const CLUSTERS = GRID_COLUMNS * GRID_ROWS;

/** One beat of the head: a read or a write. */
export const TICK_MS = 110;
/** With reduced motion the grid changes in a few larger steps instead of flickering. */
export const REDUCED_TICK_MS = 500;
export const REDUCED_STEPS_PER_TICK = 16;
/** Beats spent on "Checking drive for errors..." before the first cluster moves. */
export const CHECK_TICKS = 30;
/** A restart notice dismisses itself, so a minimized run is not left waiting for a click. */
export const RESTART_NOTICE_MS = 6000;
/** At most this many "another program wrote to the disk" restarts per run, however long Winamp plays. */
export const MAX_WINAMP_RESTARTS = 2;
/** How many beats pass between two grinds of the floppy drive. */
export const FLOPPY_GRIND_TICKS = 40;

export const DEFAULT_OPTIONS: DefragOptions = {
  rearrange: true,
  checkErrors: true,
  everyTime: true,
};

/** What is on the floppy: the archive that never unzips and the homework. */
export const FLOPPY_FILES: readonly DefragFile[] = [
  { path: FLOPPY_ZIP_NAME, size: FLOPPY_ZIP_SIZE },
  {
    path: `${FLOPPY_JOKE_FOLDER}/${HOMEWORK_NAME}`,
    size: HOMEWORK_TEXT.length,
  },
];

/** A drive to tidy when the manifest cannot be read: the files every such disk had. */
export const FALLBACK_FILES: readonly DefragFile[] = [
  { path: "WINDOWS/SYSTEM/KERNEL32.DLL", size: 471_040 },
  { path: "WINDOWS/SYSTEM/USER32.DLL", size: 45_568 },
  { path: "WINDOWS/SYSTEM/VMM32.VXD", size: 924_661 },
  { path: "WINDOWS/WIN386.SWP", size: 16_777_216 },
  { path: "WINDOWS/EXPLORER.EXE", size: 180_224 },
  { path: "PROGRAM FILES/WINAMP/WINAMP.EXE", size: 892_928 },
  { path: "MY DOCUMENTS/HOMEWORK.DOC", size: 24_064 },
  { path: "GAMES/DOOM/DOOM.WAD", size: 12_408_292 },
  { path: "AUTOEXEC.BAT", size: 312 },
  { path: "CONFIG.SYS", size: 218 },
];

/** "Program files" on this drive are the games; with the option on they move to the front. */
export const isProgramFile = (path: string): boolean =>
  /^(games|PROGRAM FILES|GAMES)\//.test(path);

export const CONTENTS_CHANGED = (drive: DefragDrive): string =>
  `Drive ${drive}'s contents have changed. Defragmenter will restart.`;
export const ANOTHER_PROGRAM_WROTE =
  "Windows is restarting Disk Defragmenter because another program wrote to the disk.";
export const BLAMES: readonly string[] = [
  "Clippy saved a tip you did not ask for.",
  "Winamp rewrote WINAMP.INI. Again.",
];

type Run = {
  disk: DefragDisk;
  checking: number;
  /** The percent at which the drive's contents "change", or undefined once it has happened. */
  changeAt: number | undefined;
  /** The next quarter at which a playing Winamp gets caught writing. */
  nextWinampCheck: number;
  winampRestarts: number;
  restarting: boolean;
  ticks: number;
};

export function createDefragSession(
  deps: DefragSessionDeps,
  initial: { drive?: DefragDrive } = {},
): DefragSession {
  const listeners = new Set<() => void>();
  let hardDrive: { files: readonly DefragFile[]; seed: number } | undefined;
  let run: Run | undefined;
  let tickTimer: DefragTimerHandle | undefined;
  let noticeTimer: DefragTimerHandle | undefined;
  let disposed = false;
  // "Drive's contents have changed" happens once per sitting; a second run is spared.
  let changeJokeSpent = false;

  let snapshot: DefragSnapshot = {
    stage: "select",
    choice: initial.drive ?? "C",
    drive: initial.drive ?? "C",
    options: DEFAULT_OPTIONS,
    details: false,
    legend: false,
    paused: false,
    percent: 0,
    status: "",
    cells: new Uint8Array(0),
    dialog: undefined,
    exited: false,
  };

  const update = (patch: Partial<DefragSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    [...listeners].forEach((listener) => listener());
  };

  const stopTicking = () => {
    if (tickTimer !== undefined) deps.clearTimeout(tickTimer);
    tickTimer = undefined;
  };
  const clearNotice = () => {
    if (noticeTimer !== undefined) deps.clearTimeout(noticeTimer);
    noticeTimer = undefined;
  };

  const schedule = () => {
    stopTicking();
    if (
      disposed ||
      !run ||
      snapshot.stage !== "running" ||
      snapshot.paused ||
      snapshot.dialog
    )
      return;
    tickTimer = deps.setTimeout(
      tick,
      deps.reducedMotion() ? REDUCED_TICK_MS : TICK_MS,
    );
  };

  const fileStatus = (active: Run): string => {
    if (active.restarting)
      return `Drive ${snapshot.drive}'s contents have changed: restarting...`;
    const verb =
      snapshot.options.rearrange && isProgramFile(active.disk.currentFile)
        ? "Rearranging program file"
        : "Defragmenting file";
    return `${verb}: ${active.disk.currentFile}`;
  };

  const restart = (active: Run, message: string, detail: string) => {
    active.disk.disturb(24);
    active.restarting = true;
    update({
      percent: 0,
      cells: active.disk.cells(false),
      status: fileStatus(active),
      dialog: { kind: "restart", message, detail },
    });
    stopTicking();
    noticeTimer = deps.setTimeout(dismissRestart, RESTART_NOTICE_MS);
  };

  function tick() {
    tickTimer = undefined;
    const active = run;
    if (!active) return;
    const reduced = deps.reducedMotion();
    active.ticks += 1;
    if (snapshot.drive === "A" && active.ticks % FLOPPY_GRIND_TICKS === 0)
      deps.floppySound?.();

    if (active.checking > 0) {
      active.checking -= reduced ? REDUCED_STEPS_PER_TICK : 1;
      update({ status: "Checking drive for errors..." });
      schedule();
      return;
    }

    for (let step = 0; step < (reduced ? REDUCED_STEPS_PER_TICK : 1); step += 1)
      active.disk.step();
    const percent = active.disk.percent;
    if (active.restarting && percent > 0) active.restarting = false;

    if (active.disk.done) {
      update({
        percent: 100,
        cells: active.disk.cells(false),
        status: "Defragmentation complete.",
        dialog: { kind: "complete" },
      });
      return;
    }
    if (active.changeAt !== undefined && percent >= active.changeAt) {
      active.changeAt = undefined;
      changeJokeSpent = true;
      restart(
        active,
        CONTENTS_CHANGED(snapshot.drive),
        BLAMES[Math.floor(deps.random() * BLAMES.length)] ?? "",
      );
      return;
    }
    if (percent >= active.nextWinampCheck) {
      active.nextWinampCheck += 25;
      const track = deps.winampTrack();
      if (track !== undefined && active.winampRestarts < MAX_WINAMP_RESTARTS) {
        active.winampRestarts += 1;
        restart(active, ANOTHER_PROGRAM_WROTE, `Winamp is playing ${track}.`);
        return;
      }
    }
    update({
      percent,
      cells: active.disk.cells(!reduced),
      status: fileStatus(active),
    });
    schedule();
  }

  const begin = () => {
    const drive = snapshot.drive;
    const source =
      drive === "A" ? { files: FLOPPY_FILES, seed: 1440 } : hardDrive;
    if (!source) {
      update({ status: "Reading drive information..." });
      return;
    }
    const disk = new DefragDisk(source.files, {
      clusters: CLUSTERS,
      seed: source.seed,
      usedFraction: drive === "A" ? 0.9 : 0.62,
      programsFirst: snapshot.options.rearrange ? isProgramFile : undefined,
    });
    run = {
      disk,
      checking: snapshot.options.checkErrors ? CHECK_TICKS : 0,
      changeAt: changeJokeSpent
        ? undefined
        : 20 + Math.floor(deps.random() * 40),
      nextWinampCheck: 25,
      winampRestarts: 0,
      restarting: false,
      ticks: 0,
    };
    if (drive === "A") deps.floppySound?.();
    update({
      percent: 0,
      cells: disk.cells(false),
      status: "Reading drive information...",
    });
    schedule();
  };

  function dismissRestart() {
    if (snapshot.dialog?.kind !== "restart") return;
    clearNotice();
    update({ dialog: undefined });
    schedule();
  }

  const toSelect = () => {
    stopTicking();
    clearNotice();
    run = undefined;
    update({
      stage: "select",
      details: false,
      legend: false,
      paused: false,
      percent: 0,
      status: "",
      cells: new Uint8Array(0),
      dialog: undefined,
    });
  };

  const start = () => {
    stopTicking();
    clearNotice();
    run = undefined;
    update({
      stage: "running",
      drive: snapshot.choice === "all" ? "C" : snapshot.choice,
      paused: false,
      legend: false,
      percent: 0,
      cells: new Uint8Array(0),
      dialog: undefined,
    });
    begin();
  };

  const exit = () => {
    stopTicking();
    clearNotice();
    update({ exited: true });
  };

  const session: DefragSession = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setHardDrive(files, seed) {
      hardDrive = { files: files.length > 0 ? files : FALLBACK_FILES, seed };
      if (snapshot.stage === "running" && snapshot.drive === "C" && !run)
        begin();
    },
    choose: (choice) => update({ choice }),
    openSettings: () => update({ stage: "settings" }),
    saveSettings: (options) => update({ stage: "select", options }),
    cancelSettings: () => update({ stage: "select" }),
    start,
    exit,
    togglePause() {
      if (snapshot.stage !== "running") return;
      update({ paused: !snapshot.paused });
      schedule();
    },
    requestStop() {
      if (snapshot.stage !== "running" || snapshot.dialog) return;
      update({ dialog: { kind: "confirmStop" } });
      stopTicking();
    },
    answerStop(stop) {
      if (snapshot.dialog?.kind !== "confirmStop") return;
      if (stop) {
        exit();
        return;
      }
      update({ dialog: undefined });
      schedule();
    },
    toggleDetails: () => update({ details: !snapshot.details, legend: false }),
    setLegend: (open) => update({ legend: open && snapshot.details }),
    dismissRestart,
    answerComplete(quit) {
      if (snapshot.dialog?.kind !== "complete") return;
      if (quit) exit();
      else toSelect();
    },
    dispose() {
      disposed = true;
      stopTicking();
      clearNotice();
      listeners.clear();
    },
  };

  if (initial.drive) start();
  return session;
}
