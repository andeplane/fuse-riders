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
export type KeyboardControls = Record<ControllerControl, string>;
/** Separate default key sets for keyboard-mode controllers and a shared keyboard. */
export const LOCAL_KEYBOARD_PRESETS: readonly KeyboardControls[] = [
  { left: "KeyA", right: "KeyD", bomb: "Space" },
  { left: "KeyE", right: "KeyF", bomb: "KeyM" },
  { left: "KeyI", right: "KeyG", bomb: "KeyK" },
  { left: "ArrowLeft", right: "ArrowRight", bomb: "ArrowDown" },
  { left: "KeyJ", right: "KeyL", bomb: "KeyO" },
];
export const keyboardKeyLabel = (code: string): string =>
  ({
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Space: "Space",
  })[code] ?? code.replace(/^(Key|Digit)/, "");
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
  private readonly bindings: Readonly<
    Record<string, readonly [number, ControllerControl]>
  >;
  constructor(
    private state: ControllerInputState,
    private allowed: () => boolean,
    private changed: () => void = () => {},
    controls?: KeyboardControls,
  ) {
    this.bindings = controls
      ? Object.fromEntries(
          (["left", "right", "bomb"] as const).map((control, index) => [
            controls[control],
            [-101 - index, control] as const,
          ]),
        )
      : keys;
  }
  down(event: KeyboardInputEvent): void {
    const binding = this.bindings[event.code];
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
    const [id] = this.bindings[event.code]!;
    if (this.allowed()) this.state.pointerRelease(id);
    else this.state.pointerCancel(id);
    this.changed();
  }
  clear(): void {
    for (const code of this.held)
      this.state.pointerCancel(this.bindings[code]![0]);
    this.held.clear();
    this.changed();
  }
}
