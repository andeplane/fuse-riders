import { SnapshotAssembler } from "./snapshot.js";
import type { World } from "./rollback.js";
import type { LogEntry, RoomClock } from "./game.js";

/**
 * Where this replica stands with the shared world. The lifecycle used to be read back from three independent fields —
 * `world`, `snapshotRequest` and `outOfSync` — every tick, which made combinations like "no world but Live" or "a
 * request outstanding with nothing to install into" representable even though no code path could produce them. Here it
 * is one discriminated union, so the world is present exactly in the states that have one.
 *
 * ```
 *                 open()                          diverge()
 *   NoWorld ───────────────────────► Live ──────────────────────► Diverged
 *      │ ▲                            │ ▲                          │  ▲ │
 *      │ │ abandon()       requestFrom()│ │installed()   requestFrom()│  │ │abandon()/installed()/diverge()
 *      ▼ │                            ▼ │                          ▼  │ ▼
 *  Requesting ─────────────────► Resyncing ─────────────────────► Diverged (request optional)
 *              (installed() ⇒ Live)         diverge()
 * ```
 *
 * | from        | `open` | `requestFrom` | `abandon`  | `installed` | `diverge`  |
 * | ----------- | ------ | ------------- | ---------- | ----------- | ---------- |
 * | `NoWorld`   | Live   | Requesting    | NoWorld    | —           | —          |
 * | `Requesting`| —      | Requesting¹   | NoWorld    | Live        | —          |
 * | `Live`      | —      | Resyncing     | Live       | —           | Diverged   |
 * | `Resyncing` | —      | Resyncing¹    | Live       | Live        | Diverged   |
 * | `Diverged`  | —      | Diverged²     | Diverged²  | Diverged²   | Diverged   |
 *
 * ¹ the same state with a new peer and a fresh assembler: a retry rotating round the holders.
 * ² `Diverged` is latched and absorbing — today nothing clears it (see the note on `diverge`). A snapshot request may
 *   still be outstanding while diverged (a gap or a backlog asks for one), so the state carries an optional request
 *   rather than splitting into a diverged-live and a diverged-resyncing pair that no caller distinguishes.
 */
export type WorldSyncState =
  "NoWorld" | "Requesting" | "Live" | "Resyncing" | "Diverged";

/** One outstanding snapshot fetch: who was asked, when, how many attempts have failed, and the chunks arriving. */
export interface SnapshotRequest {
  readonly to: string;
  at: number;
  failures: number;
  assembler: SnapshotAssembler;
}

type Sync<W> =
  | { at: "NoWorld" }
  | { at: "Requesting"; request: SnapshotRequest }
  | { at: "Live"; world: W }
  | { at: "Resyncing"; world: W; request: SnapshotRequest }
  | { at: "Diverged"; world: W; request?: SnapshotRequest };

export const DIVERGENCE_WINDOW_MS = 60_000,
  DIVERGENCE_LIMIT = 3;

/**
 * The world lifecycle and the snapshot fetch that feeds it: which state this replica is in, who it last asked for a
 * world, which peers answered that they hold none, and how many authority hashes it has failed to match.
 *
 * It owns no transport and no clock: the runtime asks it what state it is in and tells it what happened.
 */
export class WorldSync<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
> {
  private sync: Sync<World<Room, Entry, View, Event, Settings>> = {
    at: "NoWorld",
  };
  /** Peers that answered a snapshot request with `noWorld`, and when: an answer older than the retry interval is asked again. */
  private readonly noWorldAt = new Map<string, number>();
  /** Until when a resync that brought no newer world keeps this replica catching up rather than fetching again. */
  private catchUpUntil = -Infinity;
  private mismatches: number[] = [];
  /** Authority hashes this replica could compare with its own state, whatever the outcome. */
  hashChecks = 0;
  constructor(private readonly gameId: string) {}

  // ---- what state this is -------------------------------------------------------------------------------------------
  get state(): WorldSyncState {
    return this.sync.at;
  }
  get world(): World<Room, Entry, View, Event, Settings> | undefined {
    return "world" in this.sync ? this.sync.world : undefined;
  }
  /** The outstanding fetch, if any. `Diverged` may carry one; `NoWorld` and `Live` never do. */
  get request(): SnapshotRequest | undefined {
    return "request" in this.sync ? this.sync.request : undefined;
  }
  get requesting(): boolean {
    return this.request !== undefined;
  }
  /** Latched: this replica has failed the authority hash too often to trust its own fold. */
  get diverged(): boolean {
    return this.sync.at === "Diverged";
  }
  get mismatchCount(): number {
    return this.mismatches.length;
  }

  // ---- transitions --------------------------------------------------------------------------------------------------
  /** A world opened locally, with nobody to fetch one from. Only from `NoWorld`: nothing else has one to replace. */
  open(world: World<Room, Entry, View, Event, Settings>): void {
    if (this.sync.at !== "NoWorld") return;
    this.sync = { at: "Live", world };
  }
  /** Ask `to` for the world. From a state that already holds one this is a resync; from one that does not, the first fetch. */
  requestFrom(to: string, at: number, assembler: SnapshotAssembler): void {
    // A retry rotating round the holders keeps the count, so `SNAPSHOT_FAILURES` still raises "could not load".
    const request: SnapshotRequest = {
      to,
      at,
      failures: this.request?.failures ?? 0,
      assembler,
    };
    switch (this.sync.at) {
      case "NoWorld":
      case "Requesting":
        this.sync = { at: "Requesting", request };
        return;
      case "Live":
      case "Resyncing":
        this.sync = { at: "Resyncing", world: this.sync.world, request };
        return;
      case "Diverged":
        this.sync = { at: "Diverged", world: this.sync.world, request };
    }
  }
  /** The peer we asked cannot answer: it left, it said it holds no world, or its hello put it on other rules. */
  abandonRequest(): void {
    switch (this.sync.at) {
      case "Requesting":
        this.sync = { at: "NoWorld" };
        return;
      case "Resyncing":
        this.sync = { at: "Live", world: this.sync.world };
        return;
      case "Diverged":
        this.sync = { at: "Diverged", world: this.sync.world };
    }
  }
  /** The peer answered, but the snapshot did not validate: keep asking it, on the retry timer, with a fresh assembler. */
  restartAssembly(at: number, assembler: SnapshotAssembler): void {
    const request = this.request;
    if (!request) return;
    request.failures++;
    request.at = at;
    request.assembler = assembler;
  }
  /** A snapshot validated and was installed (into `world`, whether it was replaced or written over in place). */
  installed(world: World<Room, Entry, View, Event, Settings>): void {
    this.sync =
      this.sync.at === "Diverged"
        ? { at: "Diverged", world }
        : { at: "Live", world };
  }
  /**
   * Too many authority hashes missed: this replica's fold is not the room's. Latched — nothing clears it today, and
   * the runtime keeps simulating the diverged world. Both are pre-existing behaviour, preserved here deliberately;
   * see issue #258's N1/P4 findings.
   */
  private diverge(): void {
    if (!("world" in this.sync)) return;
    this.sync = { at: "Diverged", world: this.sync.world };
  }

  // ---- divergence ---------------------------------------------------------------------------------------------------
  /**
   * Compare an authority's hash for `tick` with this replica's own. `"unknown"` when there is nothing to compare (no
   * world, a tick not folded through, or a gap in any stream); otherwise the comparison, and on a miss whether that
   * was one more chased with a resync or the one that latches `Diverged`.
   */
  compareHash(
    tick: number,
    hash: string,
    now: number,
  ): "unknown" | "match" | "resync" | "diverged" {
    const world = this.world;
    if (
      !world ||
      tick > world.completeTick() ||
      [...world.streams.values()].some((stream) => stream.gap)
    )
      return "unknown";
    const mine = world.hashAt(tick);
    if (mine !== undefined) this.hashChecks++;
    if (mine === undefined) return "unknown";
    if (mine === hash) return "match";
    console.warn(
      `${this.gameId}: simulation diverged at tick ${tick}: local ${mine}, authority ${hash}`,
    );
    this.mismatches = this.mismatches.filter(
      (at) => now - at <= DIVERGENCE_WINDOW_MS,
    );
    this.mismatches.push(now);
    if (this.mismatches.length < DIVERGENCE_LIMIT) return "resync";
    this.diverge();
    return "diverged";
  }

  // ---- peers that hold no world --------------------------------------------------------------------------------------
  noteNoWorld(id: string, now: number): void {
    this.noWorldAt.set(id, now);
  }
  forgetNoWorld(id: string): void {
    this.noWorldAt.delete(id);
  }
  clearNoWorld(): void {
    this.noWorldAt.clear();
  }
  /** Whether `id` answered "no world" recently enough that asking again would only repeat the answer. */
  saidNoWorld(id: string, now: number, retryMs: number): boolean {
    return now - (this.noWorldAt.get(id) ?? -Infinity) < retryMs;
  }

  // ---- catching up rather than fetching --------------------------------------------------------------------------------
  /** A resync that is not ahead of this world says nobody is: catch the backlog up for `holdMs` instead of fetching again. */
  holdCatchUp(until: number): void {
    this.catchUpUntil = until;
  }
  releaseCatchUp(): void {
    this.catchUpUntil = -Infinity;
  }
  mayFetchBacklog(now: number): boolean {
    return now >= this.catchUpUntil;
  }
  /**
   * Whether catching up to log tick `to` would cost more than `limit` steps: the gap in log ticks past the world's
   * tick times the step count its state runs at now. It is an estimate (a gap can cross a phase change), and it keeps
   * the snapshot path at the CPU cost it had when every log tick was one step. A rollback's owed re-run does not
   * count: it is at most the rollback window, and a late entry alone must not turn into a resync.
   */
  behind(to: number, stepsPerTick: number, limit: number): boolean {
    const world = this.world;
    return world !== undefined && (to - world.tick) * stepsPerTick > limit;
  }
}
