import {
  ControllerInputState,
  type ControllerControl,
} from "./controller-state.js";

const keys: Readonly<Record<string, readonly [number, ControllerControl]>> = {
  ArrowLeft: [-101, "left"],
  ArrowRight: [-102, "right"],
  Space: [-103, "bomb"],
  KeyA: [-104, "left"],
  KeyD: [-105, "right"],
};
export interface KeyboardInputEvent {
  code: string;
  repeat: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault(): void;
}
/** Distinct contact IDs let keyboard and touch share one held-control model. */
export class ControllerKeyboardBindings {
  private held = new Set<string>();
  constructor(
    private state: ControllerInputState,
    private allowed: () => boolean,
    private changed: () => void = () => {},
  ) {}
  down(event: KeyboardInputEvent): void {
    const binding = keys[event.code];
    if (!binding || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!this.allowed()) {
      this.clear();
      return;
    }
    event.preventDefault();
    if (event.repeat || this.held.has(event.code)) return;
    this.held.add(event.code);
    this.state.pointerDown(...binding);
    this.changed();
  }
  up(event: KeyboardInputEvent): void {
    if (!this.held.delete(event.code)) return;
    event.preventDefault();
    const [id] = keys[event.code]!;
    if (this.allowed()) this.state.pointerRelease(id);
    else this.state.pointerCancel(id);
    this.changed();
  }
  clear(): void {
    for (const code of this.held) this.state.pointerCancel(keys[code]![0]);
    this.held.clear();
    this.changed();
  }
}
