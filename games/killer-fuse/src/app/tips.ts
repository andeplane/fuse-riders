import type { ControlHint } from "fuse-ui";
import { QUEEN_EGGS } from "../engine/index.js";
import { DEVICE_CONTROLS, DEVICE_NAMES, type Device } from "./guide.js";

/**
 * The tips the lobby turns through while people wait, after the original's loading tips: the first is the controls of
 * the device this player last used, the rest one rule each.
 */
export interface Tip {
  title: string;
  /** A controls diagram: keys and what they do. */
  hints: readonly ControlHint[];
  text: string;
}
export const TIP_MS = 15_000;

export const RULE_TIPS: readonly Tip[] = [
  {
    title: "QUEEN: CLAIM THE GATES",
    hints: [],
    text: "A Queen claims a gate by touching it. Only her team can use it until the other Queen touches it.",
  },
  {
    title: "JUMP HIGHER",
    hints: [],
    text: "Hold the button to jump higher as a Worker; let go early for a short hop.",
  },
  {
    title: "ONLY THE QUEEN DIVES",
    hints: [],
    text: "Hold down in the air to dive straight down at once; she can attack-dash out of it. Warriors cannot dive.",
  },
  {
    title: "GATES TAKE A BERRY",
    hints: [],
    text: "Hold a berry and stand completely still in a gate of your colour or a neutral one: after 0.5 s you are locked in, safe, for 2 s. A warrior gate makes a Warrior, a speed gate makes you fast.",
  },
  {
    title: "THE SWORD",
    hints: [],
    text: "Warriors and the Queen kill with the sword: attack dashes forward. Two blades meeting knock both back; landing on a head only bounces.",
  },
  {
    title: "THE SNAIL EATS WORKERS",
    hints: [],
    text: "A ridden snail eats an enemy Worker in front of it, 5 s (3.5 s with a speed rider). Kill or knock off the rider to free your Worker.",
  },
  {
    title: "THREE WAYS TO WIN",
    hints: [],
    text: `Kill the enemy Queen ${QUEEN_EGGS} times, fill your hive with berries, or ride the snail into your goal.`,
  },
];

export function lobbyTips(device: Device): readonly Tip[] {
  return [
    {
      title: `CONTROLS · ${DEVICE_NAMES[device]}`,
      hints: DEVICE_CONTROLS[device],
      text: "",
    },
    ...RULE_TIPS,
  ];
}

/** Which tip shows `elapsed` milliseconds after the lobby opened: a new one every TIP_MS, round and round. */
export const tipIndex = (elapsed: number, count: number): number =>
  count <= 0 ? 0 : Math.floor(Math.max(0, elapsed) / TIP_MS) % count;
