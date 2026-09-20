import { createNameEntry, el } from "fuse-ui";
import { createAvatarPicker } from "../client/avatar-heads.js";
import { createColorPicker, riderColorIndex } from "../client/rider-colors.js";
import type { SafeStorage } from "../client/safe-storage.js";
import type { AvatarId } from "../shared/avatars.js";
import { MAX_LOGGED_NAME_UNITS, seatRiderName } from "../engine/rider-name.js";
const NAME_KEY = "fuse-riders-player-name";
type Storage = Pick<SafeStorage, "getItem" | "setItem">;
/**
 * Name, avatar and JOIN, on fuse-ui's name entry with the avatar picker in its slot. Every rider confirms these before
 * taking a seat: a remembered name prefills the field, it never joins by itself. A signed-in rider rides under their
 * account's username: the field shows it and is not editable here, so they are the same name in every room and on
 * every device. It is changed where the account lives, under MY GAMES on the home page.
 *
 * `onSpectate` adds the second way in, under the first: watch the room by name without taking one of its five seats.
 */
export function createJoinForm(
  storage: Storage,
  onJoin: (name: string, avatarId: AvatarId, colorIndex: number) => void,
  accountName?: string,
  onSpectate?: (name: string) => void,
) {
  // The ten avatars stay folded away (#142): the rider sees the one they have, and CHANGE opens the grid until a pick closes it.
  const picker = createAvatarPicker(storage, undefined, {
    id: `avatar-picker-${Math.random().toString(36).slice(2)}`,
  });
  // Colour is the avatar row's twin, folded the same way: both are settled before the seat is claimed. Neither is a
  // promise — the room keeps both unique, so a rider whose choice is already worn is seated in the nearest free one.
  const colors = createColorPicker(storage, undefined, {
    id: `color-picker-${Math.random().toString(36).slice(2)}`,
  });
  /** What the room would seat, remembered so the field, the stored name and the seat are the same text. */
  const remember = (value: string) => {
    if (!entry.fixed()) storage.setItem(NAME_KEY, value);
    return value;
  };
  const entry = createNameEntry({
    normalize: (raw) => seatRiderName(raw) ?? "",
    // In UTF-16 units, like the attribute: nothing longer can be seated. The room cuts what is typed to the rider-name rule.
    maxLength: MAX_LOGGED_NAME_UNITS,
    initial: storage.getItem(NAME_KEY) ?? "",
    buttonText: "JOIN AS PLAYER",
    // A tap on JOIN with no name used to do nothing at all (#132): the hint says what is missing instead.
    missingText: "Enter your name to join",
    disabled: true,
    // The name is remembered as it is typed, so a page that reloads before JOIN is tapped keeps it rather than an empty field.
    onInput: (value) => {
      if (value && !entry.fixed()) storage.setItem(NAME_KEY, value);
    },
    onSubmit: (value) =>
      onJoin(
        remember(value),
        picker.selected(),
        riderColorIndex(colors.selected()),
      ),
    // The quieter second way in: same name, no seat. Solo has no room to watch, so it stays hidden there.
    secondary: {
      text: "JOIN AS SPECTATOR",
      title: "Watch the room without taking a seat",
      onSubmit: (value) => onSpectate?.(remember(value)),
    },
    // The note follows the buttons and spans the row like the hint: between name and button it took the grid's auto column and crushed both.
    note: {
      id: "join-account-note",
      text: "Your account name. Change it under MY GAMES on the home page.",
    },
    extra: [picker.summary!, picker.element, colors.summary!, colors.element],
    classes: {
      root: "fui-name-entry online-join",
      input: "",
      submit: "",
      secondary: "join-spectate",
      note: "join-account",
      hint: "join-hint",
    },
  });
  const spectate = entry.secondary!;
  spectate.hidden = !onSpectate;
  // Also called late: a browser that is signed in but has not seen its username yet learns it while the form is up.
  const useAccountName = (value: string) => entry.fix(value);
  if (accountName) useAccountName(accountName);
  return {
    element: entry.form,
    submitButton: entry.submit,
    spectateButton: spectate,
    picker,
    colors,
    ready() {
      entry.setDisabled(false);
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
  const card = el("section", "", "room-join");
  card.setAttribute("aria-label", `Join room ${code}`);
  card.append(
    el("p", "JOIN THE ROOM", "room-eyebrow"),
    el("strong", code, "shared-room-code"),
    form,
    note,
  );
  return card;
}
