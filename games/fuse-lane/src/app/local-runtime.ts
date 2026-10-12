import type { FuseLaneView } from "../game/index.js";
import { LocalMatch, type LocalSetup } from "./local.js";
import type { Store } from "./session.js";

/** Where a match in progress is kept between visits. */
export const SAVE_KEY = "fuse-lane-local-save";
/** Ticks between saves while a week runs (5 s), besides every change of phase or turn. */
const SAVE_EVERY = 100;
const TICK_MS = 50;

export interface LocalDeps {
  now(): number;
  /** Runs `callback` every `ms` until the returned function is called. */
  every(callback: () => void, ms: number): () => void;
  store: Store;
}

/** The two newest frames and how far between them to draw, the shape `RoomRuntime.frameTiming` hands the board. */
export interface LocalTiming {
  older?: FuseLaneView;
  newer: FuseLaneView;
  tick: number;
}

/**
 * Runs a `LocalMatch` in real time: one fold every 50 ms, a pause (a phone call, the menu), and a save of the room's
 * checkpoint at every phase or turn change and every few seconds, so closing the tab loses at most a moment.
 */
export class LocalRuntime {
  private newer: FuseLaneView;
  private older: FuseLaneView | undefined;
  private newerAt = 0;
  private stopLoop: (() => void) | undefined;
  private savedAt = -Infinity;
  private moment = "";
  paused = false;

  constructor(
    readonly match: LocalMatch,
    private readonly onFrame: (view: FuseLaneView) => void,
    private readonly deps: LocalDeps,
  ) {
    this.newer = match.view();
  }

  static fromSetup(
    setup: LocalSetup,
    onFrame: (view: FuseLaneView) => void,
    deps: LocalDeps,
  ): LocalRuntime {
    return new LocalRuntime(LocalMatch.create(setup), onFrame, deps);
  }

  /** The saved match on this device, or undefined (none, another version, or a store that refuses). */
  static saved(store: Store): LocalMatch | undefined {
    try {
      const raw = store.getItem(SAVE_KEY);
      return raw ? LocalMatch.resume(JSON.parse(raw)) : undefined;
    } catch {
      return undefined;
    }
  }

  static forget(store: Store): void {
    try {
      store.removeItem(SAVE_KEY);
    } catch {
      /* nothing saved, nothing lost */
    }
  }

  start(): void {
    this.newerAt = this.deps.now();
    this.onFrame(this.newer);
    this.stopLoop ??= this.deps.every(() => this.tick(), TICK_MS);
  }

  stop(): void {
    this.stopLoop?.();
    this.stopLoop = undefined;
    this.save();
  }

  /** One fold, unless paused or over. */
  tick(): void {
    const room = this.match.room;
    if (this.paused || room.stage !== "running") return;
    this.match.step();
    this.older = this.newer;
    this.newer = this.match.view();
    this.newerAt = this.deps.now();
    const moment = `${room.stage}:${room.week}:${room.phase}:${room.turn}`;
    if (moment !== this.moment || room.tick - this.savedAt >= SAVE_EVERY) {
      this.moment = moment;
      this.save();
    }
    this.onFrame(this.newer);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.save();
    this.onFrame(this.newer);
  }

  play(body: readonly unknown[]): boolean {
    return this.match.play(body);
  }

  frameTiming(): LocalTiming {
    const older = this.older;
    if (!older || this.paused)
      return { newer: this.newer, tick: this.newer.tick };
    const fraction = Math.max(
      0,
      Math.min(1, (this.deps.now() - this.newerAt) / TICK_MS),
    );
    return {
      older,
      newer: this.newer,
      tick: older.tick + fraction * (this.newer.tick - older.tick),
    };
  }

  /** Keeps the match for later; a finished match is forgotten. */
  save(): void {
    const room = this.match.room;
    this.savedAt = room.tick;
    try {
      if (room.stage === "running")
        this.deps.store.setItem(SAVE_KEY, JSON.stringify(this.match.save()));
      else this.deps.store.removeItem(SAVE_KEY);
    } catch {
      /* a full or blocked store: the game plays on unsaved */
    }
  }
}
