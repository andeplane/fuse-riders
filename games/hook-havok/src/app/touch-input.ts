import type { Input } from "../engine/world.js";

export type AimMode = "eight" | "free";
export type Pad = "move" | "aim" | "bomb";
export interface TouchState {
  move: Input["move"];
  jump: boolean;
  drop: boolean;
  fire: boolean;
  /** The bomb button is held: charging. Its release throws. */
  bomb: boolean;
  direction: { x: number; y: number };
  /** True once the aim pad has chosen a direction this session. */
  aimed: boolean;
}
/** Three pointer owners; a cancelled or replaced finger cannot resurrect held input. */
export class TouchInput {
  private owners = new Map<Pad, number>();
  private value: TouchState = {
    move: 0,
    jump: false,
    drop: false,
    fire: false,
    bomb: false,
    direction: { x: 0, y: -1 },
    aimed: false,
  };
  mode: AimMode = "eight";
  get active(): boolean {
    return this.owners.size > 0;
  }
  get state(): TouchState {
    return { ...this.value, direction: { ...this.value.direction } };
  }
  begin(pad: Pad, id: number): boolean {
    if (this.owners.has(pad) || [...this.owners.values()].includes(id))
      return false;
    this.owners.set(pad, id);
    return true;
  }
  owns(pad: Pad, id: number): boolean {
    return this.owners.get(pad) === id;
  }
  update(pad: Pad, id: number, x: number, y: number): boolean {
    if (!this.owns(pad, id) || !Number.isFinite(x) || !Number.isFinite(y))
      return false;
    if (pad === "bomb") this.value.bomb = true;
    else if (pad === "move") {
      this.value.move = x < -0.22 ? -1 : x > 0.22 ? 1 : 0;
      this.value.jump = y < -0.38;
      this.value.drop = y > 0.38;
    } else if (!this.value.fire && Math.hypot(x, y) >= 0.28) {
      // Aim is captured at launch, exactly like the mouse hook. Release to rearm.
      const angle = Math.atan2(y, x);
      const snapped =
        this.mode === "eight"
          ? (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4
          : angle;
      this.value.direction = { x: Math.cos(snapped), y: Math.sin(snapped) };
      this.value.aimed = true;
      this.value.fire = true;
    }
    return true;
  }
  end(pad: Pad, id: number): boolean {
    if (!this.owns(pad, id)) return false;
    this.owners.delete(pad);
    if (pad === "move") {
      this.value.move = 0;
      this.value.jump = false;
      this.value.drop = false;
    } else if (pad === "bomb") this.value.bomb = false;
    else this.value.fire = false;
    return true;
  }
  clear(): void {
    this.owners.clear();
    this.value = {
      move: 0,
      jump: false,
      drop: false,
      fire: false,
      bomb: false,
      direction: this.value.direction,
      aimed: this.value.aimed,
    };
  }
}

/**
 * The bomb button throws along the aim pad's last direction, or, before the
 * aim pad has been used, forward and up at 45° from the facing direction
 * (a level throw from the chest barely clears the ledge).
 */
export function bombDirection(
  state: Pick<TouchState, "aimed" | "direction">,
  facing: -1 | 1,
): TouchState["direction"] {
  return state.aimed
    ? { ...state.direction }
    : { x: facing * Math.SQRT1_2, y: -Math.SQRT1_2 };
}
/** Keep a ray's direction when clipping its endpoint to the input contract. */
export function touchAim(
  x: number,
  y: number,
  direction: TouchState["direction"],
): Pick<Input, "aimX" | "aimY"> {
  x = Math.max(0, Math.min(1600, x));
  y = Math.max(0, Math.min(900, y));
  const dx = direction.x,
    dy = direction.y;
  const distance = Math.min(
    1000,
    dx > 1e-9 ? (1600 - x) / dx : dx < -1e-9 ? -x / dx : Infinity,
    dy > 1e-9 ? (900 - y) / dy : dy < -1e-9 ? -y / dy : Infinity,
  );
  return {
    aimX: Math.round(x + dx * distance),
    aimY: Math.round(y + dy * distance),
  };
}
