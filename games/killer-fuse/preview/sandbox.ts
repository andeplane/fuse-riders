/**
 * The arena on its own: the engine at 60 Hz with bots in every seat (or the keyboard in one), drawn by the real
 * renderer. No room, no network. Query: ?seat=0..5|none &level=easy|medium|hard &map=1|2|3 &seed=N &speed=1 &mute
 * &clean (hides the status line). Keys: arrows or A/D to move, down or S to dive or drop, space, Z or up to
 * jump and flap. `window.__game` is the debug hook the check scripts drive.
 */
import {
  createRound,
  NEUTRAL,
  stepRound,
  TICK_HZ,
  viewOf,
  type BotLevel,
  type GameEvent,
  type Input,
  type MapId,
  type Round,
  type RoundView,
} from "../src/engine/index.js";
import { createArenaView } from "../src/render/index.js";

interface Setup {
  seat: number;
  level: BotLevel;
  map: MapId;
  seed: number;
}

interface Stats {
  /** Display frames per second over the last frames measured. */
  fps: number;
  /** Milliseconds between display frames: mean and 95th percentile. */
  frameMs: number;
  frameP95: number;
  /** Milliseconds spent inside one render call: mean and worst. */
  renderMs: number;
  renderMax: number;
  frames: number;
}

interface GameHook {
  readonly setup: Setup;
  view(): RoundView;
  /** The round's state as short text, for a check to assert on. */
  text(): string;
  pause(): void;
  resume(): void;
  paused(): boolean;
  /** Steps the simulation `count` times while paused, drawing the last step. */
  step(count?: number): void;
  /** Steps without showing anything until an event of `type` happens or `limit` steps pass; true when it did. */
  until(type: GameEvent["type"], limit?: number): boolean;
  /** Steps without showing anything. */
  skip(count: number): void;
  setSpeed(speed: number): void;
  restart(setup?: Partial<Setup>): void;
  stats(): Stats;
  resetStats(): void;
  /**
   * Takes the renderer's clock in hand and lets `ms` of it pass, drawing as it goes: effects are then shot at a known
   * age however long a screenshot takes. The first call stops the real clock for good.
   */
  hold(ms: number): void;
  /** Plays the seat by hand instead of the keyboard: the input for every step from now on, or null to hand back. */
  drive(input: Partial<Input> | null): void;
}

declare global {
  interface Window {
    __game?: GameHook;
  }
}

const params = new URLSearchParams(location.search);
const pick = <T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T => allowed.find((entry) => entry === value) ?? fallback;
const whole = (value: string | null, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const seatParam = params.get("seat");
const setup: Setup = {
  seat:
    seatParam === "none" ? -1 : Math.max(-1, Math.min(5, whole(seatParam, 0))),
  level: pick(params.get("level"), ["easy", "medium", "hard"], "medium"),
  map:
    ([1, 2, 3] as const).find((id) => id === whole(params.get("map"), 1)) ?? 1,
  seed: whole(params.get("seed"), 1),
};
let speed = Math.max(0, Number.parseFloat(params.get("speed") ?? "1") || 1);
if (params.has("clean")) document.body.classList.add("clean");
// `tick=3` feeds the renderer as the online page does: one view per three steps, their events merged.
const tick = Math.max(1, whole(params.get("tick"), 1));

const host = document.getElementById("arena");
const status = document.getElementById("status");
if (!host || !status)
  throw new Error("the sandbox page is missing its elements");

// `banner=off` hides the renderer's victory banner, as a page with its own result panel does.
if (params.get("banner") === "off") host.dataset.banner = "off";

const names = (): string[] =>
  Array.from({ length: 6 }, (_, slot) => (slot === setup.seat ? "YOU" : ""));

const arena = createArenaView(host, {
  artUrl: "/killer-fuse/art/",
  localSlot: setup.seat,
  names: names(),
  muted: params.has("mute"),
  highlight: params.has("highlight"),
});

let state: Round;
let previous: RoundView;
let current: RoundView;
let paused = false;
let waiting: GameEvent[] = [];
let stepsWaiting = 0;

function begin(): void {
  state = createRound({
    seed: setup.seed,
    mapId: setup.map,
    botLevel: setup.level,
    humans: Array.from({ length: 6 }, (_, slot) => slot === setup.seat),
  });
  current = viewOf(state);
  previous = current;
  waiting = [];
  stepsWaiting = 0;
  arena.update({ localSlot: setup.seat, names: names() });
  // Step zero tells the renderer a new round began, so nothing of the last one lingers.
  arena.advance(current);
}
begin();

// The keyboard seat.
const down = new Set<string>();
let pressedEdge = false;
const BUTTON = new Set(["Space", "KeyZ", "ArrowUp", "KeyW"]);
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (BUTTON.has(event.code)) pressedEdge = true;
  down.add(event.code);
  if (event.code.startsWith("Arrow") || event.code === "Space")
    event.preventDefault();
});
window.addEventListener("keyup", (event) => down.delete(event.code));
window.addEventListener("blur", () => down.clear());

let driven: Input | null = null;

function readInput(): Input {
  if (driven) {
    const input = driven;
    // A press is an edge: it is given to one step only.
    driven = { ...driven, pressed: false };
    return input;
  }
  // Over NEUTRAL, so a button the engine adds later is simply not pressed here.
  const input: Input = {
    ...NEUTRAL,
    left: down.has("ArrowLeft") || down.has("KeyA"),
    right: down.has("ArrowRight") || down.has("KeyD"),
    down: down.has("ArrowDown") || down.has("KeyS"),
    held: [...BUTTON].some((code) => down.has(code)),
    pressed: pressedEdge,
  };
  pressedEdge = false;
  return input;
}

function simulate(show: boolean): void {
  const inputs = Array.from({ length: 6 }, (_, slot) =>
    slot === setup.seat ? readInput() : NEUTRAL,
  );
  stepRound(state, inputs);
  const view = viewOf(state);
  waiting.push(...view.events);
  stepsWaiting += 1;
  if (stepsWaiting < tick && !view.winner) return;
  previous = current;
  current = { ...view, events: waiting };
  waiting = [];
  stepsWaiting = 0;
  if (show) arena.advance(current);
}

// Frame timing, measured here so the renderer carries no instrumentation.
const SAMPLE = 600;
let frameTimes: number[] = [];
let renderTimes: number[] = [];
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

let last = performance.now();
let owed = 0;
const STEP_MS = 1000 / TICK_HZ;

function frame(now: number): void {
  const elapsed = now - last;
  last = now;
  frameTimes.push(elapsed);
  if (frameTimes.length > SAMPLE) frameTimes.shift();
  if (!paused) {
    owed += Math.min(250, elapsed) * speed;
    let steps = 0;
    while (owed >= STEP_MS && steps < 240) {
      simulate(true);
      owed -= STEP_MS;
      steps += 1;
    }
    if (steps === 240) owed = 0;
  }
  const before = performance.now();
  arena.render(
    previous,
    current,
    paused ? 1 : Math.min(1, (stepsWaiting + owed / STEP_MS) / tick),
  );
  renderTimes.push(performance.now() - before);
  if (renderTimes.length > SAMPLE) renderTimes.shift();
  if (status && Math.floor(now / 500) !== Math.floor((now - elapsed) / 500))
    status.textContent = `seed ${setup.seed} map ${setup.map} ${setup.level} step ${current.step} ${Math.round(1000 / Math.max(1, mean(frameTimes)))} fps`;
  requestAnimationFrame(frame);
}

/** The clock `hold` turns by hand, in the steps of a 60 Hz display. */
const HOLD_FRAME_MS = 1000 / 60;
let heldClock: number | null = null;

const kindLetter = { worker: "w", warrior: "W", queen: "Q" } as const;

window.__game = {
  setup,
  view: () => current,
  text: () =>
    [
      `step ${current.step} map ${current.map.id} eggs ${current.eggs.join("-")} berries ${current.berries.join("-")}`,
      `snail x ${Math.round(current.snail.x)} rider ${current.snail.rider} victim ${current.snail.victim}`,
      `winner ${current.winner ? `${current.winner.team} ${current.winner.kind}` : "none"}`,
      ...current.units.map(
        (unit) =>
          `${unit.slot}${kindLetter[unit.kind]}${unit.speed ? "+" : ""} ${Math.round(unit.x)},${Math.round(unit.y)}${unit.dead ? " dead" : ""}${unit.carrying ? " berry" : ""}${unit.riding ? " riding" : ""}`,
      ),
    ].join("\n"),
  pause: () => {
    paused = true;
  },
  resume: () => {
    paused = false;
    owed = 0;
  },
  paused: () => paused,
  step: (count = 1) => {
    for (let i = 0; i < count; i += 1) simulate(true);
  },
  until: (type, limit = TICK_HZ * 600) => {
    for (let i = 0; i < limit; i += 1) {
      if (state.winner && type !== "victory") return false;
      simulate(false);
      if (current.events.some((event) => event.type === type)) {
        arena.advance(current);
        return true;
      }
      if (state.winner) return false;
    }
    return false;
  },
  skip: (count) => {
    for (let i = 0; i < count; i += 1) simulate(false);
    previous = current;
  },
  setSpeed: (value) => {
    speed = Math.max(0, value);
  },
  restart: (change = {}) => {
    Object.assign(setup, change);
    begin();
  },
  stats: () => {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const frameMs = mean(frameTimes);
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      frameP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      renderMs: mean(renderTimes),
      renderMax: Math.max(0, ...renderTimes),
      frames: frameTimes.length,
    };
  },
  resetStats: () => {
    frameTimes = [];
    renderTimes = [];
  },
  drive: (input) => {
    driven = input ? { ...NEUTRAL, ...input } : null;
  },
  hold: (ms) => {
    if (heldClock === null) {
      heldClock = performance.now();
      performance.now = () => heldClock ?? 0;
    }
    for (let left = ms; left > 0; left -= HOLD_FRAME_MS) {
      heldClock += Math.min(left, HOLD_FRAME_MS);
      arena.render(previous, current, 1);
    }
  },
};

arena.ready.then(
  () => {
    status.dataset.state = "ready";
    status.textContent = "ready";
    last = performance.now();
    requestAnimationFrame(frame);
  },
  (error: unknown) => {
    status.dataset.state = "error";
    status.textContent = error instanceof Error ? error.message : String(error);
  },
);
