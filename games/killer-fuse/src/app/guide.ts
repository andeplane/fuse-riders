import type { ControlHint } from "fuse-ui";
import {
  MAPS,
  QUEEN_EGGS,
  RESPAWN_STEPS,
  TICK_HZ,
  TIME_LIMIT,
} from "../engine/index.js";

/**
 * How to play, in the words every screen uses: the landing page, the lobby, the menu, the How to play panel and the
 * card over the countdown. Every figure the rules decide is read from the engine's tuning, so the guide follows a
 * retune instead of going stale.
 */
const seconds = (steps: number): string =>
  `${Math.round((steps / TICK_HZ) * 10) / 10} s`;
/**
 * Presses a second that hold a flying unit level. The engine's flight is being retuned so that each tap is a short
 * burst of thrust and about three a second hover; once the engine exports that figure (`HOVER_HZ`), read it here.
 */
export const HOVER_TAPS = 3;
/** Holes in each hive (every map has the same comb). */
export const HIVE_HOLES = MAPS[1].holes[0].length;

export const GOAL =
  "Two teams of three: a Queen and two Workers each. Win a game one of three ways. Bots play every empty seat.";
export const WINS: readonly { name: string; how: string }[] = [
  { name: "MILITARY", how: `Kill the enemy Queen ${QUEEN_EGGS} times.` },
  {
    name: "ECONOMIC",
    how: `Fill all ${HIVE_HOLES} holes of your hive with berries.`,
  },
  { name: "SNAIL", how: "A Worker rides the snail into your goal." },
];
/** The three ways to win in one line, for the countdown card. */
export const WIN_LINE = `WIN: kill the enemy Queen ${QUEEN_EGGS}× · fill your hive · ride the snail home`;

/** The five units a seat can be, as the art names their sheets. */
export type UnitArt =
  "worker" | "speed-worker" | "warrior" | "speed-warrior" | "queen";
export interface UnitGuide {
  art: UnitArt;
  name: string;
  can: string;
  cannot: string;
}
export const UNITS: readonly UnitGuide[] = [
  {
    art: "worker",
    name: "Worker",
    can: "Run, jump (hold for higher), carry one berry, bank it, use gates, ride the snail.",
    cannot: "Kill or fly. Dies to an enemy sword or a diving Queen.",
  },
  {
    art: "speed-worker",
    name: "Speed worker",
    can: "All a Worker does, 1.35 times as fast: running, jumping and riding the snail.",
    cannot: "Kill, fly, or use a speed gate again.",
  },
  {
    art: "warrior",
    name: "Warrior",
    can: "Fly by tapping, attack: dash forward with the sword to kill what is in front of the blade, pop loose berries up by touching them.",
    cannot:
      "Carry berries, use gates or ride the snail. Comes back as a plain Worker after dying.",
  },
  {
    art: "speed-warrior",
    name: "Speed warrior",
    can: "A Warrior at 1.35 times the speed: take a speed gate, then a warrior gate (two berries).",
    cannot: "Carry berries, use gates or ride the snail.",
  },
  {
    art: "queen",
    name: "Queen",
    can: "Fly, attack with the sword (it reaches above and to the side), dive (hold down in the air, release to stop; she can attack-dash out of it), claim gates by touching them.",
    cannot: `Carry berries, use gates or ride the snail. She has ${QUEEN_EGGS} lives; losing the last loses the game.`,
  },
];

export interface GuideSection {
  title: string;
  lines: readonly string[];
}
export const RULES: readonly GuideSection[] = [
  {
    title: "COMBAT",
    lines: [
      "Kills come from the sword: press attack as a Warrior or Queen to dash forward with it, or dive onto an enemy as the Queen.",
      "A Warrior hits with the front of the blade; the Queen's sword reaches above her and to the side.",
      "Two blades meeting knock both back. Landing on a head is a harmless bounce.",
      `The dead come back at their spawn after ${seconds(RESPAWN_STEPS)}, briefly invulnerable.`,
    ],
  },
  {
    title: "BERRIES AND HIVE",
    lines: [
      "A Worker picks up a berry by touching a pile and banks it by touching an open hole of its own hive, from the ground or the air: 1.5 s inside, safe, then it pops out.",
      "A carrier that dies drops its berry. A Worker with free hands picks a loose berry up; anyone who can't carry one pops it straight up by touching it.",
      "Berries never regrow: once the piles are empty, only loose berries are left.",
    ],
  },
  {
    title: "GATES",
    lines: [
      "Holding a berry, a Worker stands completely still on the ground in a gate: 0.5 s to commit (moving cancels it), then 2 s locked in and safe. A warrior gate makes a Warrior, a speed gate a speed Worker; the berry is spent.",
      "Only gates of your colour or neutral ones work for you; an enemy-coloured gate does nothing.",
      "Gates start neutral. A Queen claims one by touching it; then only her team can use it until the other Queen touches it.",
    ],
  },
  {
    title: "SNAIL",
    lines: [
      "A Worker who walks into the snail on the floor climbs on, and it crawls toward the rider's own goal. Press the button to hop off.",
      "It catches an enemy Worker in front of its mouth and eats it for 5 s (3.5 s with a speed rider); then that Worker dies. The rider can't hop off while it eats.",
      "Killing or knocking off the rider frees the Worker being eaten. Nothing is banked: the other team can ride it back.",
    ],
  },
  {
    title: "FLYING",
    lines: [
      `Queens and Warriors flap once per tap. About ${HOVER_TAPS} taps a second hold your height; tap faster to climb, slower to sink.`,
      "As the Queen, hold down in the air to dive straight down at once; release to stop. She can attack-dash out of a dive.",
      "The screen wraps: leave on one side, come back on the other.",
    ],
  },
  {
    title: "THE CLOCK AND THE BOTS",
    lines: [
      `A game lasts at most ${Math.round(TIME_LIMIT / TICK_HZ / 60)} minutes; then the team whose Queen has more lives left wins, then the one with more berries banked, then the one the snail is nearer to its goal.`,
      "Bots play every empty seat, at the level the host picks.",
    ],
  },
];

/** Which controls a device is played with. */
export type Device = "keys" | "pad" | "touch";
export const DEVICE_NAMES: Record<Device, string> = {
  keys: "KEYBOARD",
  pad: "GAMEPAD",
  touch: "TOUCH",
};
/**
 * The bindings of `controls.ts` in a few characters, per device: move, the jump / flap button, attack and down. As in
 * the original, nothing is bound to up: flying is only ever the button.
 */
export const DEVICE_KEYS: Record<
  Device,
  { move: string; button: string; attack: string; down: string }
> = {
  keys: { move: "A D / ← →", button: "Space", attack: "J", down: "S / ↓" },
  pad: {
    move: "Stick / D-pad ← →",
    button: "A / Cross",
    attack: "B / Circle",
    down: "Stick / D-pad ↓",
  },
  touch: {
    move: "Left pad",
    button: "Big button",
    attack: "ATTACK",
    down: "Left pad ↓",
  },
};
const FLAP = `Jump / flap: tap about ${HOVER_TAPS} times a second to hold height`;
const DIVE = "Queen dive, hold (release to stop)";
const ATTACK = "Attack as a Warrior or Queen: dash forward with the sword";
export const DEVICE_CONTROLS: Record<Device, readonly ControlHint[]> = {
  keys: [
    { keys: "A / D or ← / →", action: "Move" },
    { keys: "Space", action: FLAP },
    { keys: "J", action: ATTACK },
    { keys: "S or ↓", action: DIVE },
  ],
  pad: [
    { keys: "Left stick or D-pad ← / →", action: "Move" },
    { keys: "A / Cross", action: FLAP },
    { keys: "B / Circle or left bumper", action: ATTACK },
    { keys: "Stick or D-pad ↓", action: DIVE },
  ],
  touch: [
    { keys: "Left pad", action: "Slide left or right to move" },
    { keys: "Big button", action: FLAP },
    { keys: "ATTACK button beside it", action: ATTACK },
    { keys: "Left pad, slide down", action: DIVE },
  ],
};
/** The "Hold to flap" option, in words. */
export const HOLD_TO_FLAP = {
  label: "Hold to flap",
  how: "Off: one flap per tap, as in the original. On: holding the button flaps 7.5 times a second. The switch is beside HOW TO PLAY on the start page and in the lobby.",
} as const;
/** The keyboard and gamepad, as the in-game menu lists them. */
export const CONTROLS: readonly ControlHint[] = [
  ...DEVICE_CONTROLS.keys,
  {
    keys: "Gamepad",
    action:
      "Stick or D-pad ← / → to move, ↓ to dive; A / Cross to jump or flap; B / Circle or left bumper to attack",
  },
];
export const TOUCH_CONTROLS: readonly ControlHint[] = DEVICE_CONTROLS.touch;
