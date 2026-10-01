import { LEFT, RIGHT } from "../engine/input.js";

/**
 * The controls a device holds, merged from the keyboard and the touch buttons. Keys are read by `code`, so the
 * layout does not matter: A or ← steers left, D or → steers right. Holding both drives straight on.
 */
export const KEYS: Readonly<Record<string, number>> = {
  KeyA: LEFT,
  ArrowLeft: LEFT,
  KeyD: RIGHT,
  ArrowRight: RIGHT,
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
  /** A named source (a touch button, the autopilot) holds `bits`, or 0 to let go. */
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
