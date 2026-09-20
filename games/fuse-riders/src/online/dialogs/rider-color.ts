import { node } from "../dom.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

/** What the room already knows about a colour: who wears it, and the head they wear with it. */
export interface ColorOwner {
  name: string;
  avatarId: string;
}

export interface ColorDialogOptions {
  storage: Pick<Storage, "getItem" | "setItem">;
  /** The rider already wearing this colour, when it is not this one's. */
  wornBy: (color: string | undefined) => ColorOwner | undefined;
  chosen: (color: string) => void;
  /** Builds the picker (`createColorPicker`); it is passed in, so this module stays free of the page's DOM. */
  picker: (
    storage: Pick<Storage, "getItem" | "setItem">,
    onChange: (color: string) => void,
  ) => { element: HTMLElement };
  /** The owner's head as a badge on a taken swatch (`createAvatarPortrait`), so the grid says who took it. */
  portrait: (avatarId: string) => HTMLElement;
  document?: Document;
}

/**
 * COLOUR: the lobby's colour picker, the avatar dialog's twin. It closes on a choice, and the page closes it when the
 * lobby ends. A colour another rider wears is disabled rather than merely marked — the room would refuse the pick, so
 * offering it would be a lie — and wears that rider's head as a badge, which points back at the avatar grid where the
 * same head is ringed in this colour.
 */
export function createColorDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: ColorDialogOptions,
) {
  const doc = options.document ?? document;
  const shell = createDialogShell({
    title: "COLOUR",
    label: "Colour",
    document: doc,
  });
  dialogs.add("riderColor", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      const picker = options.picker(options.storage, (chosen) => {
        options.chosen(chosen);
        dialogs.close("riderColor");
      });
      picker.element
        .querySelectorAll<HTMLButtonElement>(".color-option")
        .forEach((option) => {
          const owner = options.wornBy(option.dataset.riderColor);
          option.classList.toggle("taken", owner !== undefined);
          option.disabled = owner !== undefined;
          option.title = owner ? `Taken by ${owner.name}` : "";
          option.querySelector(".owner-head")?.remove();
          if (!owner) return;
          const head = options.portrait(owner.avatarId);
          head.classList.remove("avatar-portrait");
          head.classList.add("owner-head");
          option.append(head);
        });
      shell.body.replaceChildren(
        node("h2", "Your colour", "", doc),
        picker.element,
      );
      dialogs.open("riderColor");
    },
  };
}
