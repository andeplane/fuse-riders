import { createKeyList } from "fuse-ui";
import { node } from "../dom.js";
import {
  keyboardShortcuts,
  type ShortcutGroup,
} from "../keyboard-shortcuts.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface ShortcutsDialogOptions {
  mac: boolean;
  solo: boolean;
  /** Whoever runs the room (or a solo run) may open ROOM SETTINGS, so its keys are listed. */
  canConfigure: () => boolean;
  document?: Document;
  /** Local players replace the single rider's standard driving keys. */
  driving?: readonly ShortcutGroup[];
}

/** SHORTCUTS: the ? button's keyboard reference (#168). */
export function createShortcutsDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: ShortcutsDialogOptions,
) {
  const doc = options.document ?? document;
  const shell = createDialogShell({
    title: "SHORTCUTS",
    label: "Keyboard shortcuts",
    document: doc,
  });
  dialogs.add("shortcuts", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      const groups = keyboardShortcuts({
        mac: options.mac,
        canConfigure: options.canConfigure(),
        solo: options.solo,
      });
      if (options.driving) groups.splice(0, 1, ...options.driving);
      shell.body.replaceChildren(
        node("h2", "Keyboard shortcuts", "", doc),
        ...createKeyList(groups, {
          classes: { group: "shortcut-group", list: "shortcut-list" },
          document: doc,
        }),
      );
      dialogs.open("shortcuts");
    },
  };
}
