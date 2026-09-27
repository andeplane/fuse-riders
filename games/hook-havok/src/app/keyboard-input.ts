import type { Input } from "../engine/world.js";

/**
 * "keyboard" is the standard scheme: J / Space jump, K hooks along the
 * WASD / arrow direction, and the mouse still aims and fires with a click.
 * "mouse" is the classic scheme where S / Down alone drops.
 */
export type KeyboardMode = "mouse" | "keyboard";
export type AimSource = "keys" | "mouse";
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
const AIM_KEYS = ["KeyW", "KeyS", "ArrowUp", "ArrowDown", "KeyK"];
/** Local intent only. Every shot still travels through ordinary replicated input. */
export class KeyboardInput {
  private keys = new Set<string>();
  direction = { x: 0, y: -1 };
  mode: KeyboardMode = "keyboard";
  /** Whichever hook button was used last owns the aim: K the keys, a click the mouse. */
  aimSource: AimSource = "keys";
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
  }
  key(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    if (this.mode !== "keyboard") return;
    if (down && AIM_KEYS.includes(code)) this.aimSource = "keys";
    const x =
      Number(this.has("KeyD", "ArrowRight")) -
      Number(this.has("KeyA", "ArrowLeft"));
    const y =
      Number(this.has("KeyS", "ArrowDown")) -
      Number(this.has("KeyW", "ArrowUp"));
    if (x || y) this.direction = { x, y };
  }
  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }
  /** `assist` may bend the eight-way direction onto a nearby ledge. */
  sample(
    x: number,
    y: number,
    assist?: (dx: number, dy: number) => { x: number; y: number },
  ): Pick<Input, "move" | "jump" | "drop" | "reset"> &
    Partial<Pick<Input, "fire" | "aimX" | "aimY">> {
    const directional = this.mode === "keyboard";
    const jump = this.has("Space") || (directional && this.has("KeyJ"));
    const aim =
      directional && this.aimSource === "keys"
        ? (assist?.(this.direction.x, this.direction.y) ?? this.direction)
        : undefined;
    return {
      move: (Number(this.has("KeyD", "ArrowRight")) -
        Number(this.has("KeyA", "ArrowLeft"))) as Input["move"],
      jump,
      // Standard scheme: Down alone aims down, so dropping takes Down + Jump
      // (or Shift + Down). The engine drops instead of jumping on that tick.
      drop:
        this.has("KeyS", "ArrowDown") &&
        (!directional || jump || this.has("ShiftLeft", "ShiftRight")),
      reset: this.has("KeyR"),
      ...(directional ? { fire: this.has("KeyK") } : {}),
      ...(aim
        ? {
            aimX: Math.round(x + aim.x * 1000),
            aimY: Math.round(y + aim.y * 1000),
          }
        : {}),
    };
  }
}
