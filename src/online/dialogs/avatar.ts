import { node } from "../dom.js";
import { createAvatarPicker } from "../../client/avatar-heads.js";
import type { AvatarId } from "../../shared/avatars.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface AvatarDialogOptions {
  storage: Pick<Storage, "getItem" | "setItem">;
  /** The name of another rider already wearing this avatar. */
  wornBy: (avatarId: string | undefined) => string | undefined;
  chosen: (avatarId: AvatarId) => void;
}

/** AVATAR: the lobby's avatar picker. It closes on a choice, and the page closes it when the lobby ends. */
export function createAvatarDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: AvatarDialogOptions,
) {
  const shell = createDialogShell({ title: "AVATAR", label: "Avatar" });
  dialogs.add("avatar", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      shell.body.replaceChildren(node("h2", "Your avatar"));
      const picker = createAvatarPicker(options.storage, (chosen) => {
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
      shell.body.append(picker.element);
      dialogs.open("avatar");
    },
  };
}
