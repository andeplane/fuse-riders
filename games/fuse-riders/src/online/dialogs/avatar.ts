import { node } from "../dom.js";
import type { AvatarId } from "../../shared/avatars.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface AvatarDialogOptions {
  storage: Pick<Storage, "getItem" | "setItem">;
  /** The name of another rider already wearing this avatar. */
  wornBy: (avatarId: string | undefined) => string | undefined;
  chosen: (avatarId: AvatarId) => void;
  /** Builds the picker (`createAvatarPicker`); it is passed in, so this module stays free of the page's DOM. */
  picker: (
    storage: Pick<Storage, "getItem" | "setItem">,
    onChange: (avatarId: AvatarId) => void,
  ) => { element: HTMLElement };
  document?: Document;
}

/** AVATAR: the lobby's avatar picker. It closes on a choice, and the page closes it when the lobby ends. */
export function createAvatarDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: AvatarDialogOptions,
) {
  const doc = options.document ?? document;
  const shell = createDialogShell({
    title: "AVATAR",
    label: "Avatar",
    document: doc,
  });
  dialogs.add("avatar", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      const picker = options.picker(options.storage, (chosen) => {
        options.chosen(chosen);
        dialogs.close("avatar");
      });
      // Avatars other riders already wear are marked, not blocked: two foxes are allowed, but nobody picks one by accident.
      picker.element
        .querySelectorAll<HTMLButtonElement>(".avatar-option")
        .forEach((option) => {
          const owner = options.wornBy(option.dataset.avatarId);
          option.classList.toggle("taken", owner !== undefined);
          option.title = owner !== undefined ? `${owner} has this one` : "";
        });
      shell.body.replaceChildren(
        node("h2", "Your avatar", "", doc),
        picker.element,
      );
      dialogs.open("avatar");
    },
  };
}
