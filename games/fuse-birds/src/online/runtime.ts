import {
  RoomRuntime,
  type Callbacks,
  type RuntimeOptions,
  type RoomCommand,
} from "fuse-netcode";
import {
  birdsGame,
  type BirdsEntry,
  type BirdsRoom,
  type BirdsSettings,
  type BirdsView,
} from "./game.js";
import { isAction, type Action, type Fact } from "../engine/index.js";
export type Play =
  | { type: "launch"; weapon: "pebble" | "scatter"; vx: number; vy: number }
  | { type: "pass" };
export interface Session {
  /** Whether this visible page owns an admitted seat (or a running local practice session). */
  readonly admitted: boolean;
  /**
   * Seconds the shared log leaves the current turn, or undefined where there is no turn timer (practice). Read against
   * the log clock that stamps input, so every page shows the same countdown however far its own world lags.
   */
  readonly turnTimeLeft: number | undefined;
  start(): void;
  stop(): void;
  play(play: Play): boolean;
  command(command: RoomCommand<BirdsSettings>): boolean;
}
export class BirdsRuntime
  extends RoomRuntime<BirdsRoom, BirdsEntry, BirdsView, Fact, BirdsSettings>
  implements Session
{
  private ordinal = 0;
  constructor(
    code: string,
    settings: BirdsSettings,
    callbacks: Callbacks<BirdsView, Fact, BirdsSettings>,
    options: RuntimeOptions = {},
  ) {
    super(birdsGame, code, settings, callbacks, options);
  }
  /** A recovered frame can still carry the previous page's connected seat until PRESENCE admits this generation. */
  get admitted(): boolean {
    const seat = this.player();
    return (
      !this.deps.hidden() &&
      !!seat?.connected &&
      !seat.away &&
      !seat.watcher &&
      seat.generation === this.generation
    );
  }
  /**
   * Ticks of the turn left when this page's next entry lands: the log tick it is stamped with (the shared clock, or
   * past it) against the deadline in the match's own ticks. A page's world can lag that clock by seconds under load, so
   * its world's `deadline - tick` overstates the time left; an action stamped at or past the deadline is folded after
   * the turn has already timed out and is dropped. 0 when the shared log has no aiming turn this page can see.
   */
  private turnTicksLeft(): number {
    const world = this.world,
      room = world?.state,
      match = room?.match;
    if (!world || !room || !match || match.phase !== "aiming") return 0;
    const stamp = Math.max(
      Math.floor(this.clock.tick()) + 1,
      world.tick + 1,
      this.recorder.tick,
    );
    return Math.max(0, match.deadline - (stamp - room.startedAt));
  }
  get turnTimeLeft(): number {
    return this.turnTicksLeft() / 20;
  }
  play(play: Play): boolean {
    const room = this.world?.state,
      match = room?.match,
      player = match?.players[match.active];
    if (
      !room ||
      !match ||
      !player ||
      !this.admitted ||
      match.phase !== "aiming" ||
      player.id !== this.id ||
      this.turnTicksLeft() <= 0
    )
      return false;
    const ordinal = Math.max(this.ordinal, player.ordinal) + 1;
    const action: Action = {
      ...play,
      actor: this.id,
      round: match.round,
      turn: match.turn,
      ordinal,
    };
    if (!isAction(action)) return false;
    this.ordinal = ordinal;
    this.append(0, room.matchId, action);
    this.sendPackets(this.deps.now());
    return true;
  }
  get self(): string {
    return this.id;
  }
}
