import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

/** VOICE CHAT: the voice controls on their own (SETTINGS shows them too, under the device preferences). */
export function createVoiceDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  controls: HTMLElement,
  doc: Document = document,
) {
  const shell = createDialogShell({
    title: "VOICE CHAT",
    label: "Voice chat",
    document: doc,
  });
  dialogs.add("voice", shell.dialog);
  return {
    element: shell.dialog,
    open() {
      shell.body.replaceChildren(controls);
      dialogs.open("voice");
    },
  };
}
