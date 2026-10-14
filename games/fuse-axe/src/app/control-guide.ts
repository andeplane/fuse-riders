import { KEY_HELP } from "./controls.js";
import type { View } from "../online/game.js";

export const AXE_CONTROLS = [
  ...KEY_HELP.map(([keys, action]) => ({ keys, action })),
  { keys: "PAD · STICK / D-PAD", action: "Walk; double-tap sideways to run" },
  { keys: "PAD · A / B / X or Y", action: "Attack / jump / magic" },
];
export const AXE_TOUCH_CONTROLS = [
  { keys: "LEFT PAD", action: "Slide to walk; double-tap sideways to run" },
  { keys: "ATTACK / JUMP / MAGIC", action: "Use the three right-hand buttons" },
];
export const AXE_GOAL =
  "Fight east together. Clear each stage and defeat Vorhal.";

/** Each stage and camp starts its own world step clock; this never delays play. */
export function showAxeRoundControls(view: View): boolean {
  return (
    !!view.world &&
    (view.stage === "running" ||
      (view.stage === "between" && view.world.camp)) &&
    view.world.step < 300
  );
}
