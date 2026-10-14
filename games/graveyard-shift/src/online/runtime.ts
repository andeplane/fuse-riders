import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { isInput, type Settings } from "../engine/world.js";
import {
  PLAY,
  READY,
  CANCEL,
  graveyardGame,
  type Room,
  type Entry,
  type View,
} from "./game.js";
export class GraveyardRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = "";
  constructor(
    code: string,
    settings: Settings,
    callbacks: Callbacks<View, never, Settings>,
    options: RuntimeOptions = {},
  ) {
    super(graveyardGame, code, settings, callbacks, options);
  }
  input(bits: number): void {
    this.bits = isInput(bits) ? bits : 0;
    this.flush();
  }
  flush(): void {
    const r = this.world?.state;
    if (
      !r ||
      r.stage !== "running" ||
      !this.player()?.connected ||
      !r.world?.hunters.some((h) => h.id === this.id)
    )
      return;
    const key = `${r.matchId}:${this.player()?.generation}:${this.bits}`;
    if (key === this.sent) return;
    this.sent = key;
    this.append(PLAY, r.matchId, r.round, this.bits);
    this.sendPackets(this.deps.now());
  }
  readyUp(): void {
    const r = this.world?.state;
    if (!r || r.stage === "running" || !this.player()?.connected) return;
    this.append(READY, r.matchId, !r.ready[this.id]);
    this.sendPackets(this.deps.now());
  }
  cancel(): void {
    this.bits = 0;
    this.sent = "";
    const r = this.world?.state;
    if (r?.stage === "running" && this.player()?.connected) {
      this.append(CANCEL, r.matchId, r.round);
      this.sendPackets(this.deps.now());
    }
  }
  roomState(): Room | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
  protected resetControls(): void {
    this.sent = "";
  }
  protected releaseControls(): void {
    this.cancel();
  }
  protected absentControls(): void {
    this.bits = 0;
    this.sent = "";
  }
}
