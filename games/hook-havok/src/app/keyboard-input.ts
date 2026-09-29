import type { Input } from "../engine/world.js";

export type KeyboardMode = "mouse" | "keyboard";
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
/** Local intent only. Every shot still travels through ordinary replicated input. */
export class KeyboardInput {
  private keys = new Set<string>();
  direction = { x: 0, y: -1 };
  mode: KeyboardMode = "mouse";
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
  sample(
    x: number,
    y: number,
  ): Pick<Input, "move" | "jump" | "drop" | "reset"> &
    Partial<Pick<Input, "fire" | "aimX" | "aimY">> {
    const directional = this.mode === "keyboard";
    return {
      move: (Number(this.has("KeyD", "ArrowRight")) -
        Number(this.has("KeyA", "ArrowLeft"))) as Input["move"],
      jump: this.has("Space") || (directional && this.has("KeyJ")),
      drop:
        this.has("KeyS", "ArrowDown") &&
        (!directional || this.has("ShiftLeft", "ShiftRight")),
      reset: this.has("KeyR"),
      ...(directional
        ? {
            fire: this.has("KeyK"),
            aimX: Math.round(x + this.direction.x * 1000),
            aimY: Math.round(y + this.direction.y * 1000),
          }
        : {}),
    };
  }
}
