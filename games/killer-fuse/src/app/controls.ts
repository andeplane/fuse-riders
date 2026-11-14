import {
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
  TICK_HZ,
} from "../engine/index.js";

/**
 * This device's controls, the arcade's: left, right, down and one button, from the keyboard, a gamepad and the touch
 * pad at once. The button jumps on the ground and flaps in the air, on its press edge; down is the Queen's dive. Up
 * does nothing. Each source says what it holds; `Controls` merges them into the held bits the runtime logs (`input`)
 * and passes every press of the button on as its own edge (`press`), so a tap shorter than a frame still flaps.
 */
export interface ControlSink {
  /** The held bits changed: `INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN | INPUT_HELD`. */
  input(bits: number): void;
  /** The button went down. */
  press(): void;
}
export type ControlSource = "keys" | "pad" | "touch";

const DIRECTIONS = INPUT_LEFT | INPUT_RIGHT;
/** Left and right together are neither. */
export const settle = (bits: number): number =>
  (bits & DIRECTIONS) === DIRECTIONS ? bits & ~DIRECTIONS : bits;

/** Engine steps between the presses "Hold to flap" makes while the button is held: 8, or 7.5 a second. */
export const HOLD_REPEAT_STEPS = 8;
export const HOLD_REPEAT_MS = (HOLD_REPEAT_STEPS * 1000) / TICK_HZ;
/** Where this device keeps its "Hold to flap" choice; off unless it was turned on, as in the original. */
export const HOLD_TO_FLAP_KEY = "killer-fuse-hold-to-flap";
export const holdToFlapFrom = (stored: string | null): boolean =>
  stored === "1";

export class Controls {
  private readonly held = new Map<ControlSource, number>();
  private bits = 0;
  private last: ControlSource | undefined;
  private holdToFlap = false;
  /** When "Hold to flap" presses next, while the button stays down. */
  private repeatAt: number | undefined;
  /** `now` is a clock in milliseconds, for "Hold to flap". */
  constructor(
    private readonly sink: ControlSink,
    private readonly now: () => number = () => 0,
  ) {}
  /** "Hold to flap": while the button is held, `pulse` presses it again every HOLD_REPEAT_STEPS steps. */
  setHoldToFlap(on: boolean): void {
    this.holdToFlap = on;
    this.repeatAt = undefined;
  }
  holdsToFlap(): boolean {
    return this.holdToFlap;
  }
  /**
   * Called every frame: with "Hold to flap" on and the button held, presses again on the cadence, counted from the
   * last press. A long stall (a hidden tab) presses once and starts the count again rather than catching up.
   */
  pulse(): void {
    if (!this.holdToFlap || !(this.bits & INPUT_HELD)) {
      this.repeatAt = undefined;
      return;
    }
    const now = this.now();
    if (this.repeatAt === undefined) {
      this.repeatAt = now + HOLD_REPEAT_MS;
      return;
    }
    if (now < this.repeatAt) return;
    this.sink.press();
    this.repeatAt =
      now - this.repeatAt >= HOLD_REPEAT_MS
        ? now + HOLD_REPEAT_MS
        : this.repeatAt + HOLD_REPEAT_MS;
  }
  /** What `source` holds now. */
  set(source: ControlSource, bits: number): void {
    this.held.set(source, bits);
    if (bits !== 0) this.last = source;
    let merged = 0;
    for (const value of this.held.values()) merged |= value;
    merged = settle(merged);
    if (merged === this.bits) return;
    this.bits = merged;
    this.sink.input(merged);
  }
  press(): void {
    this.sink.press();
    if (this.holdToFlap) this.repeatAt = this.now() + HOLD_REPEAT_MS;
  }
  /** Everything let go: the page lost focus, or a menu opened. */
  release(): void {
    for (const source of [...this.held.keys()]) this.set(source, 0);
  }
  value(): number {
    return this.bits;
  }
  /** The source that last held anything: the device the player is using, for the hints on screen. */
  lastUsed(): ControlSource | undefined {
    return this.last;
  }
}

const KEY_BITS: Record<string, number> = {
  ArrowLeft: INPUT_LEFT,
  KeyA: INPUT_LEFT,
  ArrowRight: INPUT_RIGHT,
  KeyD: INPUT_RIGHT,
  ArrowDown: INPUT_DOWN,
  KeyS: INPUT_DOWN,
};
/** The one button. Up and W are bound to nothing, as in the original. */
const BUTTON_KEYS = new Set(["Space"]);
/** Keys the page swallows during play so they do not scroll it, though they do nothing. */
const QUIET_KEYS = new Set(["ArrowUp"]);
/** Whether the game owns the key (`KeyboardEvent.code`) during play: the page keeps it from scrolling. */
export const gameKey = (code: string): boolean =>
  Object.hasOwn(KEY_BITS, code) ||
  BUTTON_KEYS.has(code) ||
  QUIET_KEYS.has(code);

/** The keyboard: A/D or the arrows to move, S or down to dive, Space for the button. */
export class Keys {
  private readonly down = new Set<string>();
  constructor(private readonly controls: Controls) {}
  private update(): void {
    let bits = 0;
    for (const code of this.down)
      bits |= KEY_BITS[code] ?? (BUTTON_KEYS.has(code) ? INPUT_HELD : 0);
    this.controls.set("keys", bits);
  }
  /** A key went down; false when the game does not use it. The browser's key repeat is not a new press. */
  press(code: string): boolean {
    if (!gameKey(code)) return false;
    if (QUIET_KEYS.has(code)) return true;
    if (this.down.has(code)) return true;
    this.down.add(code);
    this.update();
    if (BUTTON_KEYS.has(code)) this.controls.press();
    return true;
  }
  lift(code: string): void {
    if (this.down.delete(code)) this.update();
  }
  clear(): void {
    this.down.clear();
    this.update();
  }
}

/** What a gamepad reports, as much of the browser's `Gamepad` as this reads. */
export interface PadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}
/** A stick counts as pushed past half way, sideways for moving and down for the dive, as in the original. */
export const STICK_DEAD = 0.5;
/** The bottom face button (A on Xbox, Cross on PlayStation) is the one button. */
const FACE = [0];
const DPAD_DOWN = 13,
  DPAD_LEFT = 14,
  DPAD_RIGHT = 15;

/** Gamepads: the left stick or the d-pad to move and dive, A / Cross for the button; up does nothing. Polled every frame. */
export class Pads {
  private readonly was = new Set<string>();
  constructor(private readonly controls: Controls) {}
  poll(pads: readonly (PadLike | null)[]): void {
    let bits = 0;
    const now = new Set<string>();
    pads.forEach((pad, index) => {
      if (!pad) return;
      const on = (button: number) => pad.buttons[button]?.pressed === true,
        x = pad.axes[0] ?? 0,
        y = pad.axes[1] ?? 0;
      if (x < -STICK_DEAD || on(DPAD_LEFT)) bits |= INPUT_LEFT;
      if (x > STICK_DEAD || on(DPAD_RIGHT)) bits |= INPUT_RIGHT;
      if (y > STICK_DEAD || on(DPAD_DOWN)) bits |= INPUT_DOWN;
      for (const button of FACE)
        if (on(button)) {
          bits |= INPUT_HELD;
          now.add(`${index}:${button}`);
        }
    });
    this.controls.set("pad", bits);
    for (const key of now) if (!this.was.has(key)) this.controls.press();
    this.was.clear();
    for (const key of now) this.was.add(key);
  }
}

/** The directions a thumb `dx`, `dy` pixels from where it touched down holds on a pad `radius` pixels wide. */
export function stickBits(dx: number, dy: number, radius: number): number {
  const dead = radius * 0.22;
  let bits = 0;
  if (dx < -dead) bits |= INPUT_LEFT;
  if (dx > dead) bits |= INPUT_RIGHT;
  // Down needs a clearer pull than sideways: a thumb sliding left and right drifts.
  if (dy > radius * 0.5) bits |= INPUT_DOWN;
  return bits;
}

/** The touch controls: a pad under the left thumb, one big button under the right. */
export class Touch {
  private stick = 0;
  private button = false;
  constructor(private readonly controls: Controls) {}
  private update(): void {
    this.controls.set("touch", this.stick | (this.button ? INPUT_HELD : 0));
  }
  /** The left thumb is `dx`, `dy` from where it touched the pad. */
  move(dx: number, dy: number, radius: number): void {
    this.stick = stickBits(dx, dy, radius);
    this.update();
  }
  /** The left thumb lifted. */
  rest(): void {
    this.stick = 0;
    this.update();
  }
  /** The button under the right thumb went down or up. */
  hold(down: boolean): void {
    if (down === this.button) return;
    this.button = down;
    this.update();
    if (down) this.controls.press();
  }
}
