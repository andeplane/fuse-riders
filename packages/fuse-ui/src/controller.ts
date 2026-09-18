import { el } from "./dom.js";

export interface ControllerButton {
  label: string;
  /** Keyboard equivalent, for `aria-keyshortcuts` (e.g. "ArrowLeft A", "Space"). */
  keys?: string;
  /** Tooltip. */
  title?: string;
  /** Called on press (pointer down). Omit when the game binds its own pointer handling. */
  onPress?: () => void;
  /** Called when that press ends: pointer up, cancel, or leaving the button. */
  onRelease?: () => void;
}

export interface ControllerRowOptions<
  Buttons extends readonly ControllerButton[] = readonly ControllerButton[],
> {
  buttons: Buttons;
  className?: string;
  document?: Document;
}

export interface ControllerRow<
  Buttons extends readonly ControllerButton[] = readonly ControllerButton[],
> {
  element: HTMLElement;
  /** One button per spec, in the same order (a tuple when the specs are). */
  buttons: { -readonly [I in keyof Buttons]: HTMLButtonElement };
}

/**
 * A row of big touch buttons for a phone used as a controller (ROLL / HOLD, or steer and fire). Long presses do not
 * select text or open the context menu. A button with `onPress` fires on pointer down, not on click, so a tap
 * feels immediate; a pressed button carries the `active` class until released.
 */
export function createControllerRow<
  const Buttons extends readonly ControllerButton[],
>(options: ControllerRowOptions<Buttons>): ControllerRow<Buttons> {
  const doc = options.document ?? document;
  const element = el("div", "", options.className ?? "fui-controller", doc);
  element.addEventListener("selectstart", (event) => event.preventDefault());
  element.addEventListener("contextmenu", (event) => event.preventDefault());
  const buttons = options.buttons.map((spec) => {
    const button = el("button", spec.label, "", doc);
    button.type = "button";
    if (spec.keys) button.setAttribute("aria-keyshortcuts", spec.keys);
    if (spec.title) button.title = spec.title;
    if (spec.onPress) {
      const press = spec.onPress;
      // The pointer that started the press; only its lift ends it, so a second finger cannot release the first.
      let held: number | undefined;
      const release = (event: Event) => {
        if (held === undefined || (event as PointerEvent).pointerId !== held)
          return;
        held = undefined;
        button.classList.remove("active");
        spec.onRelease?.();
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        // Browsers still deliver pointer events to a disabled button; a right or middle click is not a press.
        if (button.disabled || event.button !== 0 || held !== undefined) return;
        held = event.pointerId;
        button.classList.add("active");
        press();
      });
      for (const type of ["pointerup", "pointercancel", "pointerleave"])
        button.addEventListener(type, release);
      // Keyboard and assistive tech activate with click; a press it did not start through the pointer is one tap.
      button.addEventListener("click", (event) => {
        if (event.detail !== 0 || button.disabled) return;
        press();
        spec.onRelease?.();
      });
    }
    element.append(button);
    return button;
  });
  return {
    element,
    buttons: buttons as { -readonly [I in keyof Buttons]: HTMLButtonElement },
  };
}
