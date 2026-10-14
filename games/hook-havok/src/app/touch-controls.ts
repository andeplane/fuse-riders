import { TouchInput, type AimMode, type TouchState } from "./touch-input.js";

export interface TouchControls {
  clear(): void;
  enable(value: boolean): void;
  mode(value: AimMode): void;
  destroy(): void;
}
export function createTouchControls(
  root: HTMLElement,
  changed: (state: TouchState) => void,
  activate: () => void,
): TouchControls {
  const model = new TouchInput(),
    abort = new AbortController();
  let enabled = false;
  const pads = (["move", "aim"] as const).map((pad) => {
    const element = root.querySelector<HTMLElement>(`[data-pad="${pad}"]`)!;
    const knob = element.querySelector<HTMLElement>(".thumb-knob")!;
    return { pad, element, knob };
  });
  const paint = () => {
    const state = model.state;
    root.dataset.move = String(state.move);
    root.dataset.jump = String(state.jump);
    root.dataset.fire = String(state.fire);
    pads[1]!.element.dataset.firing = String(state.fire);
    pads[1]!.knob.style.transform = state.fire
      ? `translate(${state.direction.x * 32}px, ${state.direction.y * 32}px)`
      : "";
  };
  const emit = () => {
    paint();
    changed(model.state);
  };
  const clear = () => {
    model.clear();
    for (const { knob } of pads) knob.style.transform = "";
    paint();
  };
  for (const { pad, element, knob } of pads) {
    const update = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) / (box.width / 2);
      const y = (event.clientY - box.top - box.height / 2) / (box.height / 2);
      if (!model.update(pad, event.pointerId, x, y)) return;
      if (pad === "move")
        knob.style.transform = `translate(${Math.max(-1, Math.min(1, x)) * 32}px, ${Math.max(-1, Math.min(1, y)) * 32}px)`;
      emit();
    };
    element.addEventListener(
      "pointerdown",
      (event) => {
        if (!enabled || event.button !== 0) return;
        event.preventDefault();
        if (model.owns(pad, event.pointerId)) return;
        // Only the first thumb takes control from keyboard/mouse. The second must not release it.
        if (root.dataset.active !== "true") {
          activate();
          root.dataset.active = "true";
        }
        if (!model.begin(pad, event.pointerId)) return;
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          model.end(pad, event.pointerId);
          root.dataset.active = String(model.active);
          emit();
          return;
        }
        update(event);
      },
      { signal: abort.signal },
    );
    element.addEventListener(
      "pointermove",
      (event) => {
        if (enabled && model.owns(pad, event.pointerId)) {
          event.preventDefault();
          update(event);
        }
      },
      { signal: abort.signal },
    );
    const end = (event: PointerEvent) => {
      if (model.end(pad, event.pointerId)) {
        knob.style.transform = "";
        root.dataset.active = String(model.active);
        emit();
      }
    };
    for (const name of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      element.addEventListener(name, end, { signal: abort.signal });
    element.addEventListener("contextmenu", (e) => e.preventDefault(), {
      signal: abort.signal,
    });
  }
  return {
    clear() {
      clear();
      root.dataset.active = "false";
    },
    enable(value) {
      enabled = value;
      root.dataset.enabled = String(value);
      if (!value) {
        clear();
        root.dataset.active = "false";
      }
    },
    mode(value) {
      clear();
      root.dataset.active = "false";
      model.mode = value;
    },
    destroy() {
      clear();
      abort.abort();
    },
  };
}
