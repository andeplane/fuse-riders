import type { WorldView } from "../engine/view.js";

export const HOOK_CONTROLS = [
  { keys: "A / D · ← / →", action: "Move and steer your swing" },
  { keys: "SPACE", action: "Jump; hold for height" },
  {
    keys: "WASD / ARROWS + J",
    action: "Aim and hold to hook in Keyboard mode",
  },
  {
    keys: "WASD / ARROWS + K",
    action: "Aim and hold to charge a bomb in Keyboard mode; release to throw",
  },
  {
    keys: "MOUSE + LEFT CLICK",
    action: "Aim and hold to hook; release to let go",
  },
  {
    keys: "MOUSE + RIGHT CLICK",
    action: "Hold to charge a bomb; release to throw toward the pointer",
  },
  {
    keys: "S / ↓ + SPACE (or SHIFT)",
    action: "Drop through a ledge; Mouse mode uses S / ↓ alone",
  },
];
export const HOOK_TOUCH_CONTROLS = [
  {
    keys: "MOVE PAD",
    action: "Slide sideways to move, up to jump, down to drop",
  },
  {
    keys: "AIM PAD",
    action: "Drag from center to aim; hold to hook, release to let go",
  },
  {
    keys: "BOMB BUTTON",
    action:
      "Hold to charge, release to throw along your last aim; bombs must be on",
  },
];
export const HOOK_GOAL =
  "Hook ledges to climb and swing. Hook rivals to knock them back. Bombs can knock everyone out, including you.";

/** Free play has no countdown, so its guidance appears during the opening five seconds. */
export function showHookRoundControls(view: WorldView): boolean {
  return view.contest.rules === "free"
    ? view.tick < 300
    : view.contest.phase === "countdown";
}
