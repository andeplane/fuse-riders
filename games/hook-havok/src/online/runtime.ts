import {
  RoomRuntime,
  type Callbacks,
  type RoomCommand,
  type RuntimeOptions,
} from "fuse-netcode";
import { hookGame, type Room, type Entry, type View } from "./game.js";
import { NEUTRAL, type Input, type Tuning } from "../engine/world.js";
import { parseTuning } from "../engine/codec.js";
import { prewarmNav } from "../engine/bot-nav.js";
export class HookRuntime extends RoomRuntime<Room, Entry, View, never, Tuning> {
  private held: Input = { ...NEUTRAL };
  constructor(
    code: string,
    settings: Tuning,
    callbacks: Callbacks<View, never, Tuning>,
    options: RuntimeOptions,
  ) {
    super(hookGame, code, settings, callbacks, options);
    // The bots' nav graphs, before this peer's first fold or checkpoint
    // decode needs one (bots.md, Navigation).
    prewarmNav(settings);
  }
  command(command: RoomCommand<Tuning>): boolean {
    // New movement tuning: build its graphs before the entry reaches a fold.
    if (command?.type === "settings") {
      const settings = parseTuning(command.settings);
      if (settings) prewarmNav(settings);
    }
    return super.command(command);
  }
  /** Returns the recorded log tick; undefined when no new input was accepted. */
  input(input: Input): number | undefined {
    const r = this.world?.state;
    if (
      !r ||
      r.stage !== "running" ||
      !this.player()?.connected ||
      JSON.stringify(input) === JSON.stringify(this.held)
    )
      return;
    this.held = { ...input };
    const tick = this.append(0, r.matchId, r.round, { ...input });
    this.sendPackets(this.deps.now());
    return tick;
  }
  /**
   * Cancels every button through the same match/round-scoped log as input.
   * Unlike an ordinary release, lifecycle clearing never throws a charge.
   */
  clear(aim: Pick<Input, "aimX" | "aimY"> = this.held): number | undefined {
    return this.input({
      ...NEUTRAL,
      cancelBomb: true,
      aimX: aim.aimX,
      aimY: aim.aimY,
    });
  }
  protected resetControls(): void {
    this.held = { ...NEUTRAL };
  }
  protected releaseControls(): void {
    this.clear();
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
