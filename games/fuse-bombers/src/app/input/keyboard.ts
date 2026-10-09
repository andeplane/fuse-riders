import type { DeviceId, InputSource } from "./hub.js";

/**
 * Six player buttons spread across a keyboard so six people can crowd round one laptop: two on the left hand side
 * (`Q` top-left, `C` bottom-left), two on the right (`M` bottom-right, `P` top-right), then the arrow cluster and
 * the numpad for players at the far right. Any arrow key is the ARROWS button, and `Numpad0` or `NumpadEnter` is
 * the NUM0 button, so those players do not have to find one small key. Codes are layout-independent
 * (`KeyboardEvent.code`), so `Q` is the top-left letter key on AZERTY too.
 */
export const KEY_BINDINGS: readonly {
  readonly device: DeviceId;
  readonly codes: readonly string[];
}[] = [
  { device: "key:Q", codes: ["KeyQ"] },
  { device: "key:C", codes: ["KeyC"] },
  { device: "key:M", codes: ["KeyM"] },
  { device: "key:P", codes: ["KeyP"] },
  {
    device: "key:ARROWS",
    codes: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  },
  { device: "key:NUM0", codes: ["Numpad0", "NumpadEnter"] },
];

/** The part of a `KeyboardEvent` the keyboard source reads. */
export type KeyEventLike = Pick<
  KeyboardEvent,
  "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault"
> & { readonly target?: EventTarget | null };

/** Where key events come from: `window` in the browser, a fake in tests. */
export interface KeyboardTarget {
  addEventListener(
    type: "keydown" | "keyup",
    listener: (event: KeyEventLike) => void,
  ): void;
  addEventListener(
    type: "blur" | "visibilitychange",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "keydown" | "keyup",
    listener: (event: KeyEventLike) => void,
  ): void;
  removeEventListener(
    type: "blur" | "visibilitychange",
    listener: () => void,
  ): void;
}

/** Whether keys typed at `target` belong to a form field (a lobby name box, a select) rather than the game. */
function isFormField(target: EventTarget | null | undefined): boolean {
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  } | null;
  if (!element) return false;
  const tag = typeof element.tagName === "string" ? element.tagName : "";
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true
  );
}

/**
 * Report a press when a bound key goes down. Auto-repeat is ignored (both `event.repeat` and a second keydown
 * without a keyup), and while one key of a binding is held its other keys do not press again. Shortcuts with
 * Ctrl, Cmd or Alt are left to the browser, and so are keys typed into a form field.
 *
 * A key whose keyup never arrives would stay held and never press again, so held keys are forgotten whenever a
 * keyup may be lost: on window blur, on a visibility change (tab switch), and when a modifier goes down (macOS
 * drops the keyup of a key released while Cmd is held).
 */
export function attachKeyboard(
  target: KeyboardTarget,
  press: (device: DeviceId) => void,
): InputSource {
  const bindingOf = new Map(
    KEY_BINDINGS.flatMap((binding) =>
      binding.codes.map((code) => [code, binding] as const),
    ),
  );
  const held = new Set<string>();

  const onKeyDown = (event: KeyEventLike): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      held.clear();
      return;
    }
    const binding = bindingOf.get(event.code);
    if (!binding || isFormField(event.target)) return;
    event.preventDefault(); // Arrow keys would scroll, and the game owns these keys.
    if (event.repeat || held.has(event.code)) return;
    const bindingHeld = binding.codes.some((code) => held.has(code));
    held.add(event.code);
    if (!bindingHeld) press(binding.device);
  };
  const onKeyUp = (event: KeyEventLike): void => {
    held.delete(event.code);
  };
  const forgetHeld = (): void => held.clear();

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", forgetHeld);
  target.addEventListener("visibilitychange", forgetHeld);
  return {
    dispose: () => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", forgetHeld);
      target.removeEventListener("visibilitychange", forgetHeld);
    },
  };
}
