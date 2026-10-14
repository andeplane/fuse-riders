import { DOWN, FIRE, LEFT, RIGHT, UP } from "../../engine/input.js";
import { attachGamepads, type GamepadLike } from "./gamepad.js";
import { InputHub } from "./hub.js";
import { attachKeyboard } from "./keyboard.js";
import {
  TOUCH_SIDES,
  attachTouch,
  type PadLayout,
  type Rect,
} from "./touch.js";

/** How one side's touch pad looks: its FIRE button's caption and (CSS) colour, e.g. the player's, or "JOIN". */
export interface TouchPadStyle {
  readonly label: string;
  readonly color?: string;
}

export interface BrowserInput {
  readonly hub: InputHub;
  /** Whether this is a touch device (or touch was forced), i.e. whether touch pads can be shown. */
  readonly touchEnabled: boolean;
  /**
   * Show a D-pad and FIRE button for each side that has a style: entry 0 bottom left (`touch:0`), entry 1 bottom
   * right (`touch:1`); a missing entry hides that side. `layout` places them (a phone controller's are bigger).
   * Ignored without touch.
   */
  setTouchPads(
    pads: readonly (TouchPadStyle | undefined)[],
    layout?: PadLayout,
  ): void;
}

/** The D-pad's arrows: their cell in its 3 × 3 grid and the bit each lights up for. */
const ARROWS: readonly [cell: number, glyph: string, bit: number][] = [
  [1, "▲", UP],
  [3, "◀", LEFT],
  [5, "▶", RIGHT],
  [7, "▼", DOWN],
];

/**
 * The one place that touches browser globals: wires the keyboard to `win`, gamepads to `navigator.getGamepads`,
 * and (on touch devices) a DOM overlay of touch pads above the game canvas. `hub.dispose()` undoes all of it.
 */
export function createBrowserInput(
  win: Window = window,
  options: { forceTouch?: boolean; singleKeyboard?: boolean } = {},
): BrowserInput {
  const hub = new InputHub();
  const hold = hub.setHeld.bind(hub);
  hub.addSource(
    attachKeyboard(win, hold, {
      arrowsPrimary: () =>
        options.singleKeyboard === true ||
        (hub.slotOf("key:WASD") !== undefined &&
          hub.slotOf("key:ARROWS") === undefined),
    }),
  );
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
      hold,
      hub.command.bind(hub),
    ),
  );

  const touchEnabled =
    options.forceTouch === true || win.navigator.maxTouchPoints > 0;
  if (!touchEnabled)
    return { hub, touchEnabled, setTouchPads: () => undefined };

  const doc = win.document;
  const layer = doc.createElement("div");
  layer.dataset.input = "touch-pads";
  const inset = (side: string) => `env(safe-area-inset-${side}, 0px)`;
  Object.assign(layer.style, {
    position: "fixed",
    inset: ["top", "right", "bottom", "left"].map(inset).join(" "), // Clear of notches and the home bar.
    pointerEvents: "none", // Only the pads take touches; they bubble up to the layer's listeners.
    zIndex: "var(--fui-z-bar)",
  });
  layer.addEventListener("contextmenu", (event) => event.preventDefault()); // No long-press menu.
  doc.body.append(layer);
  let styles: readonly (TouchPadStyle | undefined)[] = [];

  const control = (round: boolean): HTMLElement => {
    const element = doc.createElement("div");
    Object.assign(element.style, {
      position: "absolute",
      boxSizing: "border-box",
      display: "none",
      placeItems: "center",
      pointerEvents: "auto",
      borderRadius: round ? "50%" : "var(--fui-radius)",
      background: "color-mix(in srgb, var(--fui-panel) 55%, transparent)",
      font: "0.75rem var(--fui-font-pixel)",
      touchAction: "none",
      webkitUserSelect: "none",
      userSelect: "none",
    });
    layer.append(element);
    return element;
  };
  // Each side's elements live as long as the layer, restyled in place, so a held finger never loses its capture.
  const pads = Array.from({ length: TOUCH_SIDES }, () => {
    const dpad = control(false);
    dpad.style.gridTemplate = "repeat(3, 1fr) / repeat(3, 1fr)";
    const cells = Array.from({ length: 9 }, () => doc.createElement("span"));
    for (const [cell, glyph] of ARROWS)
      if (cells[cell]) cells[cell].textContent = glyph;
    dpad.append(...cells);
    return { dpad, cells, fire: control(true) };
  });

  /** Light up what `side` holds now. */
  const paint = (side: number): void => {
    const pad = pads[side];
    if (!pad) return;
    const bits = hub.heldBy(`touch:${side}`);
    const color = styles[side]?.color ?? "var(--fui-cyan)";
    const lit = (on: boolean, glow: string) => ({
      color: on ? "var(--fui-text)" : color,
      textShadow: on ? `0 0 8px ${color}` : "none",
      boxShadow: on ? glow : "none",
    });
    for (const [cell, , bit] of ARROWS)
      Object.assign(pad.cells[cell]?.style ?? {}, {
        ...lit((bits & bit) !== 0, "none"),
        opacity: bits & bit ? "1" : "0.5",
      });
    const glow = `0 0 16px ${color}, inset 0 0 24px ${color}`;
    Object.assign(pad.fire.style, lit((bits & FIRE) !== 0, glow));
  };
  const place = (element: HTMLElement, rect: Rect | undefined, color: string) =>
    Object.assign(element.style, {
      display: rect ? "grid" : "none",
      left: `${rect?.x ?? 0}px`,
      top: `${rect?.y ?? 0}px`,
      width: `${rect?.width ?? 0}px`,
      height: `${rect?.height ?? 0}px`,
      fontSize: `${Math.max(12, (rect?.width ?? 0) / 14)}px`, // a phone controller's big pads, big glyphs
      border: `var(--fui-stroke) solid ${color}`,
      color,
    });
  const touch = attachTouch(
    layer,
    (device, bits) => {
      hub.setHeld(device, bits);
      paint(Number(device.slice("touch:".length)));
    },
    win,
  );
  const draw = (): void => {
    const layout = touch.layout();
    pads.forEach((pad, side) => {
      const at = layout.find((p) => p.side === side);
      const color = styles[side]?.color ?? "var(--fui-cyan)";
      place(pad.dpad, at?.dpad, color);
      place(pad.fire, at?.fire, color);
      pad.fire.textContent = styles[side]?.label ?? "FIRE";
      paint(side);
    });
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
    setTouchPads: (next, layout) => {
      styles = [...next];
      touch.setSides(
        styles.flatMap((style, side) => (style ? [side] : [])),
        layout,
      );
      draw();
    },
  };
}
