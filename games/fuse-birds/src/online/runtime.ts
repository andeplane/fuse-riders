import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
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
export class BirdsRuntime extends RoomRuntime<
  BirdsRoom,
  BirdsEntry,
  BirdsView,
  Fact,
  BirdsSettings
> {
  private ordinal = 0;
  constructor(
    code: string,
    settings: BirdsSettings,
    callbacks: Callbacks<BirdsView, Fact, BirdsSettings>,
    options: RuntimeOptions = {},
  ) {
    super(birdsGame, code, settings, callbacks, options);
  }
  play(play: Play): boolean {
    const room = this.world?.state,
      match = room?.match,
      player = match?.players[match.active];
    if (
      !room ||
      !match ||
      match.phase !== "aiming" ||
      player?.id !== this.id ||
      !this.player()?.connected
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
