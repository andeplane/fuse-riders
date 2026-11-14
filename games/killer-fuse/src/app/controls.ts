import {
  INPUT_DOWN,
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_RIGHT,
  TICK_HZ,
} from "../engine/index.js";

/**
 * This device's controls, Killer Queen Black's: left, right, down, the jump / flap button and the attack button, from
 * the keyboard (the arrows, Space and X), a gamepad and the touch pad at once. Jump / flap acts on its press edge (a jump on the ground, a flap
 * in the air); down is the Queen's dive; attack is a press edge only. Up does nothing. Each source says what it holds;
 * `Controls` merges them into the held bits the runtime logs (`input`) and passes every press on as its own edge
 * (`press`, `attack`), so a tap shorter than a frame still counts.
 */
export interface ControlSink {
  /** The held bits changed: `INPUT_LEFT | INPUT_RIGHT | INPUT_DOWN | INPUT_HELD`. */
  input(bits: number): void;
  /** The button went down. */
  press(): void;
  /** The attack button went down: a press edge only, never held. */
  attack(): void;
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
  /** The attack button went down on `source`. */
  attack(source: ControlSource): void {
    this.last = source;
    this.sink.attack();
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
/** The jump / flap button. Up and W are bound to nothing, as in the original. */
const BUTTON_KEYS = new Set(["Space"]);
/**
 * The attack button. X and Z sit next to Space under the left hand, which is where a player holding the arrows with
 * the right hand can reach them, and Shift is beside them; J is Killer Queen Black's own key, kept for anyone who
 * learned it there or plays with W A S D.
 */
const ATTACK_KEYS = new Set([
  "KeyX",
  "KeyZ",
  "ShiftLeft",
  "ShiftRight",
  "KeyJ",
]);
/** Keys the page swallows during play so they do not scroll it, though they do nothing. */
const QUIET_KEYS = new Set(["ArrowUp"]);
/** Whether the game owns the key (`KeyboardEvent.code`) during play: the page keeps it from scrolling. */
export const gameKey = (code: string): boolean =>
  Object.hasOwn(KEY_BITS, code) ||
  BUTTON_KEYS.has(code) ||
  ATTACK_KEYS.has(code) ||
  QUIET_KEYS.has(code);

/**
 * The keyboard: the arrows (or A/D) to move, Down (or S) held to dive, Space to jump and flap, X, Z or Shift (or J)
 * to attack.
 */
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
    if (ATTACK_KEYS.has(code)) this.controls.attack("keys");
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

/** As much of `window` and `document` as `releaseWhenAway` uses. */
export interface ReleaseTarget {
  addEventListener(
    type: string,
    listener: () => void,
    options?: { signal?: AbortSignal },
  ): void;
}
export interface VisibilityTarget extends ReleaseTarget {
  readonly visibilityState: string;
}

/**
 * Lets go of every control when the page stops being played. Focus loss alone is not enough: a phone switching apps
 * or locking hides the tab without firing `blur`, and the bits the runtime last logged would stay held — the rider
 * walks into a wall until its player comes back. `visibilitychange` covers that, and a desktop tab that fires both
 * simply releases twice, which holds nothing either way. `signal` takes both listeners off with the page's others.
 */
export function releaseWhenAway(
  window: ReleaseTarget,
  document: VisibilityTarget,
  release: () => void,
  options?: { signal?: AbortSignal },
): void {
  window.addEventListener("blur", release, options);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") release();
    },
    options,
  );
}

/** What a gamepad reports, as much of the browser's `Gamepad` as this reads. */
export interface PadLike {
  /** The browser keeps an unplugged pad in the array on some platforms; it holds nothing. */
  readonly connected: boolean;
  /** `"standard"` when the browser knows the layout. Anything else gets the small fallback below. */
  readonly mapping: string;
  readonly axes: readonly number[];
  /** A trigger is analogue: `pressed` is the browser's own threshold, `value` the pull. */
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value?: number;
  }[];
}
/**
 * How far the stick must leave the middle to move: a third of the way, past the drift of a worn stick, which half way
 * made it hard to walk slowly.
 */
export const STICK_DEAD = 0.3;
/** The dive asks for the stick clearly down, so a sideways push that drifts a little down never dives. */
export const STICK_DIVE = 0.5;
/** How far an analogue trigger counts as pulled, when the browser does not call it pressed. */
const TRIGGER_PULL = 0.5;
/** The bottom face button (A on Xbox, Cross on PlayStation) jumps and flaps, and nothing else does. */
const FLAP_BUTTON = 0;
/**
 * Attack: the face buttons beside the flap (B / Circle and X / Square), either bumper and either trigger, so whichever
 * finger is free can swing. Y / Triangle stays free, as the up direction does.
 */
const ATTACK_STANDARD = [1, 2, 4, 5, 6, 7];
/** On a pad the browser does not know, only the first three buttons are anywhere near reliable. */
const ATTACK_BASIC = [1, 2];
/** D-pad, on a standard pad. Up (12) is bound to nothing. */
const DPAD_DOWN = 13,
  DPAD_LEFT = 14,
  DPAD_RIGHT = 15;

/**
 * An axis reads -1 to 1. A missing one, a NaN or a wild number comes from a pad the browser cannot read, and holds
 * nothing rather than steering; a hair past the end (a stick reporting 1.0001) is simply the end.
 */
const axisValue = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || Math.abs(value) > 1.5
    ? 0
    : Math.max(-1, Math.min(1, value));

/** As much of `navigator` as the pads need. */
export interface PadSource {
  getGamepads?: () => readonly (PadLike | null)[];
}
/**
 * The pads this device has now. A browser without the Gamepad API, or one that blocks it (an insecure origin, a
 * permissions policy), reports none instead of throwing into the frame loop.
 */
export function readPads(source: PadSource): readonly (PadLike | null)[] {
  if (typeof source.getGamepads !== "function") return [];
  try {
    return source.getGamepads();
  } catch {
    return [];
  }
}

/**
 * Gamepads: the left stick or the d-pad to move and dive, A / Cross to jump and flap, B / Circle, X / Square, a bumper
 * or a trigger to attack; up does nothing. Polled every frame, which is how a pad plugged in mid-match is noticed: the
 * browser hands it over only once a button is pressed, and that first press is an edge like any other, so it still
 * flaps. One device plays one seat, so the first connected pad is the one that plays and the rest are ignored.
 */
export class Pads {
  /** The buttons of the pad in use that were down at the last poll, so each press counts once. */
  private was = new Set<number>();
  /** Which slot of `getGamepads()` is being played, so swapping pads arms the new one's buttons afresh. */
  private slot: number | undefined;
  private found = false;
  constructor(private readonly controls: Controls) {}
  /** Whether the last poll found a pad: what the hints on screen ask, without reading the browser again. */
  connected(): boolean {
    return this.found;
  }
  poll(pads: readonly (PadLike | null)[]): void {
    const slot = pads.findIndex(
      (pad) => pad !== null && pad !== undefined && pad.connected,
    );
    const pad = slot < 0 ? undefined : pads[slot];
    if (!pad) {
      this.release();
      return;
    }
    this.found = true;
    // A different pad: everything it holds is new, so a button already down presses rather than carrying over.
    if (slot !== this.slot) {
      this.slot = slot;
      this.was = new Set();
    }
    const standard = pad.mapping === "standard",
      on = (button: number): boolean => {
        const key = pad.buttons[button];
        return (
          key !== undefined && (key.pressed || (key.value ?? 0) > TRIGGER_PULL)
        );
      },
      x = axisValue(pad.axes[0]),
      y = axisValue(pad.axes[1]);
    let bits = 0;
    if (x < -STICK_DEAD || (standard && on(DPAD_LEFT))) bits |= INPUT_LEFT;
    if (x > STICK_DEAD || (standard && on(DPAD_RIGHT))) bits |= INPUT_RIGHT;
    if (y > STICK_DIVE || (standard && on(DPAD_DOWN))) bits |= INPUT_DOWN;
    const now = new Set<number>();
    if (on(FLAP_BUTTON)) {
      bits |= INPUT_HELD;
      now.add(FLAP_BUTTON);
    }
    for (const button of standard ? ATTACK_STANDARD : ATTACK_BASIC)
      if (on(button)) now.add(button);
    this.controls.set("pad", bits);
    for (const button of now)
      if (!this.was.has(button)) {
        if (button === FLAP_BUTTON) this.controls.press();
        else this.controls.attack("pad");
      }
    this.was = now;
  }
  /**
   * No pad any more: it was unplugged, or the page stopped being played. Nothing it held stays held, and the next pad
   * to arrive — the same one plugged back in included — presses from scratch.
   */
  release(): void {
    this.found = false;
    this.slot = undefined;
    this.was = new Set();
    this.controls.set("pad", 0);
  }
}

/** As much of a `Pads` as `watchPads` needs. */
export interface PadRelease {
  release(): void;
}
/**
 * A pad unplugged mid-match: let go at once rather than at the next poll, so a frame loop that is not polling (the
 * menu is open, the tab is hidden) cannot leave the rider walking into a wall. Connecting needs no listener — the poll
 * finds the pad the frame the browser hands it over — but `onConnect` lets the page react, and `signal` takes the
 * listeners off with the page's others.
 */
export function watchPads(
  window: ReleaseTarget,
  pads: PadRelease,
  options?: { signal?: AbortSignal; onConnect?: () => void },
): void {
  const { onConnect, ...rest } = options ?? {};
  window.addEventListener("gamepaddisconnected", () => pads.release(), rest);
  if (onConnect) window.addEventListener("gamepadconnected", onConnect, rest);
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
  private striking = false;
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
  /** The attack button beside it went down or up: only going down attacks. */
  strike(down: boolean): void {
    if (down === this.striking) return;
    this.striking = down;
    if (down) this.controls.attack("touch");
  }
}
