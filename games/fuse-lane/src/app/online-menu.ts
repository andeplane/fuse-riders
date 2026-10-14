import { button, createJoinByCode, el } from "fuse-ui";
import { AVATARS, isAvatar, seatName } from "../game/index.js";
import type { Art } from "./art.js";
import type { Store } from "./session.js";

/**
 * The menu's PLAY ONLINE side, the way Fuse Riders does rooms: CREATE ROOM (each on their own device, or a shared TV
 * with phones as the controllers), a code to join, and REJOIN for the last room. The name and face picked here are
 * the ones the room seats.
 */
export type OnlineMode = "devices" | "shared";

export interface OnlineKeys {
  name: string;
  avatar: string;
  shared: string;
  last: string;
}

export interface OnlineOptions {
  art: Art;
  store: Store;
  keys: OnlineKeys;
  valid(code: string): boolean;
  /** Creates a room and goes to it; a rejection's message is shown and CREATE ROOM comes back. */
  onCreate(mode: OnlineMode): Promise<void>;
  onJoin(code: string): void;
}

/** The face remembered for rooms, or the first one. */
export function storedFace(store: Store, key: string): string {
  const value = safeGet(store, key);
  return isAvatar(value) ? value : "fox";
}
/** The face after `avatar` in the picker's order. */
export function nextFace(avatar: string): string {
  const at = (AVATARS as readonly string[]).indexOf(avatar);
  return AVATARS[(at + 1) % AVATARS.length]!;
}
/** The remembered room code, when it still looks like one. */
export function lastRoom(
  store: Store,
  key: string,
  valid: (code: string) => boolean,
): string | undefined {
  const code = safeGet(store, key)?.trim().toUpperCase();
  return code && valid(code) ? code : undefined;
}

export function createOnlineSheet(options: OnlineOptions): HTMLElement {
  const { art, store, keys } = options;
  const save = (key: string, value: string) => {
    try {
      store.setItem(key, value);
    } catch {
      /* not remembered: the room asks again */
    }
  };
  const sheet = el("section", "", "fl-sheet fl-online");
  const field = (title: string, hint: string, ...body: HTMLElement[]) => {
    const block = el("div", "", "fl-field");
    block.append(el("h2", title, "fl-menu-title"));
    if (hint) block.append(el("p", hint, "fl-hint"));
    block.append(...body);
    return block;
  };

  // You: the face and name the room seats.
  let face = storedFace(store, keys.avatar);
  const you = el("div", "", "fl-person"),
    faceButton = button("", "fl-person-face"),
    name = el("input", "", "fl-person-name");
  const drawFace = () => {
    faceButton.replaceChildren(art.element(`avatar-${face}-portrait`, 44));
    faceButton.setAttribute("aria-label", "Change your character");
  };
  faceButton.onclick = () => {
    face = nextFace(face);
    save(keys.avatar, face);
    drawFace();
  };
  name.value = seatName(safeGet(store, keys.name) ?? "") ?? "";
  name.placeholder = "Your name";
  name.maxLength = 16;
  name.autocomplete = "off";
  name.setAttribute("aria-label", "Your name");
  const keepName = () => {
    const clean = seatName(name.value);
    if (clean) save(keys.name, clean);
  };
  name.onchange = keepName;
  you.append(faceButton, name);
  drawFace();

  // Where: each on their own device, or one TV with phones.
  let mode: OnlineMode =
    safeGet(store, keys.shared) === "1" ? "shared" : "devices";
  const modes = el("div", "", "fl-segmented fl-online-mode"),
    modeHint = el("p", "", "fl-hint fl-mode-hint");
  const modeButtons = (
    [
      ["devices", "EACH ON THEIR OWN DEVICE"],
      ["shared", "SHARED TV"],
    ] as const
  ).map(([value, label]) => {
    const choice = button(label, "fl-segment");
    choice.onclick = () => {
      mode = value;
      save(keys.shared, value === "shared" ? "1" : "0");
      drawMode();
    };
    modes.append(choice);
    return { value, choice };
  });
  const drawMode = () => {
    for (const { value, choice } of modeButtons) {
      choice.classList.toggle("on", value === mode);
      choice.setAttribute("aria-pressed", String(value === mode));
    }
    modeHint.textContent =
      mode === "shared"
        ? "This screen shows the town for everyone; each player plays from their own phone."
        : "Everyone plays on their own phone or computer, here or far away.";
  };
  drawMode();

  const error = el("p", "", "fl-online-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  const create = button("CREATE ROOM", "fui-button-primary fl-create-room");
  create.onclick = async () => {
    keepName();
    error.hidden = true;
    create.disabled = true;
    create.textContent = "CREATING ROOM…";
    try {
      await options.onCreate(mode);
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : String(reason));
      create.disabled = false;
      create.textContent = "CREATE ROOM";
    }
  };

  const last = lastRoom(store, keys.last, options.valid);
  const join = createJoinByCode({
    valid: options.valid,
    onJoin: (code) => {
      keepName();
      options.onJoin(code);
    },
    onInvalid: fail,
    buttonText: "JOIN",
    placeholder: "Room code",
    invalidMessage: "Type the room's code, for example AB42",
    ...(last
      ? {
          rejoin: {
            code: last,
            title: "Back to the room you were in last",
            onRejoin: (code: string) => options.onJoin(code),
          },
        }
      : {}),
    classes: { root: "fl-join", input: "", button: "", rejoin: "fl-rejoin" },
  });

  sheet.append(
    field(
      "YOU",
      "Tap the face to change character. The room seats you with this name.",
      you,
    ),
    field("WHERE WILL YOU PLAY?", "", modes, modeHint),
    field(
      "START A ROOM",
      "Everyone plays the same week at the same time. Jobs and shelves are shared: first come, first served.",
      create,
    ),
    field("GOT A CODE?", "", join.row),
    error,
  );
  return sheet;
}

function safeGet(store: Store, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
