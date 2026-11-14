import {
  QUEEN_EGGS,
  TICK_HZ,
  type RoundView,
  type Lesson as EngineLesson,
  type UnitKind,
} from "../engine/index.js";
import type { BotLevel, Settings } from "../online/index.js";
import { DEVICE_KEYS, HOVER_TAPS, type Device } from "./guide.js";

/**
 * The solo tutorial: short lessons played in an ordinary solo
 * room against easy bots, each a list of steps that advance on what the round shows (a berry picked up, a hole filled,
 * a transformation, height gained, an attack, a kill, a gate claimed, the snail mounted or ridden home). The text names
 * the keys of the device in use. A lesson whose game is decided before its last step restarts; a finished one records
 * its time, and the best time is kept on this device.
 */
/** The engine sets each lesson's starting position (`lesson` room setting); the page teaches the same four. */
export type LessonId = EngineLesson;

/** What the steps look at, read off the round each frame. */
export interface Facts {
  kind: UnitKind;
  carrying: boolean;
  grounded: boolean;
  riding: boolean;
  diving: boolean;
  dead: boolean;
  /** Feet height in art pixels: smaller is higher. */
  y: number;
  /** Holes of this player's hive filled, and gates this team owns. */
  holes: number;
  gates: number;
  /** Lives the enemy Queen has left. */
  enemyEggs: number;
  /** This player's kills, from the room's stats, and the jump / flap and attack presses this page sent in play. */
  kills: number;
  presses: number;
  attacks: number;
  winner: { team: number; kind: string } | null;
}

/** The player's unit in `world`, read as facts; undefined when the slot has no unit. */
export function factsOf(
  world: Pick<RoundView, "units" | "berries" | "gates" | "eggs" | "winner">,
  slot: number,
  counts: { kills: number; presses: number; attacks: number },
): Facts | undefined {
  const unit = world.units[slot];
  if (!unit) return undefined;
  const team = unit.team,
    enemy = team === 0 ? 1 : 0;
  return {
    kind: unit.kind,
    carrying: unit.carrying,
    grounded: unit.grounded,
    riding: unit.riding,
    diving: unit.diving,
    dead: unit.dead,
    y: unit.y,
    holes: world.berries[team] ?? 0,
    gates: world.gates.filter((gate) => gate.owner === team).length,
    enemyEggs: world.eggs[enemy] ?? QUEEN_EGGS,
    ...counts,
    winner: world.winner,
  };
}

type Keys = (typeof DEVICE_KEYS)[Device] & { left: string };
/** The device's keys, with the way to Cyan's goal (left) for the snail lesson. */
const LEFT: Record<Device, string> = {
  keys: "← / A",
  pad: "the stick left",
  touch: "the pad left",
};
export interface Step {
  text: (keys: Keys) => string;
  /** Done, given the facts now and when the step began. */
  done: (now: Facts, start: Facts) => boolean;
}
export interface Lesson {
  id: LessonId;
  title: string;
  /** The seat played: 0 is the Cyan Queen, 2 a Cyan Worker. */
  slot: number;
  steps: readonly Step[];
}

/** Art pixels a Warrior must climb for the flying step: about one platform level. */
export const CLIMB = 40;
const team = (slot: number): number => slot % 2;

export const LESSONS: readonly Lesson[] = [
  {
    id: "berries",
    title: "BERRIES",
    slot: 2,
    steps: [
      {
        text: (k) => `Press ${k.button} to jump. Hold it for a higher jump.`,
        // A press that left the ground: a unit can be airborne without one (falling from its spawn ledge).
        done: (now, start) =>
          now.presses > start.presses && !now.grounded && !now.riding,
      },
      {
        text: () => "Walk into a berry pile to pick up a berry.",
        done: (now) => now.carrying,
      },
      {
        text: () =>
          "Take it home: touch an open hole of your hive and stay inside for 1.5 s.",
        done: (now, start) => now.holes > start.holes,
      },
    ],
  },
  {
    id: "warrior",
    title: "WARRIOR",
    slot: 2,
    steps: [
      {
        text: () => "Pick up the berry beside you.",
        done: (now) => now.carrying,
      },
      {
        text: () =>
          "Carry it into a warrior gate of your colour or a neutral one and stand completely still.",
        done: (now) => now.kind === "warrior",
      },
      {
        text: (k) =>
          `Tap ${k.button} about ${HOVER_TAPS} times a second to fly up.`,
        // Measured from where the Warrior stood when this step began, never from before the gate.
        done: (now, start) =>
          start.kind === "warrior" &&
          now.kind === "warrior" &&
          start.y - now.y >= CLIMB,
      },
      {
        text: (k) =>
          `Press ${k.attack} to attack: a sword dash the way you face.`,
        done: (now, start) => now.attacks > start.attacks,
      },
      {
        text: (k) =>
          `Face an enemy Worker and press ${k.attack}: the blade kills what is in front of it.`,
        done: (now, start) => now.kills > start.kills,
      },
    ],
  },
  {
    id: "snail",
    title: "SNAIL",
    slot: 2,
    steps: [
      {
        text: () => "Walk onto the snail and stand on it to climb on.",
        done: (now) => now.riding,
      },
      {
        text: (k) =>
          `Hold ${k.left} (toward your goal) and the snail crawls home. ${k.button} hops off.`,
        done: (now) =>
          now.winner?.team === team(2) && now.winner.kind === "snail",
      },
    ],
  },
  {
    id: "queen",
    title: "QUEEN",
    slot: 0,
    steps: [
      {
        text: () => "Fly into a gate to claim it for your team.",
        done: (now, start) => now.gates > start.gates,
      },
      {
        text: (k) =>
          `Tap ${k.button} repeatedly to fly up, then hold ${k.down} to dive.`,
        done: (now) => now.diving,
      },
      {
        text: (k) =>
          `Press ${k.attack} to attack: a sword dash the way you face.`,
        done: (now, start) => now.attacks > start.attacks,
      },
      {
        text: (k) =>
          `Kill the enemy Queen: dive onto her, or face her and press ${k.attack}.`,
        done: (now, start) => now.enemyEggs < start.enemyEggs,
      },
    ],
  },
];

export const lessonById = (id: string | null): Lesson | undefined =>
  LESSONS.find((lesson) => lesson.id === id);

/** Where a player is in a lesson: the step, the facts it began with, and how it ended. */
export interface Progress {
  step: number;
  start: Facts | undefined;
  outcome: "playing" | "won" | "lost";
}
export const FRESH: Progress = {
  step: 0,
  start: undefined,
  outcome: "playing",
};

/**
 * One frame of a lesson: every step whose goal the facts meet is done (several can finish on one frame), the next
 * starts from the same facts; the last step done wins the lesson, a decided game before it loses it.
 */
export function advance(
  lesson: Lesson,
  progress: Progress,
  facts: Facts,
): Progress {
  if (progress.outcome !== "playing") return progress;
  // Steps that finish together on one frame are all judged from where the first began, so an attack and the kill it
  // made, both seen on the same frame, count for both steps; the next step then starts from this frame.
  const from = progress.start ?? facts;
  let { step } = progress;
  while (step < lesson.steps.length && lesson.steps[step]!.done(facts, from))
    step += 1;
  const start = step === progress.step ? from : facts;
  if (step >= lesson.steps.length) return { step, start, outcome: "won" };
  if (facts.winner) return { step, start, outcome: "lost" };
  return { step, start, outcome: "playing" };
}

/** The line shown for the current step, in the keys of `device`. */
export function stepText(
  lesson: Lesson,
  progress: Progress,
  device: Device,
): string {
  const head = `${lesson.title} ${Math.min(progress.step + 1, lesson.steps.length)}/${lesson.steps.length}`;
  if (progress.outcome === "won") return `${lesson.title}: DONE`;
  if (progress.outcome === "lost")
    return `${lesson.title}: the game ended first. Again!`;
  return `${head} · ${lesson.steps[progress.step]!.text({ ...DEVICE_KEYS[device], left: LEFT[device] })}`;
}

/** Seconds of play a round has run, from its step count. */
export const playSeconds = (step: number): number =>
  Math.round((step / TICK_HZ) * 10) / 10;

/** The room the lesson needs, and what the page should ask for next to get there or to play again. */
export const TUTORIAL_BOTS: BotLevel = "easy";
/**
 * The lesson's room: easy, passive bots (they hold no controls, so nobody attacks the learner), map 1, one game, the
 * engine's starting position for the lesson, and the one-second countdown.
 */
export const tutorialSettings = (
  settings: Settings,
  lesson: Lesson,
): Settings => ({
  ...settings,
  botLevel: TUTORIAL_BOTS,
  map: 1,
  wins: 1,
  display: false,
  passive: true,
  lesson: lesson.id,
  quick: true,
});
export type SetupAction =
  "none" | "lobby" | "seat" | "settings" | "start" | "rematch";
export function setupAction(
  room: {
    stage: "lobby" | "running" | "between" | "over";
    /** This device's seat, or -1. */
    slot: number;
    settings: Settings;
  },
  lesson: Lesson,
  outcome: Progress["outcome"],
): SetupAction {
  const wanted = tutorialSettings(room.settings, lesson),
    right =
      room.settings.botLevel === wanted.botLevel &&
      room.settings.map === wanted.map &&
      room.settings.wins === wanted.wins &&
      room.settings.passive &&
      room.settings.lesson === lesson.id &&
      room.settings.quick;
  if (room.stage === "lobby") {
    if (room.slot !== lesson.slot) return "seat";
    return right ? "start" : "settings";
  }
  if (room.slot !== lesson.slot || !right) return "lobby";
  if (room.stage === "over") return outcome === "won" ? "none" : "rematch";
  return "none";
}

/** The best time of each lesson, kept on this device. */
export interface TimeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const bestKey = (id: LessonId): string => `killer-fuse-tutorial-${id}`;
export function bestTime(store: TimeStore, id: LessonId): number | undefined {
  const value = Number(store.getItem(bestKey(id)));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
/** Records a finished lesson's time; returns the best, this one included. */
export function recordTime(
  store: TimeStore,
  id: LessonId,
  seconds: number,
): number {
  const best = bestTime(store, id);
  if (best !== undefined && best <= seconds) return best;
  store.setItem(bestKey(id), String(seconds));
  return seconds;
}
