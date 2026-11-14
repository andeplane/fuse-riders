import {
  BRAKE,
  GAS,
  RESTART,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
} from "../engine/input.js";

/**
 * Gamepads, read as Fuse Volley reads them (`games/fuse-volley/src/app/gamepad.ts`): the Gamepad API has no button
 * events, so the page polls once an animation frame and holds what the pad holds.
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

/** Standard mapping: A, B, X, Y, the bumpers, the triggers and the d-pad's left and right. */
export const BUTTONS: readonly (readonly [number, number])[] = [
  [0, GAS],
  [7, GAS],
  [1, BRAKE],
  [6, BRAKE],
  [4, VOLT_LEFT],
  [14, VOLT_LEFT],
  [5, VOLT_RIGHT],
  [15, VOLT_RIGHT],
  [2, TURN],
  [3, RESTART],
];
/** A trigger counts as held past this much of its travel. */
export const TRIGGER_POINT = 0.3;

const isDown = (button: GamepadLike["buttons"][number] | undefined) =>
  button !== undefined && (button.pressed || button.value > TRIGGER_POINT);

/** The bits `pad` holds: A or RT gas, B or LT brake, LB/RB or the d-pad volts, X turn, Y restart. */
export function gamepadBits(pad: GamepadLike): number {
  let bits = 0;
  for (const [button, bit] of BUTTONS) {
    // Without the standard mapping a d-pad may be anything: only the face buttons, bumpers and triggers count.
    if (button >= 12 && pad.mapping !== "standard") continue;
    if (isDown(pad.buttons[button])) bits |= bit;
  }
  return bits;
}

/**
 * One gamepad drives this device's bike: the last to press. A pad held while input was let go (blur, a hidden page,
 * the menu) reads as neutral until it lets go itself.
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
