import { node } from "../dom.js";
import type { AvatarId } from "../../engine/avatar-id.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface AvatarDialogOptions {
  storage: Pick<Storage, "getItem" | "setItem">;
  /** The rider already wearing this avatar: their name, and the colour to ring the head in. */
  wornBy: (
    avatarId: string | undefined,
  ) => { name: string; color: string } | undefined;
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
      // A head another rider wears is disabled, not merely marked: the room keeps heads unique, so the pick would be
      // refused and offering it would be a lie. It is ringed in its owner's colour, which points at the colour grid
      // where that colour wears this head — between them you can see who took what (ADR 027).
      picker.element
        .querySelectorAll<HTMLButtonElement>(".avatar-option")
        .forEach((option) => {
          const owner = options.wornBy(option.dataset.avatarId);
          option.classList.toggle("taken", owner !== undefined);
          option.disabled = owner !== undefined;
          option.title = owner ? `Taken by ${owner.name}` : "";
          if (owner) option.style.setProperty("--owner-color", owner.color);
          else option.style.removeProperty("--owner-color");
        });
      shell.body.replaceChildren(
        node("h2", "Your avatar", "", doc),
        picker.element,
      );
      dialogs.open("avatar");
    },
  };
}
