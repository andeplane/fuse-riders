import {
  createMatch,
  createRound,
  nextRoundConfig,
  recordRoundResult,
  step,
  TICK_HZ,
  view,
  type MatchState,
  type RoundState,
  type RoundView,
  type TickEvent,
  type Tuning,
} from "../engine/index.js";
import type { Bot } from "./bot.js";

/** Human presses per slot, e.g. the `InputHub`. */
export interface PressSource {
  poll?(): void;
  takePresses(slotCount: number): boolean[];
}

export interface RoundRunnerOptions {
  seed: number;
  /** One entry per player: its bot, or null for a human whose presses come from `input`. */
  controllers: readonly (Bot | null)[];
  input?: PressSource;
  /** Round wins needed to take the match (default 3). */
  winsToWin?: number;
  /**
   * Seconds the aftermath of a finished round plays before the next round starts (default 4). `Infinity` holds
   * the finished round until `nextRound()` is called, for a match flow with its own results screen.
   */
  aftermath?: number;
  tuning?: Partial<Tuning>;
}

const STEP_MS = 1000 / TICK_HZ;
/** After a stall (background tab, debugger) drop time instead of fast-forwarding through it. */
const MAX_STEPS_PER_FRAME = 6;
/** Sim speed once only bots are left standing, and how fast (×/s of real time) the speed ramps up and back down. */
export const FAST_FORWARD = { speed: 2, rampUp: 0.8, rampDown: 4 } as const;
/**
 * Humans count as still playing for this long after their last castle fell or their ghost's button was last
 * pressed; after that a bots-only round fast-forwards.
 */
export const GHOST_HOLD_SECONDS = 5;

/**
 * The app's game loop: advances the engine at a fixed 60 Hz from real frame times, asks bots and the input hub
 * for presses every step, records each finished round in `match` as soon as it ends, and starts the next round
 * (then a new match) once the aftermath has played. It implements the render layer's `RoundSource`.
 */
export class RoundRunner {
  match: MatchState;
  private state: RoundState;
  private carry = 0;
  private ticksOver = 0;
  private readonly aftermathTicks: number;
  private readonly humans: number[];
  /** Last tick a human castle stood or a human ghost pressed. */
  private humanTick = 0;
  private simSpeed = 1;

  constructor(private readonly options: RoundRunnerOptions) {
    this.aftermathTicks = Math.round((options.aftermath ?? 4) * TICK_HZ);
    this.humans = options.controllers.flatMap((bot, id) => (bot ? [] : [id]));
    this.match = this.newMatch(options.seed);
    this.state = createRound(nextRoundConfig(this.match));
  }

  /** The current round; a new object once the next round starts. */
  get view(): RoundView {
    return view(this.state);
  }

  /** Current sim speed: 1, or up to `FAST_FORWARD.speed` while bots finish a round without the humans. */
  get speed(): number {
    return this.simSpeed;
  }

  /**
   * True when at least one human plays, every human castle is destroyed, the round is still on and no human ghost
   * pressed within `GHOST_HOLD_SECONDS`: nobody is waiting on anything but the bots.
   */
  get botsOnly(): boolean {
    const round = this.state;
    return (
      this.humans.length > 0 &&
      !round.result &&
      round.tick - this.humanTick > GHOST_HOLD_SECONDS * TICK_HZ
    );
  }

  /**
   * Runs every whole step that `deltaMs` of real time covers and returns all their events, in order. The events
   * all belong to the round that `view` shows after the call: a frame that reaches the end of a round's aftermath
   * stops there, and the next round starts on the following frame. A negative or non-finite `deltaMs` (a bad
   * timestamp, e.g. after the device slept) counts as no time.
   */
  advance(deltaMs: number): TickEvent[] {
    this.options.input?.poll?.();
    const delta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    const ramp =
      (delta / 1000) *
      (this.botsOnly ? FAST_FORWARD.rampUp : -FAST_FORWARD.rampDown);
    this.simSpeed = Math.min(
      FAST_FORWARD.speed,
      Math.max(1, this.simSpeed + ramp),
    );
    const cap = MAX_STEPS_PER_FRAME * STEP_MS * this.simSpeed;
    this.carry = Math.min(this.carry + delta * this.simSpeed, cap);
    const events: TickEvent[] = [];
    let stepped = false;
    while (this.carry >= STEP_MS) {
      if (this.state.result && this.ticksOver >= this.aftermathTicks) {
        if (stepped) break;
        this.nextRound();
      }
      this.carry -= STEP_MS;
      stepped = true;
      for (const event of this.tick()) events.push(event);
    }
    return events;
  }

  private tick(): readonly TickEvent[] {
    if (this.state.result) this.ticksOver++;
    const { controllers, input } = this.options;
    const humans = input?.takePresses(controllers.length) ?? [];
    const round = view(this.state);
    const pressed = controllers.map((bot, id) =>
      bot ? bot(round, id) : humans[id] === true,
    );
    const humanActive = this.humans.some(
      (id) => this.state.castles[id]?.alive || pressed[id],
    );
    if (humanActive) this.humanTick = this.state.tick;
    const events = step(this.state, pressed);
    for (const event of events)
      if (event.type === "round-over")
        recordRoundResult(this.match, event.result);
    return events;
  }

  /** Starts the next round of the match, or of a new match once this one has a winner. */
  nextRound(): void {
    if (this.match.winner !== null)
      this.match = this.newMatch(this.match.config.seed + 1);
    this.state = createRound(nextRoundConfig(this.match));
    this.ticksOver = 0;
    this.humanTick = 0;
    this.simSpeed = 1;
  }

  private newMatch(seed: number): MatchState {
    const { controllers, tuning, winsToWin } = this.options;
    const playerCount = controllers.length;
    return createMatch({ seed, playerCount, tuning, winsToWin });
  }
}
