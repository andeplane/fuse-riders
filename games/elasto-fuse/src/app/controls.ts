import {
  BRAKE,
  GAS,
  RESTART,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
} from "../engine/input.js";

/**
 * The controls a device holds: gas, brake, the two volts, turn and restart, merged from the keyboard, the touch
 * buttons and a gamepad. Keys are read by `code`, so the layout does not matter. Every bit is simply held while any
 * source holds it; the engine acts on turn, the volts and restart on the step they go down.
 */
export const KEYS: Readonly<Record<string, number>> = {
  ArrowUp: GAS,
  KeyW: GAS,
  ArrowDown: BRAKE,
  KeyS: BRAKE,
  ArrowLeft: VOLT_LEFT,
  KeyA: VOLT_LEFT,
  ArrowRight: VOLT_RIGHT,
  KeyD: VOLT_RIGHT,
  Space: TURN,
  Enter: RESTART,
  KeyR: RESTART,
};

export class HeldControls {
  /** Every held input, keys and sources alike, with the bits each holds. */
  private readonly held = new Map<string, number>();
  private last = 0;
  constructor(private readonly changed: (bits: number) => void) {}
  /** A key went down; true if it is one of ours. */
  press(code: string): boolean {
    const bits = KEYS[code];
    if (bits === undefined) return false;
    this.set(`key:${code}`, bits);
    return true;
  }
  release(code: string): boolean {
    if (!(code in KEYS)) return false;
    this.set(`key:${code}`, 0);
    return true;
  }
  /** A named source (a touch button, a gamepad) holds `bits`, or 0 to let go. */
  hold(source: string, bits: number): void {
    this.set(`src:${source}`, bits);
  }
  /** Lets go of everything: blur, a hidden page, an open menu. */
  clear(): void {
    this.held.clear();
    this.emit();
  }
  get bits(): number {
    let bits = 0;
    for (const each of this.held.values()) bits |= each;
    return bits;
  }
  private set(name: string, bits: number): void {
    if ((this.held.get(name) ?? 0) === bits) return;
    if (bits) this.held.set(name, bits);
    else this.held.delete(name);
    this.emit();
  }
  private emit(): void {
    const bits = this.bits;
    if (bits === this.last) return;
    this.last = bits;
    this.changed(bits);
  }
}

/** A pointer as a button needs it. */
export interface PadPointer {
  pointerId: number;
  preventDefault(): void;
}
/** The part of an element a touch button uses; the page adapts a real one, a test supplies a fake. */
export interface PadSurface {
  /** `up` is every way a press ends: lifted, cancelled, or its capture lost. */
  on(kind: "down" | "up", listener: (pointer: PadPointer) => void): void;
  /** Keeps the press while the thumb slides off the button; may throw for a pointer the browser no longer tracks. */
  capture(pointerId: number): void;
  /** Shows the button held or not. */
  show(held: boolean): void;
}

/**
 * A button on `surface` that holds `bits` while any pointer is down on it, so two thumbs on two buttons are two
 * holds. The function returned lets go of them all, for a thumb that will never lift here.
 */
export function bindButton(
  surface: PadSurface,
  bits: number,
  changed: (bits: number) => void,
): () => void {
  const down = new Set<number>();
  surface.on("down", (pointer) => {
    pointer.preventDefault();
    try {
      surface.capture(pointer.pointerId);
    } catch {
      /* the press still holds until it ends */
    }
    down.add(pointer.pointerId);
    surface.show(true);
    changed(bits);
  });
  surface.on("up", (pointer) => {
    if (!down.delete(pointer.pointerId) || down.size) return;
    surface.show(false);
    changed(0);
  });
  return () => {
    if (!down.size) return;
    down.clear();
    surface.show(false);
    changed(0);
  };
}

/** The touch buttons, in the order the page lays them out: name, label, bits. */
export const TOUCH_BUTTONS = [
  { id: "restart", label: "RESTART", bits: RESTART, hint: "Restart" },
  { id: "turn", label: "TURN", bits: TURN, hint: "Turn around" },
  { id: "volt-left", label: "⟲", bits: VOLT_LEFT, hint: "Volt left" },
  { id: "volt-right", label: "⟳", bits: VOLT_RIGHT, hint: "Volt right" },
  { id: "brake", label: "BRAKE", bits: BRAKE, hint: "Brake" },
  { id: "gas", label: "GAS", bits: GAS, hint: "Gas" },
] as const;

/**
 * One set of touch buttons that shows and hides together. A button hidden under a thumb never hears it lift, so when
 * the set goes off screen every button lets go and so do the controls.
 */
export class PadSet {
  private readonly pads: (() => void)[] = [];
  private shown = false;
  constructor(private readonly controls: HeldControls) {}
  add(letGo: () => void): void {
    this.pads.push(letGo);
  }
  show(visible: boolean): void {
    if (this.shown && !visible) this.release();
    this.shown = visible;
  }
  /** Every button lets go now (a menu opened, the page lost focus); a thumb still down must lift to press again. */
  release(): void {
    for (const letGo of this.pads) letGo();
    this.controls.clear();
  }
}
