import type { Command, DeviceId, InputSource } from "./hub.js";

/** The part of a `Gamepad` the gamepad source reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
}

/** `navigator.getGamepads` in the browser, a fake in tests. */
export type GetGamepads = () => readonly (GamepadLike | null)[];

/** In the standard mapping buttons 0–3 are the face buttons (A B X Y); an unmapped pad has no known layout. */
const FACE_BUTTONS = 4;
/** Standard mapping: 9 is Start (Options, Menu), 8 is Back (Select, View, Share). */
const MENU_BUTTONS: readonly (readonly [number, Command])[] = [
  [9, "start"],
  [8, "back"],
];
/** Milliseconds the player button must stay down to report `hold`. */
export const HOLD_MS = 1000;

const isDown = (button: GamepadLike["buttons"][number] | undefined) =>
  button !== undefined && (button.pressed || button.value > 0.5);

function faceButtonDown(pad: GamepadLike): boolean {
  const buttons =
    pad.mapping === "standard"
      ? pad.buttons.slice(0, FACE_BUTTONS)
      : pad.buttons;
  return buttons.some(isDown);
}

/** Per pad: when its player button went down (undefined while up), whether `hold` fired, and its menu buttons down. */
interface PadState {
  since: number | undefined;
  held: boolean;
  menu: Set<number>;
}

/**
 * Gamepad N is the device `pad:N`, and any face button is its one button. The Gamepad API has no button events, so
 * this polls: a press is a poll where some face button is down and none was at the previous poll. Hot-plugging
 * needs no events either: a pad is simply present or absent in `getGamepads()`, and a pad that comes back at the
 * same index is the same device (so an unplugged player can reconnect).
 *
 * A standard-mapped pad's Start and Back buttons report the `start` and `back` commands (they are never the player
 * button), and a player button held down for `HOLD_MS` reports `hold` once. `now` is the clock in milliseconds.
 */
export function attachGamepads(
  getGamepads: GetGamepads,
  press: (device: DeviceId) => void,
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
        if (!faceButtonDown(pad)) state.since = undefined;
        else if (state.since === undefined) {
          state.since = time;
          state.held = false;
          press(device);
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
        if (!present.has(index)) pads.delete(index);
    },
  };
}
