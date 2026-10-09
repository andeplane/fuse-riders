import { attachGamepads, type GamepadLike } from "./gamepad.js";
import { InputHub } from "./hub.js";
import { attachKeyboard } from "./keyboard.js";
import { attachTouch } from "./touch.js";

/** How one touch zone looks: its caption and (CSS) colour, e.g. the player's colour, or a "JOIN" zone. */
export interface TouchZoneStyle {
  readonly label: string;
  readonly color?: string;
}

export interface BrowserInput {
  readonly hub: InputHub;
  /** Whether this is a touch device (or touch was forced), i.e. whether touch zones can be shown. */
  readonly touchEnabled: boolean;
  /** Show one tap zone per entry along the bottom edge, zone i being `touch:i`. Ignored without touch. */
  setTouchZones(zones: readonly TouchZoneStyle[]): void;
}

/**
 * The one place that touches browser globals: wires the keyboard to `win`, gamepads to `navigator.getGamepads`,
 * and (on touch devices) a DOM overlay of tap zones above the game canvas. `hub.dispose()` undoes all of it.
 */
export function createBrowserInput(
  win: Window = window,
  options: { forceTouch?: boolean } = {},
): BrowserInput {
  const hub = new InputHub();
  const press = hub.press.bind(hub);
  hub.addSource(attachKeyboard(win, press));
  hub.addSource(
    attachGamepads(
      (): readonly (GamepadLike | null)[] => {
        try {
          return typeof win.navigator.getGamepads === "function"
            ? win.navigator.getGamepads()
            : [];
        } catch {
          // A permissions policy can forbid gamepads; then there simply are none.
          return [];
        }
      },
      press,
      hub.command.bind(hub),
    ),
  );

  const touchEnabled =
    options.forceTouch === true || win.navigator.maxTouchPoints > 0;
  if (!touchEnabled)
    return { hub, touchEnabled, setTouchZones: () => undefined };

  const doc = win.document;
  const layer = doc.createElement("div");
  layer.dataset.input = "touch-zones";
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none", // Only the zones take taps; they bubble up to the layer's listener.
    zIndex: "var(--fui-z-bar)",
  });
  doc.body.append(layer);
  const touch = attachTouch(layer, press);
  let styles: readonly TouchZoneStyle[] = [];

  const draw = (): void => {
    const rects = touch.layout();
    layer.replaceChildren(
      ...rects.map((rect, zone) => {
        const style = styles[zone];
        const color = style?.color ?? "var(--fui-cyan)";
        const element = doc.createElement("div");
        element.textContent = style?.label ?? "";
        Object.assign(element.style, {
          position: "absolute",
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          boxSizing: "border-box",
          display: "grid",
          placeItems: "center",
          pointerEvents: "auto",
          border: `var(--fui-stroke) solid ${color}`,
          borderRadius: "var(--fui-radius)",
          background: "var(--fui-panel)",
          opacity: "0.7",
          color,
          font: "0.75rem var(--fui-font-pixel)",
          touchAction: "none",
        });
        return element;
      }),
    );
  };
  win.addEventListener("resize", draw);
  hub.addSource({
    dispose: () => {
      win.removeEventListener("resize", draw);
      touch.dispose?.();
      layer.remove();
    },
  });

  return {
    hub,
    touchEnabled,
    setTouchZones: (zones) => {
      styles = [...zones];
      touch.setZoneCount(styles.length);
      draw();
    },
  };
}
