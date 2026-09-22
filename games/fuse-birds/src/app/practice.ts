import type { Callbacks } from "fuse-netcode";
import {
  advance,
  createMatch,
  getView,
  isAction,
  type Action,
  type Fact,
} from "../engine/index.js";
import {
  DEFAULT_SETTINGS,
  type BirdsSettings,
  type BirdsView,
} from "../online/game.js";
import type { BirdsRuntime, Play } from "../online/runtime.js";

interface Options {
  name: string;
  seed: number;
  active?: () => boolean;
  schedule?: (tick: () => void) => () => void;
}

/** Local caller of the same library used online; no room, transport or dummy opponents. */
export class PracticeRuntime {
  private match;
  private pending: Action[] = [];
  private cancelTimer: (() => void) | undefined;
  constructor(
    private callbacks: Callbacks<BirdsView, Fact, BirdsSettings>,
    private options: Options,
  ) {
    this.match = createMatch("practice", options.seed, [
      { id: "solo", name: options.name },
    ]);
  }
  start(): void {
    if (this.cancelTimer) return;
    this.callbacks.ready?.("solo", true);
    this.callbacks.status?.("Solo practice · no timer");
    this.publish();
    const schedule =
      this.options.schedule ??
      ((tick: () => void) => {
        const timer = setInterval(tick, 50);
        return () => clearInterval(timer);
      });
    this.cancelTimer = schedule(() => {
      if (!this.cancelTimer) return;
      if (this.options.active && !this.options.active()) return;
      const facts = advance(this.match, this.pending);
      this.pending = [];
      for (const fact of facts)
        this.callbacks.event?.(
          fact,
          this.match.id,
          this.match.round,
          this.match.step,
        );
      this.publish();
    });
  }
  stop(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.pending = [];
  }
  play(play: Play): boolean {
    if (
      !this.cancelTimer ||
      this.pending.length ||
      this.match.phase !== "aiming"
    )
      return false;
    const player = this.match.players[0]!;
    const action = {
      ...play,
      actor: player.id,
      round: this.match.round,
      turn: this.match.turn,
      ordinal: player.ordinal + 1,
    };
    if (!isAction(action)) return false;
    if (
      action.type === "launch" &&
      action.weapon === "scatter" &&
      player.ammo === 0
    )
      return false;
    this.pending = [action];
    return true;
  }
  command(command: Parameters<BirdsRuntime["command"]>[0]): boolean {
    if (
      !this.cancelTimer ||
      command.type !== "action" ||
      command.action !== "rematch"
    )
      return false;
    this.match = createMatch(
      "practice",
      (this.match.seed + 1) >>> 0,
      [{ id: "solo", name: this.options.name }],
      (this.match.round % 1_000_000) + 1,
    );
    this.pending = [];
    this.publish();
    return true;
  }
  private publish(): void {
    const world = getView(this.match),
      player = this.match.players[0]!;
    this.callbacks.state?.(
      {
        tick: world.tick,
        logTick: this.match.tick,
        matchId: this.match.id,
        managerId: player.id,
        stage: "running",
        world,
        seats: [
          {
            id: player.id,
            name: player.name,
            slot: player.slot,
            avatarId: "owl",
            connected: true,
            bot: false,
          },
        ],
      },
      DEFAULT_SETTINGS,
    );
  }
}
