import { menuKeys } from "fuse-ui";
import { speedLabel } from "./options.js";
import { MAX_SPEED, MIN_SPEED, SPEEDS } from "./prefs.js";

/**
 * The menu over a song that is being played: Escape opens it, alone and in a room.
 *
 * Alone it is a pause: the song stands still behind it. In a room the song is everybody's and keeps playing, so
 * the menu is only this player's own: the host's has RESTART and SONG SELECT, which take the whole room along,
 * and everybody else's has what is theirs to change, their speed, and the way out of the room. The speed is this
 * device's own scroll and never the judge's, so it can change in the middle of a song.
 */
export type PlayMenuKind = "solo" | "host" | "guest";

/** The speed one step slower (`-1`) or faster (`1`) than `speed`, along the speeds the song select offers. */
export function stepSpeed(speed: number, direction: -1 | 1): number {
  const next =
    direction === 1
      ? SPEEDS.find((each) => each > speed + 1e-9)
      : [...SPEEDS].reverse().find((each) => each < speed - 1e-9);
  return next ?? (direction === 1 ? MAX_SPEED : MIN_SPEED);
}

/** The keys that change the speed while a song plays: − is slower, + (the = key) is faster. */
export const SPEED_KEYS: Readonly<Record<string, -1 | 1>> = {
  Minus: -1,
  NumpadSubtract: -1,
  Equal: 1,
  NumpadAdd: 1,
};
/** What the controls list says about them. */
export const SPEED_KEYS_HINT = {
  keys: "− / +",
  action: "Slower or faster arrows, also in the middle of a song",
};

export interface PlayMenuState {
  kind: PlayMenuKind;
  /** The song being played. */
  title: string;
  speed: number;
}

export interface PlayMenuOptions {
  document: Document;
  onResume(): void;
  /** Host and solo: the song from its start, for the whole room. */
  onRestart(): void;
  /** Host and solo: back to the song select, for the whole room. */
  onSelect(): void;
  /** A room's players: out of the room. */
  onLeave(): void;
  /** This device's own speed. */
  onSpeed(speed: number): void;
}

export interface PlayMenu {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  open(state: PlayMenuState): void;
  close(): void;
  /** The speed row shows `speed`. */
  speed(speed: number): void;
  /** A count-in in place of the buttons (a solo RESUME), or the buttons again. */
  count(text: string | undefined): void;
  dispose(): void;
}

export function createPlayMenu(options: PlayMenuOptions): PlayMenu {
  const doc = options.document;
  const el = (tag: string, text = "", className = "") => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text: string, className: string) => {
    const node = el("button", text, className) as HTMLButtonElement;
    node.type = "button";
    return node;
  };
  const root = el("section", "", "fm-pause"),
    title = el("h2", "PAUSED"),
    song = el("p", "", "fm-pause-song"),
    state = el("p", "", "fm-pause-state"),
    count = el("strong", "", "fm-pause-count"),
    actions = el("div", "", "fm-actions fm-pause-actions"),
    resume = button("RESUME", "fui-button-primary fm-pause-resume"),
    restart = button("RESTART", "fui-button fm-pause-restart"),
    select = button("SONG SELECT", "fui-button fm-pause-select"),
    speedRow = el("div", "", "fm-pause-speed"),
    slower = button("−", "fui-button fm-pause-slower"),
    speedText = el("b", "", "fm-pause-speed-value"),
    faster = button("+", "fui-button fm-pause-faster"),
    leave = button("LEAVE ROOM", "fui-button fm-pause-leave"),
    hint = el("p", "", "fm-pause-hint");
  root.setAttribute("role", "dialog");
  state.setAttribute("role", "status");
  slower.setAttribute("aria-label", "Slower arrows");
  faster.setAttribute("aria-label", "Faster arrows");
  speedText.setAttribute("aria-live", "polite");
  speedRow.append(slower, speedText, faster);
  actions.append(resume, restart, select, speedRow, leave);
  root.append(title, song, state, count, actions, hint);
  root.hidden = count.hidden = true;

  let current = 1;
  const showSpeed = (value: number) => {
    current = value;
    speedText.textContent = `SPEED ${speedLabel(value)}`;
    slower.disabled = value <= MIN_SPEED;
    faster.disabled = value >= MAX_SPEED;
  };
  const change = (direction: -1 | 1) => {
    const next = stepSpeed(current, direction);
    if (next === current) return;
    // The end of the range turns its button off: the focus moves to the one that still works.
    const focused = doc.activeElement === (direction === 1 ? faster : slower);
    options.onSpeed(next);
    showSpeed(next);
    if (focused && (direction === 1 ? faster : slower).disabled)
      (direction === 1 ? slower : faster).focus();
  };
  resume.onclick = () => options.onResume();
  restart.onclick = () => options.onRestart();
  select.onclick = () => options.onSelect();
  leave.onclick = () => options.onLeave();
  slower.onclick = () => change(-1);
  faster.onclick = () => change(1);
  // On the speed row Left and Right are the speed itself; Up and Down still walk the menu.
  speedRow.addEventListener("keydown", (event) => {
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    change(direction);
  });
  // Arrows walk the buttons, Enter presses the one in focus. The speed row is one stop: the side last used.
  const stopKeys = menuKeys(actions, {
    document: doc,
    items: () => [
      resume,
      restart,
      select,
      doc.activeElement === slower || faster.disabled ? slower : faster,
      leave,
    ],
  });
  return {
    element: root,
    get isOpen() {
      return !root.hidden;
    },
    open(next) {
      const room = next.kind !== "solo";
      root.classList.toggle("fm-pause-room", room);
      title.textContent = room ? "MENU" : "PAUSED";
      root.setAttribute("aria-label", room ? "Menu" : "Paused");
      song.textContent = next.title;
      state.textContent =
        next.kind === "host"
          ? "The song keeps playing. Restart and Song select take everyone along."
          : next.kind === "guest"
            ? "The song keeps playing. Only the host can restart it or change the song."
            : "";
      state.hidden = !room;
      restart.hidden = select.hidden = next.kind === "guest";
      restart.textContent = room ? "RESTART FOR EVERYONE" : "RESTART";
      select.textContent = room ? "SONG SELECT FOR EVERYONE" : "SONG SELECT";
      leave.hidden = !room;
      hint.textContent = room ? "ESC CLOSES" : "ESC RESUMES";
      showSpeed(next.speed);
      count.hidden = true;
      actions.hidden = hint.hidden = false;
      root.hidden = false;
      resume.focus();
    },
    close() {
      root.hidden = true;
    },
    speed: showSpeed,
    count(text) {
      count.hidden = text === undefined;
      actions.hidden = hint.hidden = text !== undefined;
      if (text !== undefined) count.textContent = text;
    },
    dispose: stopKeys,
  };
}

/** How long a flash stays, ms. */
export const FLASH_MS = 1600;

/**
 * A line that shows for a moment over whatever the page has: the speed that was just set, or what the host just
 * did to the room. It keeps no timer of its own: the page's frame tells it the time.
 */
export interface Flash {
  readonly element: HTMLElement;
  show(text: string, now: number): void;
  /** Takes the line away once its time is up. */
  frame(now: number): void;
}

export function createFlash(document: Document): Flash {
  const element = document.createElement("p");
  element.className = "fm-flash";
  element.setAttribute("role", "status");
  element.hidden = true;
  let until = 0;
  return {
    element,
    show(text, now) {
      element.textContent = text;
      element.hidden = false;
      until = now + FLASH_MS;
    },
    frame(now) {
      if (!element.hidden && now >= until) element.hidden = true;
    },
  };
}

/** A guest's line when the song they were in ended early: only the host can have done it. */
export const HOST_TO_SELECT = "THE HOST WENT BACK TO SONG SELECT",
  HOST_RESTARTED = "THE HOST RESTARTED THE SONG";
/** A song that starts again this soon after the host left it is the same song restarted, ms. */
export const RESTART_WINDOW_MS = 4000;

/**
 * What to tell a player who is not the host when the room's stage moves: the host left the song for the song
 * select, or restarted it (a restart is the song select for a moment, then the song again).
 */
export function createHostWatch(): (
  stage: string,
  now: number,
) => string | undefined {
  let last = "",
    leftAt = Number.NEGATIVE_INFINITY;
  return (stage, now) => {
    const before = last;
    last = stage;
    if (before === "running" && stage === "lobby") {
      leftAt = now;
      return HOST_TO_SELECT;
    }
    if (stage === "running" && before === "lobby") {
      const restarted = now - leftAt < RESTART_WINDOW_MS;
      leftAt = Number.NEGATIVE_INFINITY;
      if (restarted) return HOST_RESTARTED;
    }
    return undefined;
  };
}
