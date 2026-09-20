import { showRoomSettings } from "../room-settings-menu.js";
import type { PickupType } from "../../engine/game.js";
import type { RoomSettings } from "../../engine/room-settings.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface RoomSettingsDialogOptions {
  solo: boolean;
  labels: Record<PickupType, string>;
  /** The settings the draft starts from. */
  settings: () => RoomSettings;
  /** Sends a draft to the room; false keeps the dialog open with the draft. */
  save: (draft: RoomSettings) => boolean;
}

/**
 * ROOM SETTINGS: the room's rules, for the host or a solo run. Its bar keeps the GAME MENU title and name the
 * shared dialog showed for it.
 */
export function createRoomSettingsDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: RoomSettingsDialogOptions,
) {
  const shell = createDialogShell({ title: "GAME MENU", label: "Game menu" });
  dialogs.add("roomSettings", shell.dialog);
  return {
    element: shell.dialog,
    open(start: "main" | "powerups" = "main") {
      showRoomSettings(
        shell.body,
        options.settings(),
        options.solo,
        options.labels,
        options.save,
        () => dialogs.close("roomSettings"),
        start,
      );
      dialogs.open("roomSettings");
    },
  };
}
