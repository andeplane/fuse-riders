import type { AimPoint, BombActionCommand } from "./primitives.js";

/**
 * The one bomb-input core. A rider's bomb button is a sequence of gestures: each press opens a gesture with an id
 * larger than any before it, and a release or a cancel closes the gesture it names. These four functions are the only
 * place that sequence becomes the ordered `press` / `release` / `cancel` commands `step` reads.
 *
 * `foldPlayerEntries` calls them with the ids the log carries; that is what every replica agrees on. `BombInputBuffer`
 * calls them with ids it numbers itself, for a caller that has a device's frames and no log. Ids are what make the
 * commands safe to derive from a stream that can repeat or reorder: a press that is not newer than the newest one seen
 * is a repeat, and a release or cancel that does not name the held gesture is stale. Both are no-ops. Gesture ids
 * start at 1 (`isEntry` refuses 0), so 0 can mean "none held".
 */
export interface GestureControls {
  /** Where the rider last aimed while this gesture ran. A press and a release carry a copy; closing a gesture clears it. */
  aim?: AimPoint;
  /** The gesture being held, 0 for none. */
  activeGesture: number;
  /** The newest gesture ever pressed; never decreases. */
  latestGesture: number;
}

const command = (
  controls: GestureControls,
  action: "press" | "release",
): BombActionCommand => ({
  action,
  ...(controls.aim ? { aim: { ...controls.aim } } : {}),
});

export function aimGesture(controls: GestureControls, aim: AimPoint): void {
  controls.aim = aim;
}

/** A press over a held gesture abandons that one first: `cancel`, then `press`. */
export function pressGesture(
  controls: GestureControls,
  gesture: number,
  commands: BombActionCommand[],
): void {
  if (gesture <= controls.latestGesture) return;
  if (controls.activeGesture) commands.push({ action: "cancel" });
  controls.activeGesture = controls.latestGesture = gesture;
  commands.push(command(controls, "press"));
}

/** `aim`, when the release carries one, is where the launch goes, whatever was aimed before. */
export function releaseGesture(
  controls: GestureControls,
  gesture: number,
  aim: AimPoint | undefined,
  commands: BombActionCommand[],
): void {
  if (gesture !== controls.activeGesture) return;
  if (aim) controls.aim = aim;
  controls.activeGesture = 0;
  commands.push(command(controls, "release"));
  controls.aim = undefined;
}

export function cancelGesture(
  controls: GestureControls,
  gesture: number,
  commands: BombActionCommand[],
): void {
  if (gesture !== controls.activeGesture) return;
  controls.activeGesture = 0;
  commands.push({ action: "cancel" });
  controls.aim = undefined;
}
