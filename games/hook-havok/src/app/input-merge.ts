import type { Input } from "../engine/world.js";
import type { KeyboardInput } from "./keyboard-input.js";
import { bombDirection, touchAim, type TouchState } from "./touch-input.js";

type Buttons = Pick<Input, "fire" | "bomb">;
/**
 * Merges the hook and bomb buttons of the keyboard and the mouse: J or a
 * left click holds the hook, K or a right click the bomb. A second mouse
 * button pressed or released while the first is held arrives as a
 * pointermove, never a pointerdown, so every mouse event reconciles the
 * pointer's `buttons` mask here. Local intent only; the result travels as
 * ordinary input.
 */
export class ButtonMerge {
  private mouse = 0;
  private keyFire = false;
  private keyBomb = false;
  /** The mask a pointerdown reports; some platforms leave `buttons` empty. */
  static pressed(button: number, buttons: number): number {
    return buttons || (button === 2 ? 2 : 1);
  }
  get held(): Buttons {
    return {
      fire: this.keyFire || (this.mouse & 1) !== 0,
      bomb: this.keyBomb || (this.mouse & 2) !== 0,
    };
  }
  /** Mouse buttons held on the scene: 1 left (hook), 2 right (bomb). */
  get buttons(): number {
    return this.mouse;
  }
  /** The keyboard's J and K after a key event. */
  keys(fire: boolean, bomb: boolean): Buttons {
    this.keyFire = fire;
    this.keyBomb = bomb;
    return this.held;
  }
  /** A pointer's button mask; undefined when neither button changed. */
  pointer(buttons: number): Buttons | undefined {
    buttons &= 3;
    if (buttons === this.mouse) return;
    this.mouse = buttons;
    return this.held;
  }
  /** Blur, a phase change or a layout switch: nothing is held any more. */
  clear(): void {
    this.mouse = 0;
    this.keyFire = this.keyBomb = false;
  }
}
/**
 * Whether the mouse position is the aim: always in the mouse scheme, and in
 * the keyboard scheme once a click took the aim from the keys.
 */
export const mouseAims = (k: Pick<KeyboardInput, "mode" | "aimSource">) =>
  k.mode !== "keyboard" || k.aimSource === "mouse";
/**
 * A touch state applied to the input. The hook's aim is captured on its
 * press, like the mouse hook; the bomb's on its release, because the engine
 * reads a throw's aim on the release tick, and again on a jump press, which is
 * when a Dash bump reads it. Both follow the aim pad's last direction and clip
 * to the aim contract from the keeper's chest.
 */
export function touchInput(
  input: Input,
  state: TouchState,
  chest: { x: number; y: number; facing: -1 | 1 },
): Input {
  const next: Input = {
    ...input,
    move: state.move,
    jump: state.jump,
    drop: state.drop,
    fire: state.fire,
    bomb: state.bomb,
  };
  if (state.fire && !input.fire)
    Object.assign(next, touchAim(chest.x, chest.y, state.direction));
  if ((input.bomb && !state.bomb) || (state.jump && !input.jump))
    Object.assign(
      next,
      touchAim(chest.x, chest.y, bombDirection(state, chest.facing)),
    );
  return next;
}
