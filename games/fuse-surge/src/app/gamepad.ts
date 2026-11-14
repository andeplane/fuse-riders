import { DUCK, JUMP } from "../engine/input.js";

/**
 * Gamepads, read as Fuse Axe reads them (`games/fuse-axe/src/app/gamepad.ts`, `docs/design/local-gamepads.md`): the
 * Gamepad API has no button events, so the page polls once an animation frame and holds what the pad holds.
 */
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

/** Where the pads come from: the browser's `navigator.getGamepads` (`browserGamepads`), a fake in tests. */
export interface GamepadSource {
  pads(): readonly (GamepadLike | null)[];
}

/** How far (0–1) the left stick must lean before it counts. */
export const STICK_DEAD_ZONE = 0.5;
/** Buttons that jump: A (Cross), Y (Triangle) and the right shoulder; and that duck: B (Circle), X (Square), the left one. */
const JUMP_BUTTONS = [0, 3, 5] as const,
  DUCK_BUTTONS = [1, 2, 4] as const;
/** Standard mapping: the d-pad's up and down. */
const DPAD_UP = 12,
  DPAD_DOWN = 13;

const isDown = (button: GamepadLike["buttons"][number] | undefined) =>
  button !== undefined && (button.pressed || button.value > 0.5);

/** The bits `pad` holds: stick or d-pad up and A or Y jump; stick or d-pad down and B or X duck. */
export function gamepadBits(pad: GamepadLike): number {
  const y = pad.axes[1] ?? 0;
  let bits = 0;
  if (Number.isFinite(y)) {
    if (y < -STICK_DEAD_ZONE) bits |= JUMP;
    else if (y > STICK_DEAD_ZONE) bits |= DUCK;
  }
  for (const button of JUMP_BUTTONS)
    if (isDown(pad.buttons[button])) bits |= JUMP;
  for (const button of DUCK_BUTTONS)
    if (isDown(pad.buttons[button])) bits |= DUCK;
  if (pad.mapping === "standard") {
    if (isDown(pad.buttons[DPAD_UP])) bits |= JUMP;
    if (isDown(pad.buttons[DPAD_DOWN])) bits |= DUCK;
  }
  return bits;
}

/**
 * One gamepad drives this device's rider: the last to press. A resting pad whose axis sits off centre cannot stand
 * in the way of a real one, and a pad held while input was let go (blur, a hidden page, the menu) reads as neutral
 * until it lets go itself.
 */
export class GamepadInput {
  private driver: number | undefined;
  private seen = new Map<number, number>();
  private readonly latched = new Set<number>();
  constructor(
    private readonly source: GamepadSource,
    private readonly hold: (bits: number) => void,
  ) {}
  letGo(): void {
    this.poll(false);
  }
  poll(active = true): void {
    const bits = new Map<number, number>();
    for (const pad of this.source.pads()) {
      if (!pad?.connected) continue;
      const held = gamepadBits(pad);
      if (!held) this.latched.delete(pad.index);
      else if (!active) this.latched.add(pad.index);
      bits.set(pad.index, this.latched.has(pad.index) ? 0 : held);
    }
    for (const index of this.latched)
      if (!bits.has(index)) this.latched.delete(index);
    if (this.driver !== undefined && !bits.has(this.driver))
      this.driver = undefined;
    for (const [index, held] of bits)
      if (held && (this.driver === undefined || held !== this.seen.get(index)))
        this.driver = index;
    this.seen = bits;
    this.hold(
      active && this.driver !== undefined ? (bits.get(this.driver) ?? 0) : 0,
    );
  }
}

/** The part of `navigator` the browser's gamepads come through. */
export interface GamepadNavigator {
  getGamepads?: () => readonly (GamepadLike | null)[];
}

/** `navigator.getGamepads` as a source; a browser without it, or a policy that forbids it, has no pads. */
export function browserGamepads(navigator: GamepadNavigator): GamepadSource {
  return {
    pads() {
      try {
        return navigator.getGamepads?.() ?? [];
      } catch {
        return [];
      }
    },
  };
}
