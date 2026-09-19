import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface SettingsDialogOptions {
  /** The device preferences (music, effects, radio, visual style, fullscreen, privacy), built once by the page. */
  content: HTMLElement;
  /** Voice controls, which VOICE CHAT borrows: SETTINGS takes them back each time it opens. */
  voiceControls?: HTMLElement;
  /** Refreshes what may have changed while it was closed (the privacy choice). */
  beforeOpen: () => void;
  document?: Document;
}

/** SETTINGS: this device's own preferences. Nothing in it is shared with the room. */
export function createSettingsDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: SettingsDialogOptions,
) {
  const shell = createDialogShell({
    title: "SETTINGS",
    label: "Settings",
    ...(options.document ? { document: options.document } : {}),
  });
  dialogs.add("settings", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      options.beforeOpen();
      if (options.voiceControls) options.content.append(options.voiceControls);
      shell.body.replaceChildren(options.content);
      dialogs.open("settings");
    },
  };
}
