import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import type { Command } from "../engine/index.js";
import {
  ATTACK,
  ATTACK_MOVE,
  BUY,
  CAST,
  MOVE,
  SELL,
  STEER,
  USE_ITEM,
  command,
  frontGame,
  type Entry,
  type FrontEvent,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type FrontCallbacks = Callbacks<View, FrontEvent, Settings>;

/**
 * The Fuse Front room: the netcode's runtime plus this device's controls. Every control is a discrete command (move
 * the hero, attack, cast) logged for the match this device sees, so there is no
 * held state to re-log after a resync. A control is refused unless the fold would take it: the match runs and this
 * device rides a seat in play, present and in the foreground. `true` means it was logged, not that it landed: the
 * screen always shows what the world did.
 */
/** A control's trailing queued flag (`game.ts`): `1` to queue the order, nothing to replace the current one. */
const flag = (queued: boolean): number[] => (queued ? [1] : []);

export class FrontRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  FrontEvent,
  Settings
> {
  /** The orders this device has logged that the room may not have folded yet, with the log tick each was stamped. */
  private logged: { tick: number; matchId: string; command: Command }[] = [];
  constructor(
    code: string,
    settings: Settings,
    callbacks: FrontCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(frontGame, code, settings, callbacks, options);
  }
  /** The slot this device rides in the running match, or -1. */
  slot(): number {
    const room = this.world?.state,
      seat = this.player();
    if (
      room?.stage !== "running" ||
      !seat?.connected ||
      seat.away ||
      !room.world?.players.some((p) => p.seat === seat.slot)
    )
      return -1;
    return seat.slot;
  }
  /** Logs `[kind, matchId, ...args]` for this device's slot; false when it rides none or the page is hidden. */
  control(kind: number, ...args: number[]): boolean {
    if (this.slot() < 0 || this.hiddenState) return false;
    this.record(kind, args);
    this.sendPackets(this.deps.now());
    return true;
  }
  private record(kind: number, args: number[]): void {
    const matchId = this.world!.state.matchId,
      tick = this.append(kind, matchId, ...args);
    this.logged.push({
      tick,
      matchId,
      command: command([0, tick, kind, matchId, ...args], this.slot()),
    });
    // The fold takes no more than a handful a tick; a burst beyond that is not worth predicting.
    if (this.logged.length > 16) this.logged.shift();
  }
  /**
   * This device's orders the newest folded world has not seen: the screen plays them on its forward run, so a click
   * shows before the room folds it. Empty once the fold has caught up.
   */
  pending(): readonly Command[] {
    const room = this.world?.state;
    this.logged = this.logged.filter(
      (each) => room && each.matchId === room.matchId && each.tick > room.tick,
    );
    return this.logged.map((each) => each.command);
  }
  /** Sends the hero to a tile; `queued` puts the order behind its current one (shift-click) instead. */
  move(x: number, y: number, queued = false): boolean {
    return this.control(MOVE, x, y, ...flag(queued));
  }
  /** Holds the hero's stick: whole steps of ±`STEER_MAX`; (0, 0) releases it. */
  steer(dx: number, dy: number): boolean {
    return this.control(STEER, dx, dy);
  }
  /** Casts a slot aimed at a tile; a `unit` spell may name its target (`MARKS` index and id). */
  cast(
    spell: number,
    x: number,
    y: number,
    target?: { of: number; id: number },
    queued = false,
  ): boolean {
    const chosen = target === undefined ? [] : [target.of, target.id];
    return this.control(CAST, spell, x, y, ...chosen, ...flag(queued));
  }
  /** Focuses the hero on an enemy: `MARKS` index and id (a unit's id, a hero's seat, a building's site id). */
  attack(of: number, id: number, queued = false): boolean {
    return this.control(ATTACK, of, id, ...flag(queued));
  }
  /** Sends the hero to a tile, standing to fight whatever comes in range on the way. */
  attackMove(x: number, y: number, queued = false): boolean {
    return this.control(ATTACK_MOVE, x, y, ...flag(queued));
  }
  /** Buys shop item `id` (`ITEMS`) at the hero's fort; the engine refuses one it may not buy. */
  buy(id: number): boolean {
    return this.control(BUY, id);
  }
  /** Sells the item in `slot` (0–5) at the hero's fort. */
  sell(slot: number): boolean {
    return this.control(SELL, slot);
  }
  /** Uses the active of the item in `slot`, aimed at a tile (a BLINK's landing; a SHIELD ignores it). */
  useItem(slot: number, x: number, y: number): boolean {
    return this.control(USE_ITEM, slot, x, y);
  }
  /** The newest simulated room, for reports and tests; the screen renders from frames. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
  /** A hidden page lets go of the stick, so the hero does not walk on unattended. */
  protected releaseControls(): void {
    if (this.slot() >= 0) {
      this.record(STEER, [0, 0]);
      this.sendPackets(this.deps.now());
    }
  }
  /** The log was reset (a resync): what was logged before it is gone. */
  protected resetControls(): void {
    this.logged = [];
  }
}
