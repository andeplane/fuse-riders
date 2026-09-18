import {
  createAvatarPicker,
  createAvatarPortrait,
} from "../client/avatar-heads.js";
import type { SafeStorage } from "../client/safe-storage.js";
import { AVATARS, type AvatarId } from "../shared/avatars.js";
import { MAX_LOGGED_NAME_UNITS, seatRiderName } from "../engine/rider-name.js";
const NAME_KEY = "fuse-riders-player-name";
type Storage = Pick<SafeStorage, "getItem" | "setItem">;
/**
 * Name, avatar and JOIN. Every rider confirms these before taking a seat: a remembered name prefills the field, it never joins by itself.
 * A signed-in rider rides under their account's username: the field shows it and is not editable here, so they are the same name in
 * every room and on every device. It is changed where the account lives, under MY GAMES on the home page.
 *
 * `onSpectate` adds the second way in, under the first: watch the room by name without taking one of its five seats.
 */
export function createJoinForm(
  storage: Storage,
  onJoin: (name: string, avatarId: AvatarId) => void,
  accountName?: string,
  onSpectate?: (name: string) => void,
) {
  const form = document.createElement("form");
  form.className = "online-join";
  const name = document.createElement("input");
  name.placeholder = "Your name";
  // In UTF-16 units, like the attribute: nothing longer can be seated. The room cuts what is typed to the rider-name rule.
  name.maxLength = MAX_LOGGED_NAME_UNITS;
  name.setAttribute("aria-required", "true");
  name.setAttribute("autocomplete", "nickname");
  name.setAttribute("aria-label", "Your name");
  name.value = storage.getItem(NAME_KEY) ?? "";
  const account = document.createElement("p");
  account.className = "join-account";
  account.id = "join-account-note";
  account.hidden = true;
  account.textContent =
    "Your account name. Change it under MY GAMES on the home page.";
  // Also called late: a browser that is signed in but has not seen its username yet learns it while the form is up.
  const useAccountName = (value: string) => {
    accountName = value;
    name.value = value;
    name.readOnly = true;
    name.setAttribute("aria-describedby", account.id);
    account.hidden = false;
    hint.hidden = true;
    name.removeAttribute("aria-invalid");
  };
  // The ten avatars stay folded away (#142): the rider sees the one they have, and CHANGE opens the grid until a pick closes it.
  const current = document.createElement("button");
  current.type = "button";
  current.className = "avatar-current";
  const fold = (open: boolean) => {
    picker.element.hidden = !open;
    current.setAttribute("aria-expanded", String(open));
  };
  const show = (id: AvatarId) => {
    const label = AVATARS.find((avatar) => avatar.id === id)?.label ?? "Robot";
    const text = document.createElement("span"),
      change = document.createElement("span");
    text.textContent = `Avatar · ${label}`;
    change.className = "avatar-change";
    change.textContent = "CHANGE";
    current.replaceChildren(createAvatarPortrait(id), text, change);
    current.setAttribute("aria-label", `Avatar · ${label}, change`);
  };
  const picker = createAvatarPicker(storage, (chosen) => {
    show(chosen);
    fold(false);
    current.focus();
  });
  picker.element.id = `avatar-picker-${Math.random().toString(36).slice(2)}`;
  current.setAttribute("aria-controls", picker.element.id);
  current.onclick = () => fold(picker.element.hidden);
  show(picker.selected());
  fold(false);
  const button = document.createElement("button");
  button.textContent = "JOIN AS PLAYER";
  button.disabled = true;
  // A tap on JOIN with no name used to do nothing at all (#132): say what is missing instead of a silent no-op.
  const hint = document.createElement("p");
  hint.className = "join-hint";
  hint.setAttribute("role", "alert");
  hint.textContent = "Enter your name to join";
  hint.hidden = true;
  // The quieter second way in: same name, no seat. A plain button, never the form's submit, so Enter still joins as a player.
  const spectate = document.createElement("button");
  spectate.type = "button";
  spectate.className = "join-spectate";
  spectate.textContent = "JOIN AS SPECTATOR";
  spectate.title = "Watch the room without taking a seat";
  spectate.disabled = true;
  spectate.hidden = !onSpectate;
  // The note follows the button and spans the row like the hint: between name and button it took the grid's auto column and crushed both.
  form.append(name, button, account, hint, current, picker.element);
  if (onSpectate) button.after(spectate);
  if (accountName) useAccountName(accountName);
  // The name is remembered as it is typed, so a page that reloads before JOIN is tapped keeps it rather than an empty field.
  name.addEventListener("input", () => {
    const value = name.value.trim();
    if (value && !accountName) storage.setItem(NAME_KEY, value);
    hint.hidden = true;
    name.removeAttribute("aria-invalid");
  });
  /** What the room would seat, so the field, the remembered name and the seat are the same text. */
  const confirmedName = (): string | undefined => {
    const value = seatRiderName(name.value);
    if (!value) {
      hint.hidden = false;
      name.setAttribute("aria-invalid", "true");
      name.focus();
      return;
    }
    name.value = value;
    if (!accountName) storage.setItem(NAME_KEY, value);
    return value;
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const value = confirmedName();
    if (value) onJoin(value, picker.selected());
  };
  spectate.onclick = () => {
    const value = confirmedName();
    if (value) onSpectate!(value);
  };
  return {
    element: form,
    submitButton: button,
    spectateButton: spectate,
    picker: {
      ...picker,
      sync(id: AvatarId) {
        picker.sync(id);
        show(id);
      },
    },
    ready() {
      button.disabled = spectate.disabled = false;
    },
    useAccountName,
  };
}
/** The joiner's whole pre-seat page: room code over the form. Hosts get the bare form inside their lobby instead. */
export function createJoinCard(
  code: string,
  form: HTMLElement,
  note: HTMLElement,
): HTMLElement {
  const card = document.createElement("section");
  card.className = "room-join";
  card.setAttribute("aria-label", `Join room ${code}`);
  const eyebrow = document.createElement("p");
  eyebrow.className = "room-eyebrow";
  eyebrow.textContent = "JOIN THE ROOM";
  const roomCode = document.createElement("strong");
  roomCode.className = "shared-room-code";
  roomCode.textContent = code;
  card.append(eyebrow, roomCode, form, note);
  return card;
}
