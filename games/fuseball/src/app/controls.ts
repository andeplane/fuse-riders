import { BTN, DOWN, LEFT, RIGHT, UP } from "../engine/input.js";

/**
 * The controls a device holds: one eight-way stick and one button, merged from the keyboard and the touch pads. Keys
 * are read by `code`, so the layout does not matter: the arrows or WASD are the stick, and Space, J or K the button.
 */
export const KEYS: Readonly<Record<string, number>> = {
  KeyW: UP,
  ArrowUp: UP,
  KeyS: DOWN,
  ArrowDown: DOWN,
  KeyA: LEFT,
  ArrowLeft: LEFT,
  KeyD: RIGHT,
  ArrowRight: RIGHT,
  Space: BTN,
  KeyJ: BTN,
  KeyK: BTN,
};

export class HeldControls {
  private readonly keys = new Set<string>();
  private readonly sources = new Map<string, number>();
  private last = 0;
  constructor(private readonly changed: (bits: number) => void) {}
  /** A key went down; true if it is one of ours. */
  press(code: string): boolean {
    if (!(code in KEYS)) return false;
    this.keys.add(code);
    this.emit();
    return true;
  }
  release(code: string): boolean {
    if (!(code in KEYS)) return false;
    this.keys.delete(code);
    this.emit();
    return true;
  }
  /** A named source (the touch stick, the touch button) holds `bits`, or 0 to let go. */
  hold(source: string, bits: number): void {
    if (bits) this.sources.set(source, bits);
    else this.sources.delete(source);
    this.emit();
  }
  /** Lets go of everything: blur, a hidden page, an open menu. */
  clear(): void {
    this.keys.clear();
    this.sources.clear();
    this.emit();
  }
  get bits(): number {
    let bits = 0;
    for (const code of this.keys) bits |= KEYS[code]!;
    for (const held of this.sources.values()) bits |= held;
    return bits;
  }
  private emit(): void {
    const bits = this.bits;
    if (bits === this.last) return;
    this.last = bits;
    this.changed(bits);
  }
}

/** Inside this share of the pad's radius the stick is centred. */
export const DEAD_ZONE = 0.28;
/** tan(22.5°) as a ratio: an axis counts once it is at least this share of the other, which makes eight even ways. */
const DIAGONAL_NUM = 41,
  DIAGONAL_DEN = 99;

/**
 * The stick's bits for a thumb at (`dx`, `dy`) from the pad's centre, where `radius` is the pad's: centred inside
 * the dead zone, otherwise one of eight ways. Down is positive `dy`, as on a screen.
 */
export function stickFrom(dx: number, dy: number, radius: number): number {
  if (!(radius > 0)) return 0;
  const reach = DEAD_ZONE * radius;
  if (dx * dx + dy * dy < reach * reach) return 0;
  const ax = Math.abs(dx),
    ay = Math.abs(dy);
  let bits = 0;
  if (ax * DIAGONAL_DEN >= ay * DIAGONAL_NUM) bits |= dx < 0 ? LEFT : RIGHT;
  if (ay * DIAGONAL_DEN >= ax * DIAGONAL_NUM) bits |= dy < 0 ? UP : DOWN;
  return bits;
}

/** A pointer as a pad needs it. */
export interface PadPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}
/** The part of an element a pad uses; the page adapts a real one, a test supplies a fake. */
export interface PadSurface {
  /** `up` is every way a press ends: lifted, cancelled, or its capture lost. */
  on(
    kind: "down" | "move" | "up",
    listener: (pointer: PadPointer) => void,
  ): void;
  /** Keeps the press while the thumb slides off the pad; may throw for a pointer the browser no longer tracks. */
  capture(pointerId: number): void;
  box(): { left: number; top: number; width: number; height: number };
  /** Shows the pad's state: held or not, and where the thumb is from the centre, −1 to 1 each way. */
  show(state: { held: boolean; x: number; y: number }): void;
}

const capture = (surface: PadSurface, pointer: PadPointer) => {
  pointer.preventDefault();
  try {
    surface.capture(pointer.pointerId);
  } catch {
    /* the press still holds until it ends */
  }
};

/** An eight-way stick on `surface`: the first thumb down owns it until it lifts, and `changed` hears its bits. */
export function bindStick(
  surface: PadSurface,
  changed: (bits: number) => void,
): void {
  let owner: number | undefined;
  const read = (pointer: PadPointer) => {
    const box = surface.box(),
      radius = Math.min(box.width, box.height) / 2,
      dx = pointer.clientX - (box.left + box.width / 2),
      dy = pointer.clientY - (box.top + box.height / 2);
    const scale = radius > 0 ? 1 / radius : 0,
      clamp = (value: number) => Math.max(-1, Math.min(1, value * scale));
    surface.show({ held: true, x: clamp(dx), y: clamp(dy) });
    changed(stickFrom(dx, dy, radius));
  };
  surface.on("down", (pointer) => {
    if (owner !== undefined) return;
    owner = pointer.pointerId;
    capture(surface, pointer);
    read(pointer);
  });
  surface.on("move", (pointer) => {
    if (pointer.pointerId !== owner) return;
    pointer.preventDefault();
    read(pointer);
  });
  surface.on("up", (pointer) => {
    if (pointer.pointerId !== owner) return;
    owner = undefined;
    surface.show({ held: false, x: 0, y: 0 });
    changed(0);
  });
}

/** A button on `surface` that holds `bits` while any pointer is down on it. */
export function bindButton(
  surface: PadSurface,
  bits: number,
  changed: (bits: number) => void,
): void {
  const down = new Set<number>();
  surface.on("down", (pointer) => {
    capture(surface, pointer);
    down.add(pointer.pointerId);
    surface.show({ held: true, x: 0, y: 0 });
    changed(bits);
  });
  surface.on("up", (pointer) => {
    if (!down.delete(pointer.pointerId) || down.size) return;
    surface.show({ held: false, x: 0, y: 0 });
    changed(0);
  });
}
