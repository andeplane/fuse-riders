import { DOWN, FIRE, LEFT, RIGHT, UP } from "../engine/input.js";

/**
 * The controls a device holds, merged from the keyboard, touch pads and the mouse. Keys are read by `code`, so the
 * layout does not matter: Space, W or ↑ climbs (or flies up in the thrust trial), S or ↓ dives in the thrust
 * trial, A/D or ←/→ steer, and F, J, K or Enter fire.
 */
export const KEYS: Readonly<Record<string, number>> = {
  Space: UP,
  KeyW: UP,
  ArrowUp: UP,
  KeyS: DOWN,
  ArrowDown: DOWN,
  KeyA: LEFT,
  ArrowLeft: LEFT,
  KeyD: RIGHT,
  ArrowRight: RIGHT,
  KeyF: FIRE,
  KeyJ: FIRE,
  KeyK: FIRE,
  Enter: FIRE,
  NumpadEnter: FIRE,
};

export class HeldControls {
  private readonly keys = new Set<string>();
  private readonly sources = new Map<string, number>();
  constructor(private readonly changed: (bits: number) => void) {}
  private last = 0;
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
  /** A named source (a touch button, the mouse) holds `bits`, or 0 to let go. */
  hold(source: string, bits: number): void {
    if (bits) this.sources.set(source, bits);
    else this.sources.delete(source);
    this.emit();
  }
  /** Lets go of everything: blur, a hidden page, leaving the round. */
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
