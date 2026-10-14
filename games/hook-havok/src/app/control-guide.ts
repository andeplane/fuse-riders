import type { WorldView } from "../engine/view.js";

export const HOOK_CONTROLS = [
  { keys: "A / D · ← / →", action: "Move and steer your swing" },
  { keys: "J / SPACE", action: "Jump; hold for height. J needs Keyboard mode" },
  {
    keys: "WASD / ARROWS + K",
    action: "Aim and hold to hook in Keyboard mode",
  },
  {
    keys: "MOUSE + LEFT CLICK",
    action: "Aim and hold to hook; release to let go",
  },
  {
    keys: "↓ + J / SPACE",
    action: "Drop through a ledge; Mouse mode uses ↓ alone",
  },
];
export const HOOK_TOUCH_CONTROLS = [
  {
    keys: "LEFT PAD",
    action: "Slide sideways to move, up to jump, down to drop",
  },
  {
    keys: "RIGHT PAD",
    action: "Drag from center to aim; hold to hook, release to let go",
  },
];
export const HOOK_GOAL =
  "Hook ledges to climb and swing. Hook rivals to knock them back.";

/** Free play has no countdown, so its guidance appears during the opening five seconds. */
export function showHookRoundControls(view: WorldView): boolean {
  return view.contest.rules === "free"
    ? view.tick < 300
    : view.contest.phase === "countdown";
}
