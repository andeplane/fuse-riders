import type { ControlHint } from "fuse-ui";
import {
  EAT_STEPS,
  FLAP_IMPULSE,
  FLY_GRAVITY,
  GATE_STEPS,
  MAPS,
  QUEEN_EGGS,
  RESPAWN_STEPS,
  TICK_HZ,
  TIME_LIMIT,
} from "../engine/index.js";
import { frameIndex, frameRect, type ArtManifest } from "../render/manifest.js";

/**
 * How to play, in the words every screen uses: the landing page, the lobby, the menu, the How to play panel and the
 * card over the countdown. Every figure the rules decide is read from the engine's tuning, so the guide follows a
 * retune instead of going stale.
 */
const seconds = (steps: number): string =>
  `${Math.round((steps / TICK_HZ) * 10) / 10} s`;
/** Presses a second that hold a flying unit level: each flap cancels this many steps of gravity. */
export const HOVER_TAPS = Math.round((FLY_GRAVITY * TICK_HZ) / FLAP_IMPULSE);
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
    cannot: "Kill or fly. Dies when an enemy Warrior or Queen touches it.",
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
    can: "Fly by tapping, kill enemy Workers on contact, duel enemy Warriors and Queens, kick loose berries.",
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
    can: "Fly, kill on contact, dive by holding down in the air, claim gates by touching them.",
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
      "There is no attack button: contact decides.",
      "A Warrior or Queen kills any enemy Worker it touches.",
      "When two flyers meet, the higher one wins, a hit from behind wins, and a diving Queen kills what she lands on. Otherwise both bounce apart.",
      `The dead come back at their spawn after ${seconds(RESPAWN_STEPS)}, briefly invulnerable. An invulnerable Worker shoves flyers instead of dying.`,
    ],
  },
  {
    title: "BERRIES AND HIVE",
    lines: [
      "A Worker picks up a berry by touching a pile and banks it by touching an empty hole of its own hive.",
      "A carrier that dies drops its berry. Anyone kicks loose berries, and a berry kicked into an empty hole fills it for that hive.",
      "The piles grow back when they run dry, and on a clock as well.",
    ],
  },
  {
    title: "GATES",
    lines: [
      `A Worker with a berry stands in a gate for ${seconds(GATE_STEPS)}: a warrior gate makes a Warrior, a speed gate a speed Worker. The berry is spent.`,
      "A Worker in a gate can still be killed.",
      "Gates start neutral. A Queen claims one by touching it; then only her team can use it until the other Queen touches it.",
    ],
  },
  {
    title: "SNAIL",
    lines: [
      "A Worker who walks into the snail on the floor climbs on, and it crawls toward the rider's own goal. Press the button to hop off.",
      `It catches an enemy Worker in front of its mouth and stops to eat it for ${seconds(EAT_STEPS)}; then that Worker dies.`,
      "Killing the rider frees the Worker being eaten. Nothing is banked: the other team can ride it back.",
    ],
  },
  {
    title: "FLYING",
    lines: [
      `Queens and Warriors flap once per tap. About ${HOVER_TAPS} taps a second hold your height; tap faster to climb, slower to sink.`,
      "A Queen holding down in the air dives straight down.",
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
/** The bindings of `controls.ts` in a few characters, per device: move, the button, and down. */
export const DEVICE_KEYS: Record<
  Device,
  { move: string; button: string; down: string }
> = {
  keys: { move: "A D / ← →", button: "Space / W / ↑", down: "S / ↓" },
  pad: { move: "Stick / D-pad", button: "A", down: "Stick ↓" },
  touch: { move: "Left pad", button: "Right button", down: "Left pad ↓" },
};
export const DEVICE_CONTROLS: Record<Device, readonly ControlHint[]> = {
  keys: [
    { keys: "A / D or ← / →", action: "Move" },
    {
      keys: "Space, W, ↑ or Z",
      action:
        "Jump as a Worker (hold for higher), flap as a Queen or Warrior, hop off the snail",
    },
    { keys: "S or ↓", action: "Dive as the Queen, in the air" },
  ],
  pad: [
    {
      keys: "Left stick or D-pad",
      action: "Move; push down to dive as the Queen",
    },
    { keys: "A, B, X or Y", action: "Jump or flap; hop off the snail" },
  ],
  touch: [
    { keys: "Left thumb", action: "Slide left or right to move, down to dive" },
    { keys: "Right thumb", action: "Tap the big button to jump or flap" },
  ],
};
/** The keyboard and gamepad, as the in-game menu lists them. */
export const CONTROLS: readonly ControlHint[] = [
  ...DEVICE_CONTROLS.keys,
  { keys: "Gamepad", action: "Stick or D-pad to move, A to jump or flap" },
];
export const TOUCH_CONTROLS: readonly ControlHint[] = DEVICE_CONTROLS.touch;

/** How to draw one unit's idle frame as a CSS background, a whole number of CSS pixels to the art pixel. */
export interface UnitIcon {
  url: string;
  width: number;
  height: number;
  size: string;
  position: string;
}
/** The idle frame of `art` for `team` from the art manifest, at the integer scale nearest `height`; undefined if absent. */
export function unitIcon(
  manifest: ArtManifest,
  artUrl: string,
  art: UnitArt,
  team: number,
  height: number,
): UnitIcon | undefined {
  const sheet = manifest.assets[`${art}-${team === 1 ? "pink" : "cyan"}`];
  if (!sheet) return undefined;
  const scale = Math.max(1, Math.round(height / sheet.frameHeight)),
    frame = frameRect(sheet, frameIndex(sheet, "idle"));
  return {
    url: `${artUrl}${sheet.file}`,
    width: frame.sw * scale,
    height: frame.sh * scale,
    size: `${sheet.width * scale}px ${sheet.height * scale}px`,
    position: `${-frame.sx * scale}px ${-frame.sy * scale}px`,
  };
}
