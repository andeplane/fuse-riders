import { el, partClass, type PartClasses } from "./dom.js";

export type JoinByCodePart = "root" | "input" | "button" | "rejoin";

const JOIN_BY_CODE_CLASSES: Record<JoinByCodePart, string> = {
  root: "fui-join-code",
  input: "fui-join-code-input",
  button: "fui-join-code-button",
  rejoin: "fui-join-code-rejoin",
};

export interface JoinByCodeOptions {
  /** Accepts a normalised (trimmed, upper-case) code. The room service's rule, e.g. `validRoomCode`. */
  valid(code: string): boolean;
  /** A valid code was entered. */
  onJoin(code: string): void;
  /** JOIN was pressed with a code `valid` refused; show the message. */
  onInvalid(message: string): void;
  buttonText?: string;
  placeholder?: string;
  invalidMessage?: string;
  maxLength?: number;
  /** The last room this browser was in, one tap away (REJOIN AB42) after JOIN. Omit when there is none. */
  rejoin?: { code: string; onRejoin(code: string): void; title?: string };
  classes?: PartClasses<JoinByCodePart>;
  document?: Document;
}

export interface JoinByCode {
  row: HTMLElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
  rejoin: HTMLButtonElement | undefined;
}

/** A room-code field and JOIN. Enter in the field presses JOIN. The code is trimmed and upper-cased before checks. */
export function createJoinByCode(options: JoinByCodeOptions): JoinByCode {
  const doc = options.document ?? document;
  const c = (part: JoinByCodePart) =>
    partClass(JOIN_BY_CODE_CLASSES, options.classes, part);
  const row = el("div", "", c("root"), doc),
    input = el("input", "", c("input"), doc),
    button = el("button", options.buttonText ?? "JOIN ROOM", c("button"), doc);
  input.placeholder = options.placeholder ?? "Room code";
  input.maxLength = options.maxLength ?? 10;
  input.autocapitalize = "characters";
  input.setAttribute("aria-label", options.placeholder ?? "Room code");
  button.onclick = () => {
    const value = input.value.trim().toUpperCase();
    if (options.valid(value)) options.onJoin(value);
    else
      options.onInvalid(
        options.invalidMessage ?? "Enter a room code, for example AB42",
      );
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") button.click();
  };
  row.append(input, button);
  let rejoin: HTMLButtonElement | undefined;
  if (options.rejoin) {
    const last = options.rejoin;
    rejoin = el("button", `REJOIN ${last.code}`, c("rejoin"), doc);
    if (last.title) rejoin.title = last.title;
    rejoin.onclick = () => last.onRejoin(last.code);
    row.append(rejoin);
  }
  return { row, input, button, rejoin };
}

export interface LandingOptions {
  /** The game's name, the card's heading. */
  title: string;
  /** One line under the title. */
  tagline?: string;
  /** Start a room on the room service; a rejection is shown on the card and CREATE ROOM comes back. */
  onCreate(): Promise<void> | void;
  /** Play alone against bots. Omit to leave SOLO out. */
  onSolo?: () => void;
  /** Join-by-code rules and destination. */
  valid(code: string): boolean;
  onJoin(code: string): void;
  createText?: string;
  soloText?: string;
  document?: Document;
}

export interface LandingCard {
  element: HTMLElement;
  create: HTMLButtonElement;
  solo: HTMLButtonElement | undefined;
  join: JoinByCode;
  /** One `role="alert"` line for create and join failures. */
  error: HTMLElement;
}

/**
 * The first screen of a room game: title, CREATE ROOM, JOIN by code and SOLO. A game with its own landing page (as
 * Fuse Riders has) can use `createJoinByCode` alone.
 */
export function createLandingCard(options: LandingOptions): LandingCard {
  const doc = options.document ?? document;
  const element = el("main", "", "fui-landing", doc),
    heading = el("h1", options.title, "fui-landing-title", doc),
    actions = el("div", "", "fui-landing-actions", doc),
    create = el(
      "button",
      options.createText ?? "CREATE ROOM",
      "fui-button fui-button-primary",
      doc,
    ),
    error = el("p", "", "fui-landing-error", doc);
  create.type = "button";
  error.setAttribute("role", "alert");
  element.append(heading);
  if (options.tagline)
    element.append(el("p", options.tagline, "fui-landing-tagline", doc));
  create.onclick = async () => {
    create.disabled = true;
    error.textContent = "";
    try {
      await options.onCreate();
    } catch (failure) {
      error.textContent =
        failure instanceof Error ? failure.message : String(failure);
    } finally {
      create.disabled = false;
    }
  };
  const join = createJoinByCode({
    valid: options.valid,
    onJoin: (code) => {
      error.textContent = "";
      options.onJoin(code);
    },
    onInvalid: (message) => {
      error.textContent = message;
    },
    document: doc,
  });
  actions.append(create, join.row);
  let solo: HTMLButtonElement | undefined;
  if (options.onSolo) {
    const onSolo = options.onSolo;
    solo = el("button", options.soloText ?? "PLAY SOLO", "fui-button", doc);
    solo.type = "button";
    solo.onclick = () => onSolo();
    actions.append(solo);
  }
  element.append(actions, error);
  return { element, create, solo, join, error };
}
