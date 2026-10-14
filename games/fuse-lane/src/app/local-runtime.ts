import type { FuseLaneView } from "../game/index.js";
import { LocalMatch, type LocalSetup } from "./local.js";
import type { Store } from "./session.js";

/** Where a match in progress is kept between visits. */
export const SAVE_KEY = "fuse-lane-local-save";
/** Ticks between saves while a week runs (5 s), besides every change of phase or turn. */
const SAVE_EVERY = 100;
const TICK_MS = 50;
/** At most this many extra folds per interval when catching up. */
const MAX_CATCH_UP = 3;

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
  /** When the loop last ran, and the time it has fallen behind since (late intervals), to catch up on. */
  private ranAt = 0;
  private behind = 0;
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

  /**
   * The saved match on this device, or undefined (none, or a store that refuses). A save that does not decode (damaged,
   * or from another version) is forgotten, so the menu stops offering it.
   */
  static saved(store: Store): LocalMatch | undefined {
    let raw: string | null;
    try {
      raw = store.getItem(SAVE_KEY);
    } catch {
      return undefined;
    }
    if (!raw) return undefined;
    let match: LocalMatch | undefined;
    try {
      match = LocalMatch.resume(JSON.parse(raw));
    } catch {
      match = undefined;
    }
    if (!match) LocalRuntime.forget(store);
    return match;
  }

  static forget(store: Store): void {
    try {
      store.removeItem(SAVE_KEY);
    } catch {
      /* nothing saved, nothing lost */
    }
  }

  /**
   * Starts the clock, or shows the match paused (`paused`): a resumed save waits for the player to tap RESUME, and a
   * page opened in the background does not burn a turn.
   */
  start(paused = false): void {
    if (paused && this.match.room.stage === "running") this.paused = true;
    this.newerAt = this.deps.now();
    this.ranAt = this.newerAt;
    this.behind = 0;
    this.onFrame(this.newer);
    this.stopLoop ??= this.deps.every(() => this.run(), TICK_MS);
  }

  /**
   * One interval: a fold, plus up to MAX_CATCH_UP more when the intervals came late (a busy phone, a browser that
   * slows timers), so a 60 s week lasts 60 s on every device. Paused time is not owed.
   */
  private run(): void {
    const now = this.deps.now();
    this.behind = Math.min(
      MAX_CATCH_UP * TICK_MS,
      Math.max(0, this.behind + now - this.ranAt - TICK_MS),
    );
    this.ranAt = now;
    if (this.paused) this.behind = 0;
    this.tick();
    for (let n = 0; n < MAX_CATCH_UP && this.behind >= TICK_MS; n++) {
      this.behind -= TICK_MS;
      this.tick();
    }
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
    else {
      this.ranAt = this.deps.now();
      this.behind = 0;
    }
    this.onFrame(this.newer);
  }

  /** Logs a play entry for the next fold; nothing is taken while paused, since the clock is stopped. */
  play(body: readonly unknown[]): boolean {
    return !this.paused && this.match.play(body);
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
