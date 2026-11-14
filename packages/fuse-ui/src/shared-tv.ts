import { el } from "./dom.js";

export interface SharedTvOptionOptions {
  /**
   * The host ticked or cleared the box: send the choice to the room. Returns whether the room took the command; a
   * refusal (the room is not up yet, this is no longer the host) puts the box back.
   */
  onChange: (display: boolean) => boolean;
  /** OPEN TV SCREEN was pressed. */
  onOpenScreen: () => void;
  /** What the box says. */
  label?: string;
  /** Classes besides `fui-room-extra` (a game's own hook for tests or layout). */
  className?: string;
  /** Milliseconds, for how long the box waits for the room's answer; the page's clock by default. */
  now?: () => number;
  document?: Document;
}

export interface SharedTvOption {
  /** Goes in the room layout's `extras`, under the invitation. */
  element: HTMLElement;
  /** What the room says now, and whether this player is the one who chooses (the host, in the lobby, not alone). */
  update(display: boolean, offered: boolean): void;
}

/** How long the box holds the host's choice while the room has not answered yet. */
const ANSWER_MS = 1000;

/**
 * Shared TV, the room's choice made in the room: a checkbox for the host and, while it is on, the button that opens
 * the TV's screen. Every game's room has the same one, so it is never a setting on a main menu.
 *
 * A room answers a command a few ticks later, and until then it still reports the old value. The box keeps the
 * host's choice for that moment instead of flipping back and forth; if the room has not agreed after a second, the
 * box follows the room again.
 */
export function createSharedTvOption(
  options: SharedTvOptionOptions,
): SharedTvOption {
  const doc = options.document,
    now = options.now ?? (() => performance.now()),
    element = el(
      "div",
      "",
      options.className
        ? `fui-room-extra ${options.className}`
        : "fui-room-extra",
      doc,
    ),
    label = el("label", "", "", doc),
    box = el("input", "", "", doc),
    open = el("button", "OPEN TV SCREEN", "fui-room-tv-screen", doc);
  box.type = "checkbox";
  open.type = "button";
  open.hidden = true;
  open.onclick = () => options.onOpenScreen();
  label.append(
    box,
    el(
      "span",
      options.label ?? "Shared TV: phones are the controllers",
      "",
      doc,
    ),
  );
  element.append(label, open);
  element.hidden = true;
  let room = false,
    wish: { display: boolean; until: number } | undefined;
  box.onchange = () => {
    if (options.onChange(box.checked))
      wish = { display: box.checked, until: now() + ANSWER_MS };
    else {
      wish = undefined;
      box.checked = room;
    }
  };
  return {
    element,
    update(display, offered) {
      room = display;
      element.hidden = !offered;
      open.hidden = !display;
      if (wish && (display === wish.display || now() > wish.until))
        wish = undefined;
      if (!wish && box.checked !== display) box.checked = display;
    },
  };
}
