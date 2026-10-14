import {
  ControllerInputState,
  type ControllerControl,
} from "./controller-state.js";

/** Small browser seam: snapshots, not live browser objects, so input can be tested without hardware. */
export interface PadSnapshot {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
}
export type PadBinding =
  { button: number } | { axis: number; direction: -1 | 1 };
export type PadMapping = Record<ControllerControl, readonly PadBinding[]>;
export const STANDARD_PAD: PadMapping = {
  left: [{ button: 14 }, { axis: 0, direction: -1 }],
  right: [{ button: 15 }, { axis: 0, direction: 1 }],
  bomb: [{ button: 0 }],
};
export interface PadAssignment {
  index: number;
  id: string;
  mapping: PadMapping;
  standard: boolean;
}
export function readGamepads(source: {
  getGamepads?: () => readonly (PadSnapshot | null)[];
}): {
  pads: PadSnapshot[];
  error?: string;
} {
  if (!source.getGamepads)
    return {
      pads: [],
      error:
        "This browser does not support game controllers. Try Chrome or Safari on this Mac.",
    };
  try {
    return {
      pads: source
        .getGamepads()
        .filter((pad): pad is PadSnapshot => Boolean(pad?.connected)),
    };
  } catch {
    return {
      pads: [],
      error:
        "Controller access is blocked. Open this page directly on HTTPS or localhost, then retry.",
    };
  }
}
export function bindingPressed(
  pad: PadSnapshot,
  binding: PadBinding,
  threshold = 0.5,
): boolean {
  if ("button" in binding) {
    const button = pad.buttons[binding.button];
    return Boolean(button && (button.pressed || button.value > threshold));
  }
  const value = pad.axes[binding.axis];
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1 &&
    value * binding.direction > threshold
  );
}
/** Calibration records a deliberate button or stick direction after the pad returns to neutral. */
export function activeBinding(
  pad: PadSnapshot,
  buttonsOnly = false,
): PadBinding | undefined {
  const button = pad.buttons.findIndex((b) => b.pressed || b.value > 0.65);
  if (button >= 0) return { button };
  if (buttonsOnly) return;
  const axis = pad.axes.findIndex(
    (a) => Number.isFinite(a) && Math.abs(a) > 0.65 && Math.abs(a) <= 1,
  );
  if (axis >= 0) return { axis, direction: pad.axes[axis]! < 0 ? -1 : 1 };
  return;
}

const contacts: Record<ControllerControl, number> = {
  left: -201,
  right: -202,
  bomb: -203,
};
/** Each instance owns exactly one pad and one rider; cancellation always waits for neutral before rearming. */
export class ControllerGamepadBindings {
  private armed = false;
  private readonly held = { left: false, right: false, bomb: false };
  private startHeld = false;
  connected = false;
  constructor(
    readonly assignment: PadAssignment,
    private readonly state: ControllerInputState,
    private readonly start: () => void = () => {},
  ) {}
  update(pads: readonly PadSnapshot[], allowed: boolean): void {
    const pad = pads.find(
      (p) =>
        p.connected &&
        p.index === this.assignment.index &&
        p.id === this.assignment.id,
    );
    this.connected = Boolean(pad);
    if (!pad || !allowed) {
      this.clear();
      return;
    }
    const pressed = (control: ControllerControl) =>
      this.assignment.mapping[control].some((binding) =>
        bindingPressed(pad, binding, this.held[control] ? 0.25 : 0.5),
      );
    const next = {
      left: pressed("left"),
      right: pressed("right"),
      bomb: pressed("bomb"),
    };
    const start =
      this.assignment.standard && bindingPressed(pad, { button: 9 });
    if (!this.armed) {
      this.armed = !next.left && !next.right && !next.bomb && !start;
      return;
    }
    for (const control of ["left", "right", "bomb"] as const) {
      if (next[control] === this.held[control]) continue;
      this.held[control] = next[control];
      if (next[control]) this.state.pointerDown(contacts[control], control);
      else this.state.pointerRelease(contacts[control]);
    }
    const startPressed = start && !this.startHeld;
    this.startHeld = start;
    if (startPressed) this.start();
  }
  clear(): void {
    this.armed = false;
    this.startHeld = false;
    for (const control of ["left", "right", "bomb"] as const) {
      this.held[control] = false;
      this.state.pointerCancel(contacts[control]);
    }
  }
}
