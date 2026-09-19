import { node } from "../dom.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

/** The page's one radio (`createGameAudio`): its panel moves into this dialog while it is open. */
export interface RadioAudio {
  controls: HTMLElement;
  unlock: () => void;
}

/** RADIO: the music player. ♫ RADIO in the header or in SETTINGS opens it; Ctrl+A toggles it. */
export function createRadioDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  audio: RadioAudio,
  doc: Document = document,
) {
  const shell = createDialogShell({
    title: "RADIO",
    label: "Radio",
    document: doc,
  });
  dialogs.add("radio", shell.dialog);
  const open = () => {
    audio.unlock();
    audio.controls.setAttribute("open", "");
    shell.body.replaceChildren(
      node("h2", "Fuse Riders Radio", "", doc),
      audio.controls,
    );
    dialogs.open("radio");
  };
  return {
    element: shell.dialog,
    open,
    /** Ctrl+A: opens the radio when nothing is open and closes it when it is. Any other dialog (the results, a settings draft) is left alone. */
    toggle() {
      const current = dialogs.current();
      if (current === undefined) open();
      else if (current === "radio") dialogs.close("radio");
    },
  };
}
