import { JUMP, LEFT, RIGHT } from "../engine/input.js";
import { botInput, type World } from "../engine/index.js";

/**
 * The controls a device holds: left, right and jump, merged from the keyboard, the touch pads, a gamepad and the
 * autopilot. Keys are read by `code`, so the layout does not matter.
 *
 * Last direction wins: holding one way and pressing the other turns at once, and letting go of the newer key goes
 * back to the older one still held, so reversing never passes through a dead stop. The engine's "both cancel" rule
 * then only ever sees malformed input.
 */
export const KEYS: Readonly<Record<string, number>> = {
  KeyA: LEFT,
  ArrowLeft: LEFT,
  KeyD: RIGHT,
  ArrowRight: RIGHT,
  KeyW: JUMP,
  ArrowUp: JUMP,
  Space: JUMP,
  KeyJ: JUMP,
  KeyK: JUMP,
};

const DIRECTIONS = LEFT | RIGHT;

export class HeldControls {
  /** Every held input, keys and sources alike, with the bits each holds; newest last. */
  private readonly held = new Map<string, number>();
  private last = 0;
  constructor(private readonly changed: (bits: number) => void) {}
  /** A key went down; true if it is one of ours. */
  press(code: string): boolean {
    const bits = KEYS[code];
    if (bits === undefined) return false;
    if (!this.held.has(`key:${code}`)) this.set(`key:${code}`, bits);
    return true;
  }
  release(code: string): boolean {
    if (!(code in KEYS)) return false;
    this.set(`key:${code}`, 0);
    return true;
  }
  /** A named source (the touch rocker, the jump pad, a gamepad) holds `bits`, or 0 to let go. */
  hold(source: string, bits: number): void {
    this.set(`src:${source}`, bits);
  }
  /** Lets go of everything: blur, a hidden page, an open menu. */
  clear(): void {
    this.held.clear();
    this.emit();
  }
  get bits(): number {
    let jump = 0,
      direction = 0;
    // The newest input that holds a direction decides it.
    for (const bits of this.held.values()) {
      jump |= bits & JUMP;
      if (bits & DIRECTIONS) direction = bits & DIRECTIONS;
    }
    if (direction === DIRECTIONS) direction = 0;
    return jump | direction;
  }
  private set(name: string, bits: number): void {
    const was = this.held.get(name);
    if (was === bits) return;
    if (!bits) this.held.delete(name);
    else if (was !== undefined && (was & DIRECTIONS) === (bits & DIRECTIONS))
      // Only jump changed: the source keeps its place, so it does not steal the direction.
      this.held.set(name, bits);
    else {
      // A new direction makes the source the newest (a Map keeps insertion order).
      this.held.delete(name);
      this.held.set(name, bits);
    }
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
  /** Shows the pad's state: held or not, and which way (−1, 0 or 1). */
  show(state: { held: boolean; way: -1 | 0 | 1 }): void;
}

const capture = (surface: PadSurface, pointer: PadPointer) => {
  pointer.preventDefault();
  try {
    surface.capture(pointer.pointerId);
  } catch {
    /* the press still holds until it ends */
  }
};

/** A thumb this far past the trailing anchor turns the rocker, px. */
export const ROCKER_SLACK = 9;

/**
 * The left/right rocker: the first thumb down owns it. It goes the way the thumb went down on (left or right half of
 * the pad) at once, then follows the thumb: sliding back more than `ROCKER_SLACK` from the furthest point it reached
 * turns the other way, so a reverse takes a few pixels and never passes through a dead stop, wherever on the pad the
 * thumb has wandered. The function returned lets go for a thumb that will never lift here.
 */
export function bindRocker(
  surface: PadSurface,
  changed: (bits: number) => void,
): () => void {
  let owner: number | undefined,
    anchor = 0,
    way: -1 | 0 | 1 = 0;
  const emit = () => {
    surface.show({ held: owner !== undefined, way });
    changed(way < 0 ? LEFT : way > 0 ? RIGHT : 0);
  };
  surface.on("down", (pointer) => {
    if (owner !== undefined) return;
    owner = pointer.pointerId;
    capture(surface, pointer);
    const box = surface.box();
    way = pointer.clientX < box.left + box.width / 2 ? -1 : 1;
    anchor = pointer.clientX;
    emit();
  });
  surface.on("move", (pointer) => {
    if (pointer.pointerId !== owner) return;
    pointer.preventDefault();
    const x = pointer.clientX;
    let next = way;
    // The anchor is the furthest the thumb has gone the current way; coming back past the slack turns.
    if (way > 0) {
      anchor = Math.max(anchor, x);
      if (x < anchor - ROCKER_SLACK) next = -1;
    } else {
      anchor = Math.min(anchor, x);
      if (x > anchor + ROCKER_SLACK) next = 1;
    }
    if (next !== way) anchor = x;
    if (next !== way) {
      way = next;
      emit();
    }
  });
  const letGo = () => {
    if (owner === undefined) return;
    owner = undefined;
    way = 0;
    emit();
  };
  surface.on("up", (pointer) => {
    if (pointer.pointerId === owner) letGo();
  });
  return letGo;
}

/** A button on `surface` that holds `bits` while any pointer is down on it; the function returned lets go of them all. */
export function bindButton(
  surface: PadSurface,
  bits: number,
  changed: (bits: number) => void,
): () => void {
  const down = new Set<number>();
  surface.on("down", (pointer) => {
    capture(surface, pointer);
    down.add(pointer.pointerId);
    surface.show({ held: true, way: 0 });
    changed(bits);
  });
  surface.on("up", (pointer) => {
    if (!down.delete(pointer.pointerId) || down.size) return;
    surface.show({ held: false, way: 0 });
    changed(0);
  });
  return () => {
    if (!down.size) return;
    down.clear();
    surface.show({ held: false, way: 0 });
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

/** What `?autopilot` holds for the blob `me`: the bot's answer while a match is running, and nothing otherwise. */
export function autopilotBits(
  room: { stage: string; world: World | null | undefined } | undefined,
  me: string,
  bot: (world: World, slot: number) => number = (world, slot) =>
    botInput(world, slot, 2),
): number {
  if (room?.stage !== "running" || !room.world) return 0;
  const slot = room.world.blobs.findIndex((blob) => blob.id === me);
  return slot >= 0 ? bot(room.world, slot) : 0;
}
