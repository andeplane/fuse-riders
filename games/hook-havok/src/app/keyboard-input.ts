import type { Input } from "../engine/world.js";

/**
 * "keyboard" is the standard scheme: Space jumps, J hooks and K throws a
 * bomb along the WASD / arrow direction, and the mouse still aims, hooks with
 * a left click and bombs with a right click. "mouse" is the classic scheme:
 * the mouse aims and does both, and S / Down alone drops.
 */
export type KeyboardMode = "mouse" | "keyboard";
export type AimSource = "keys" | "mouse";
type Direction = { x: number; y: number };
const COMMON = [
  "KeyA",
  "KeyD",
  "KeyS",
  "ArrowLeft",
  "ArrowRight",
  "ArrowDown",
  "Space",
  "KeyR",
];
const AIM_KEYS = ["KeyW", "KeyS", "ArrowUp", "ArrowDown", "KeyJ", "KeyK"];
const DIRECTION_KEYS = [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
];
/**
 * Lifting a diagonal's two keys is never simultaneous: W + D released one at
 * a time passes through straight up or straight right. A bomb released this
 * soon after a direction key was lifted keeps the direction held before.
 */
export const RELEASE_GRACE_MS = 80;
/** Local intent only. Every shot and throw still travels through ordinary replicated input. */
export class KeyboardInput {
  private keys = new Set<string>();
  direction: Direction = { x: 0, y: -1 };
  mode: KeyboardMode = "keyboard";
  /** Whichever button was used last owns the aim: J / K the keys, a click the mouse. */
  aimSource: AimSource = "keys";
  /** The direction before the first of a run of direction-key releases, and when. */
  private settled?: { at: number; direction: Direction };
  /** The last event released K: the sample that follows is a throw. */
  private threw = false;
  /** When the last key event happened. */
  private at = 0;
  accepts(code: string): boolean {
    return (
      COMMON.includes(code) ||
      (this.mode === "keyboard" &&
        ["KeyW", "ArrowUp", "KeyJ", "KeyK", "ShiftLeft", "ShiftRight"].includes(
          code,
        ))
    );
  }
  clear(): void {
    this.keys.clear();
    this.settled = undefined;
    this.threw = false;
  }
  /** `now` is the event time in ms on any monotonic clock; omitted, the previous event's. */
  key(code: string, down: boolean, now = this.at): void {
    this.at = now;
    const before = this.direction;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    this.threw = code === "KeyK" && !down;
    if (this.mode !== "keyboard") return;
    if (down && AIM_KEYS.includes(code)) this.aimSource = "keys";
    const x =
      Number(this.has("KeyD", "ArrowRight")) -
      Number(this.has("KeyA", "ArrowLeft"));
    const y =
      Number(this.has("KeyS", "ArrowDown")) -
      Number(this.has("KeyW", "ArrowUp"));
    if (x || y) this.direction = { x, y };
    if (!DIRECTION_KEYS.includes(code)) return;
    // A new direction press is deliberate; a release only starts the grace.
    if (down) this.settled = undefined;
    else if (
      (before.x !== this.direction.x || before.y !== this.direction.y) &&
      (!this.settled || now - this.settled.at > RELEASE_GRACE_MS)
    )
      this.settled = { at: now, direction: before };
  }
  /**
   * The direction a K release at `now` throws along: while K is held (or has
   * just been released) and a direction key was lifted within the grace, the
   * direction held before that release; otherwise the current one.
   */
  aimDirection(now = this.at): Direction {
    const settled = this.settled;
    return settled &&
      (this.threw || this.keys.has("KeyK")) &&
      now - settled.at <= RELEASE_GRACE_MS
      ? settled.direction
      : this.direction;
  }
  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }
  /** `assist` may bend the eight-way direction onto a nearby ledge. */
  sample(
    x: number,
    y: number,
    assist?: (dx: number, dy: number) => { x: number; y: number },
    now = this.at,
  ): Pick<Input, "move" | "jump" | "drop" | "reset"> &
    Partial<Pick<Input, "fire" | "bomb" | "aimX" | "aimY">> {
    const directional = this.mode === "keyboard";
    const jump = this.has("Space");
    const direction = this.aimDirection(now);
    const aim =
      directional && this.aimSource === "keys"
        ? (assist?.(direction.x, direction.y) ?? direction)
        : undefined;
    return {
      move: (Number(this.has("KeyD", "ArrowRight")) -
        Number(this.has("KeyA", "ArrowLeft"))) as Input["move"],
      jump,
      // Standard scheme: Down alone aims down, so dropping takes Down + Space
      // (or Shift + Down). The engine drops instead of jumping on that tick.
      drop:
        this.has("KeyS", "ArrowDown") &&
        (!directional || jump || this.has("ShiftLeft", "ShiftRight")),
      reset: this.has("KeyR"),
      ...(directional
        ? { fire: this.has("KeyJ"), bomb: this.has("KeyK") }
        : {}),
      ...(aim
        ? {
            aimX: Math.round(x + aim.x * 1000),
            aimY: Math.round(y + aim.y * 1000),
          }
        : {}),
    };
  }
}
