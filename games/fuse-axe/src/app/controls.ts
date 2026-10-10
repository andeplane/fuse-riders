import { ATTACK, DOWN, JUMP, LEFT, MAGIC, RIGHT, UP } from "../engine/input.js";

/**
 * The controls a device holds, merged from the keyboard and any other named source. Keys are read by `code`, so the
 * layout does not matter: arrows or WASD walk (up and down are depth on the road), J or Z attacks, K or X jumps and
 * L or C casts magic.
 */
export const KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: LEFT,
  KeyA: LEFT,
  ArrowRight: RIGHT,
  KeyD: RIGHT,
  ArrowUp: UP,
  KeyW: UP,
  ArrowDown: DOWN,
  KeyS: DOWN,
  KeyJ: ATTACK,
  KeyZ: ATTACK,
  KeyK: JUMP,
  KeyX: JUMP,
  KeyL: MAGIC,
  KeyC: MAGIC,
};

/** The keys as the lobby and the landing page show them. */
export const KEY_HELP: readonly (readonly [string, string])[] = [
  ["ARROWS / WASD", "Walk the road, up and down in depth"],
  ["J / Z", "Attack"],
  ["K / X", "Jump"],
  ["L / C", "Magic"],
];

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
  /** A named source (a touch pad, a gamepad) holds `bits`, or 0 to let go. */
  hold(source: string, bits: number): void {
    if (bits) this.sources.set(source, bits);
    else this.sources.delete(source);
    this.emit();
  }
  /** Lets go of everything: blur, a hidden page, leaving the run. */
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
