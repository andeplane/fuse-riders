import { el, partClass, type PartClasses } from "./dom.js";

export type PhoneLayoutPart = "toggle" | "hints" | "open";

const PHONE_LAYOUT_CLASSES: Record<PhoneLayoutPart, string> = {
  toggle: "fui-tools-toggle",
  hints: "fui-control-hints",
  open: "fui-tools-open",
};

/** Where the phone is, as the game's screen decided it. */
export interface PhoneScreen {
  /** The phone is in full-screen play (its own arena, or a controller). */
  active: boolean;
  portrait: boolean;
}

/** Where the match is, in the terms this layout needs. */
export interface PhoneStage {
  /** Any value that changes when the game's phase does; a change is a transition. */
  phase: string;
  /** A round is counting down or running: the tools overlay stays shut and the hints replay. */
  live: boolean;
  /** The results are up: an own-screen phone opens its tools on them. */
  results: boolean;
}

export interface PhoneLayoutOptions {
  /** The page root the toggle and hints are appended to; it carries the open class. */
  root: HTMLElement;
  /** Cancel held input: opening the tools, a rotation, or a new screen must not leave a control held. */
  clearControls(): void;
  /**
   * One label per control zone, left to right. They render from `data-hint` through CSS generated content, so no
   * text node exists for iOS long-press selection or Copy/Look Up callouts.
   */
  hints: readonly string[];
  toggleText?: string;
  /** Dialogs whose closing returns a controller (or live play) to its pads. */
  dialogs?: readonly HTMLDialogElement[];
  classes?: PartClasses<PhoneLayoutPart>;
}

export interface PhoneLayout {
  toggle: HTMLButtonElement;
  hints: HTMLElement;
  /**
   * A new screen: a frame, the room ending, or (`resized`) the viewport changing. A resize cancels held input and may
   * close the tools, but is not a phase transition: the hints do not restart and the results do not open the tools.
   */
  update(
    next: PhoneScreen,
    stage: PhoneStage,
    resized?: boolean,
    controllerOnly?: boolean,
  ): void;
  /** The tools overlay is open over the controls: keys must not steer. */
  blocked(): boolean;
}

/**
 * A phone's full-screen play layout: a MENU toggle that opens the tools over the controls, and control hints that fade
 * in each round. Whether the phone is in play, upright or a controller is the game's decision (its screen); this keeps
 * its own record of the last one and reads none of the page's classes back.
 */
export function createPhoneLayout(options: PhoneLayoutOptions): PhoneLayout {
  const { root, clearControls } = options;
  const doc = root.ownerDocument;
  const c = (part: PhoneLayoutPart) =>
    partClass(PHONE_LAYOUT_CLASSES, options.classes, part);
  let phase = "",
    results = false,
    live = false,
    active = false,
    portrait = false,
    toolsOpen = false,
    controllerOnly = false,
    started = false;
  const toggle = el(
    "button",
    options.toggleText ?? "☰ MENU",
    c("toggle"),
    doc,
  );
  toggle.setAttribute("aria-expanded", "false");
  const hints = el("div", "", c("hints"), doc);
  for (const text of options.hints) {
    const hint = el("span", "", "", doc);
    hint.dataset.hint = text;
    hints.append(hint);
  }
  root.append(hints, toggle);
  // Long presses on the controls must not select text or open the callout; dialogs and fields keep theirs.
  for (const type of ["selectstart", "contextmenu"])
    root.addEventListener(type, (event) => {
      const target = event.target as Node;
      const element =
        target.nodeType === 1 ? (target as Element) : target.parentElement;
      if (active && !element?.closest("dialog,input,textarea,select"))
        event.preventDefault();
    });
  const setTools = (open: boolean) => {
    toolsOpen = open;
    root.classList.toggle(c("open"), open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  const closeTools = () => setTools(false);
  const openTools = () => {
    clearControls();
    setTools(true);
  };
  toggle.onclick = () => {
    clearControls();
    setTools(!toolsOpen);
  };
  // A controller returns to its pads after a dialog; own-screen phones keep tools open in lobby/results.
  for (const dialog of options.dialogs ?? [])
    dialog.addEventListener("close", () => {
      if (controllerOnly || live) closeTools();
    });
  // Entering a round closes the tools and restarts the hint fade (re-appending restarts the CSS animation). Results
  // open an own-screen phone's tools; a controller gets its own rematch screen with the tools closed.
  const enter = () => {
    if (live) {
      closeTools();
      hints.remove();
      root.append(hints);
    } else if (results) {
      if (controllerOnly) {
        clearControls();
        closeTools();
      } else openTools();
    }
  };
  return {
    toggle,
    hints,
    update(next, stage, resized = false, nextControllerOnly = false) {
      controllerOnly = nextControllerOnly;
      const entered =
        !started ||
        stage.phase !== phase ||
        stage.results !== results ||
        !active;
      started = true;
      phase = stage.phase;
      results = stage.results;
      live = stage.live;
      // Rotating cancels held input, but only closes the tools while a round is live: results stay open (#134).
      if (active !== next.active || portrait !== next.portrait) {
        clearControls();
        if (active !== next.active || live) closeTools();
      }
      active = next.active;
      portrait = next.portrait;
      if (entered && active && !resized) enter();
    },
    blocked: () => toolsOpen,
  };
}
