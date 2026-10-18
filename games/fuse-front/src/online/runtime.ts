import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  STANCES,
  UNIT_KINDS,
  type Stance,
  type UnitKind,
} from "../engine/index.js";
import {
  ATTACK,
  ATTACK_MOVE,
  CAST,
  MOVE,
  ORDER,
  STANCE,
  STEER,
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
 * the hero, set the army's stance, queue a factory order, cast) logged for the match this device sees, so there is no
 * held state to re-log after a resync. A control is refused unless the fold would take it: the match runs and this
 * device rides a seat in play, present and in the foreground. `true` means it was logged, not that it landed: the
 * screen always shows what the world did.
 */
export class FrontRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  FrontEvent,
  Settings
> {
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
    this.append(kind, this.world!.state.matchId, ...args);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** Sends the hero to a tile. */
  move(x: number, y: number): boolean {
    return this.control(MOVE, x, y);
  }
  stance(stance: Stance): boolean {
    return this.control(STANCE, STANCES.indexOf(stance));
  }
  order(factory: number, kind: UnitKind): boolean {
    return this.control(ORDER, factory, UNIT_KINDS.indexOf(kind));
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
  ): boolean {
    return target === undefined
      ? this.control(CAST, spell, x, y)
      : this.control(CAST, spell, x, y, target.of, target.id);
  }
  /** Focuses the hero on an enemy: `MARKS` index and id (a unit's id, a hero's seat, a building's site id). */
  attack(of: number, id: number): boolean {
    return this.control(ATTACK, of, id);
  }
  /** Sends the hero to a tile, standing to fight whatever comes in range on the way. */
  attackMove(x: number, y: number): boolean {
    return this.control(ATTACK_MOVE, x, y);
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
      this.append(STEER, this.world!.state.matchId, 0, 0);
      this.sendPackets(this.deps.now());
    }
  }
}
