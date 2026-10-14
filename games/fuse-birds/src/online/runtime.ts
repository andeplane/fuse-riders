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
      player.id !== this.id
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
