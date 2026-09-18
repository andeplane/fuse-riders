import { node } from "../dom.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface RecapDialogOptions {
  /** REMATCH and Back to lobby are the host's. */
  isHost: () => boolean;
  rematch: () => void;
  backToLobby: () => void;
  document?: Document;
}

/**
 * MATCH RESULTS: the wide report that opens once a match's closing pause has run out. The page closes it when the
 * room moves on (a rematch or the lobby, #318), on every device.
 */
export function createRecapDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: RecapDialogOptions,
) {
  const doc = options.document ?? document;
  const shell = createDialogShell({
    title: "MATCH RESULTS",
    label: "Match results",
    variant: "recap-dialog",
    closeText: "✕",
    document: doc,
  });
  dialogs.add("recap", shell.dialog);
  const { body, close } = shell;
  const rematch = node("button", "REMATCH", "", doc);
  rematch.type = "button";
  rematch.setAttribute("aria-label", "REMATCH");
  rematch.hidden = true;
  rematch.title = "Play the same match again";
  rematch.onclick = () => options.rematch();
  const fullStats = node(
    "button",
    "View full stats ↗",
    "recap-stats-toggle",
    doc,
  );
  fullStats.type = "button";
  fullStats.hidden = true;
  fullStats.setAttribute("aria-controls", "match-full-stats");
  fullStats.onclick = () => {
    const details = body.querySelector<HTMLElement>(".recap-details");
    if (!details) return;
    details.hidden = !details.hidden;
    fullStats.setAttribute("aria-expanded", String(!details.hidden));
    fullStats.textContent = details.hidden
      ? "View full stats ↗"
      : "Hide full stats ↗";
    if (!details.hidden) details.scrollIntoView({ block: "start" });
    else body.scrollTop = 0;
  };
  const recapLobby = node("button", "Back to lobby", "recap-lobby", doc);
  recapLobby.type = "button";
  recapLobby.hidden = true;
  recapLobby.onclick = () => {
    dialogs.close("recap");
    options.backToLobby();
  };
  close.before(recapLobby, rematch);
  shell.title.after(fullStats);
  return {
    element: shell.dialog,
    /** Shows `report` (from `renderMatchRecap`); `hasStats` offers the full statistics. */
    open(report: HTMLElement, hasStats: boolean) {
      body.replaceChildren(report);
      const host = options.isHost();
      rematch.hidden = !host;
      recapLobby.hidden = !host;
      fullStats.hidden = !hasStats;
      fullStats.textContent = "View full stats ↗";
      fullStats.setAttribute("aria-expanded", "false");
      dialogs.open("recap");
      body.scrollTop = 0;
    },
  };
}
