import { node, setAttributeIfChanged, setIfChanged } from "../dom.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

export interface RecapDialogOptions {
  /** REMATCH in a solo run; READY (a vote for the next race) in a room. */
  rematch: () => void;
  backToLobby: () => void;
  document?: Document;
}

/** What the results bar shows on a frame; the page derives it and the dialog writes only what changed. */
export interface RecapBar {
  /** "2/3 ready", or hidden in a solo run. */
  ready: { text: string; hidden: boolean };
  rematch: { label: string; pressed: boolean; hidden: boolean };
  /** Back to lobby is for whoever runs the room. */
  lobbyHidden: boolean;
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
  const { body, actions } = shell;
  const rematch = node("button", "REMATCH", "", doc);
  rematch.type = "button";
  rematch.setAttribute("aria-label", "REMATCH");
  rematch.hidden = true;
  rematch.title = "Play the same match again";
  rematch.onclick = () => options.rematch();
  const readySummary = node("span", "", "ready-summary", doc);
  readySummary.setAttribute("role", "status");
  readySummary.hidden = true;
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
  actions.prepend(recapLobby, readySummary, rematch);
  shell.title.after(fullStats);
  return {
    element: shell.dialog,
    /**
     * Shows `report` (from `renderMatchRecap`); `hasStats` offers the full statistics. The bar's buttons are set
     * before the modal opens, since it focuses the first one that is visible.
     */
    open(
      report: HTMLElement,
      view: { hasStats: boolean; rematchHidden: boolean; lobbyHidden: boolean },
    ) {
      body.replaceChildren(report);
      rematch.hidden = view.rematchHidden;
      recapLobby.hidden = view.lobbyHidden;
      fullStats.hidden = !view.hasStats;
      fullStats.textContent = "View full stats ↗";
      fullStats.setAttribute("aria-expanded", "false");
      dialogs.open("recap");
      body.scrollTop = 0;
    },
    /** The frame's READY count and buttons; only a value that changed reaches the DOM. */
    update(bar: RecapBar) {
      setIfChanged(readySummary, "hidden", bar.ready.hidden);
      setIfChanged(readySummary, "textContent", bar.ready.text);
      setIfChanged(rematch, "textContent", bar.rematch.label);
      setAttributeIfChanged(rematch, "aria-label", bar.rematch.label);
      setAttributeIfChanged(
        rematch,
        "aria-pressed",
        String(bar.rematch.pressed),
      );
      setIfChanged(rematch, "hidden", bar.rematch.hidden);
      setIfChanged(recapLobby, "hidden", bar.lobbyHidden);
    },
  };
}
