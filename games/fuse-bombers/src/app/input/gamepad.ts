import { DOWN, FIRE, LEFT, RIGHT, UP } from "../../engine/input.js";
import type { Command, DeviceId, InputSource } from "./hub.js";

/** The part of a `Gamepad` the gamepad source reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
}

/** `navigator.getGamepads` in the browser, a fake in tests. */
export type GetGamepads = () => readonly (GamepadLike | null)[];

/** In the standard mapping buttons 0–3 are the face buttons (A B X Y); an unmapped pad has no known layout. */
const FACE_BUTTONS = 4;
/** Standard mapping: the D-pad's up, down, left and right buttons. */
const DPAD: readonly (readonly [number, number])[] = [
  [12, UP],
  [13, DOWN],
  [14, LEFT],
  [15, RIGHT],
];
/** Standard mapping: 9 is Start (Options, Menu), 8 is Back (Select, View, Share). */
const MENU_BUTTONS: readonly (readonly [number, Command])[] = [
  [9, "start"],
  [8, "back"],
];
/** Milliseconds the fire button must stay down to report `hold`. */
export const HOLD_MS = 1000;
/** How far (0–1) the left stick must lean before it steers, so a worn stick resting off centre does not drift. */
export const STICK_DEAD_ZONE = 0.35;
/** sin(22.5°): an axis counts once the lean is within 67.5° of it, which splits the circle into 8 equal sectors. */
const SECTOR = Math.sin(Math.PI / 8);

/**
 * Direction bits for a lean of (`x`, `y`) (y grows downward, as a stick's axes and the screen do): none inside the
 * `deadZone` radius, else the nearest of 8 directions, so each straight and each diagonal gets a 45° sector.
 * Non-finite axes count as centred.
 */
export function stickBits(x: number, y: number, deadZone: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const lean = Math.hypot(x, y);
  if (lean <= deadZone) return 0;
  const edge = lean * SECTOR;
  return (
    (y < -edge ? UP : 0) |
    (y > edge ? DOWN : 0) |
    (x < -edge ? LEFT : 0) |
    (x > edge ? RIGHT : 0)
  );
}

const isDown = (button: GamepadLike["buttons"][number] | undefined) =>
  button !== undefined && (button.pressed || button.value > 0.5);

/** The bits `pad` holds: any face button fires (any button on an unmapped pad); the left stick or D-pad steers. */
function padBits(pad: GamepadLike): number {
  const standard = pad.mapping === "standard";
  const fire = (
    standard ? pad.buttons.slice(0, FACE_BUTTONS) : pad.buttons
  ).some(isDown);
  let bits = stickBits(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEAD_ZONE);
  if (standard)
    for (const [button, bit] of DPAD)
      if (isDown(pad.buttons[button])) bits |= bit;
  return fire ? bits | FIRE : bits;
}

/** Per pad: when its fire button went down (undefined while up), whether `hold` fired, and its menu buttons down. */
interface PadState {
  since: number | undefined;
  held: boolean;
  menu: Set<number>;
}

/**
 * Gamepad N is the device `pad:N`. The Gamepad API has no button events, so this polls and reports each pad's held
 * bits (`hold`, the hub's `setHeld`) every poll. Hot-plugging needs no events either: a pad is simply present or
 * absent in `getGamepads()`; a pad that goes away releases everything it held, and a pad that comes back at the same
 * index is the same device (so an unplugged player can reconnect).
 *
 * A standard-mapped pad's Start and Back buttons report the `start` and `back` commands (they never fire), and a
 * fire button held down for `HOLD_MS` reports `hold` once. `now` is the clock in milliseconds.
 */
export function attachGamepads(
  getGamepads: GetGamepads,
  hold: (device: DeviceId, bits: number) => void,
  command: (device: DeviceId, command: Command) => void = () => undefined,
  now: () => number = () => performance.now(),
): InputSource {
  const pads = new Map<number, PadState>();
  return {
    poll: () => {
      const present = new Set<number>();
      const time = now();
      for (const pad of getGamepads()) {
        if (!pad?.connected) continue;
        present.add(pad.index);
        const device: DeviceId = `pad:${pad.index}`;
        let state = pads.get(pad.index);
        if (!state) {
          state = { since: undefined, held: false, menu: new Set() };
          pads.set(pad.index, state);
        }
        const bits = padBits(pad);
        hold(device, bits);
        if (!(bits & FIRE)) state.since = undefined;
        else if (state.since === undefined) {
          state.since = time;
          state.held = false;
        } else if (!state.held && time - state.since >= HOLD_MS) {
          state.held = true;
          command(device, "hold");
        }
        if (pad.mapping !== "standard") continue;
        for (const [button, name] of MENU_BUTTONS) {
          const down = isDown(pad.buttons[button]);
          if (down && !state.menu.has(button)) command(device, name);
          if (down) state.menu.add(button);
          else state.menu.delete(button);
        }
      }
      for (const index of pads.keys())
        if (!present.has(index)) {
          pads.delete(index);
          hold(`pad:${index}`, 0);
        }
    },
  };
}
