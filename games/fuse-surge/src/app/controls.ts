import { DUCK, JUMP } from "../engine/input.js";
import { botInput, type World } from "../engine/index.js";

/**
 * The controls a device holds: jump and duck, merged from the keyboard, the touch pads, a gamepad and the autopilot.
 * Keys are read by `code`, so the layout does not matter. Anything that holds a bit holds it for the device: jump
 * stays down while any key, pad or button has it down.
 */
export const KEYS: Readonly<Record<string, number>> = {
  KeyW: JUMP,
  ArrowUp: JUMP,
  Space: JUMP,
  KeyK: JUMP,
  KeyS: DUCK,
  ArrowDown: DUCK,
  ShiftLeft: DUCK,
  ShiftRight: DUCK,
  KeyJ: DUCK,
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

/** A pointer as a pad needs it. */
export interface PadPointer {
  pointerId: number;
  preventDefault(): void;
}
/** The part of an element a pad uses; the page adapts a real one, a test supplies a fake. */
export interface PadSurface {
  /** `up` is every way a press ends: lifted, cancelled, or its capture lost. */
  on(kind: "down" | "up", listener: (pointer: PadPointer) => void): void;
  /** Keeps the press while the thumb slides off the pad; may throw for a pointer the browser no longer tracks. */
  capture(pointerId: number): void;
  /** Shows the pad held or not. */
  show(held: boolean): void;
}

/** A button on `surface` that holds `bits` while any pointer is down on it; the function returned lets go of them all. */
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

/**
 * One set of touch pads that shows and hides together. A pad hidden under a thumb never hears it lift, so when the
 * set goes off screen every pad lets go and so do the controls.
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
  /** Every pad lets go now (a menu opened, the page lost focus); a thumb still down must lift to press again. */
  release(): void {
    for (const letGo of this.pads) letGo();
    this.controls.clear();
  }
}

/** What `?autopilot` holds for the rider `me`: the bot's answer while a match is running, and nothing otherwise. */
export function autopilotBits(
  room: { stage: string; world: World | null | undefined } | undefined,
  me: string,
  bot: (world: World, slot: number) => number = (world, slot) =>
    botInput(world, slot, 2),
): number {
  if (room?.stage !== "running" || !room.world) return 0;
  const slot = room.world.riders.findIndex((rider) => rider.id === me);
  return slot >= 0 ? bot(room.world, slot) : 0;
}
