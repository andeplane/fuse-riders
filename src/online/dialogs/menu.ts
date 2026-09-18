import { node } from "../dom.js";
import type { DialogRegistry, RoomDialogId } from "./registry.js";
import { createDialogShell } from "./shell.js";

/** One rider's line in the session standings. */
export interface SessionStanding {
  id: string;
  name: string;
  totalScoreUnits: number;
  matchWins: number;
  roundWins: number;
}

export interface MenuDialogOptions {
  solo: boolean;
  isHost: () => boolean;
  playerId: () => string;
  /** The session's leaderboard, unsorted. */
  standings: () => readonly SessionStanding[];
  /** The redacted link report, once one has been collected. */
  linkDiagnostics: () => string | undefined;
  /** The network stats panel is hidden. */
  statsHidden: () => boolean;
  toggleStats: () => void;
  /** Leaves (or ends) the room and goes back to the main menu. */
  leave: () => Promise<void>;
  document?: Document;
}

/** Session standings, best first: points, then match wins, then name. */
export function sortedStandings<T extends SessionStanding>(
  standings: readonly T[],
): T[] {
  return [...standings].sort(
    (a, b) =>
      b.totalScoreUnits - a.totalScoreUnits ||
      b.matchWins - a.matchWins ||
      a.name.localeCompare(b.name),
  );
}

/** EXIT (solo) or ROOM: the exit confirmation, the session standings and, in a room, the link diagnostics. */
export function createMenuDialog(
  dialogs: DialogRegistry<RoomDialogId>,
  options: MenuDialogOptions,
) {
  const doc = options.document ?? document;
  const { solo } = options;
  const shell = createDialogShell({
    title: solo ? "EXIT" : "ROOM",
    label: solo ? "Exit" : "Room",
    document: doc,
  });
  dialogs.add("menu", shell.dialog);
  const body = shell.body;
  const standingsList = (id: string) => {
    const standings = sortedStandings(options.standings());
    if (!standings.length) return undefined;
    const list = node("div", "", "session-board", doc);
    list.append(node("h2", "Session standings", "", doc));
    let rank = 0,
      previous: number | undefined;
    standings.forEach((entry, index) => {
      if (entry.totalScoreUnits !== previous) rank = index + 1;
      previous = entry.totalScoreUnits;
      const row = node("div", "", "session-row", doc);
      if (entry.id === id) row.classList.add("is-you");
      const points = entry.totalScoreUnits / 60;
      row.append(
        node("b", `#${rank}`, "", doc),
        node(
          "span",
          entry.id === id ? `${entry.name} (you)` : entry.name,
          "",
          doc,
        ),
        node(
          "strong",
          `${Number.isInteger(points) ? points : points.toFixed(1)} PTS`,
          "",
          doc,
        ),
        node(
          "small",
          `${entry.matchWins} ${entry.matchWins === 1 ? "MATCH" : "MATCHES"} · ${entry.roundWins} ${entry.roundWins === 1 ? "ROUND" : "ROUNDS"}`,
          "",
          doc,
        ),
      );
      list.append(row);
    });
    list.append(
      node(
        "p",
        "Round points: +1 per opponent outlasted, +1 for the sole survivor. Same-tick deaths tie.",
        "session-key",
        doc,
      ),
    );
    return list;
  };
  return {
    element: shell.dialog,
    open() {
      const host = options.isHost();
      body.replaceChildren(
        node(
          "p",
          solo
            ? "End this solo run and go back to the menu?"
            : host
              ? "End this room for everyone?"
              : "Leave this room?",
          "",
          doc,
        ),
      );
      const leave = node(
          "button",
          solo ? "END RUN" : host ? "END ROOM" : "LEAVE ROOM",
          "exit-confirm",
          doc,
        ),
        stay = node("button", solo ? "KEEP PLAYING" : "STAY", "", doc),
        choices = node("div", "", "exit-choices", doc);
      stay.onclick = () => dialogs.close("menu");
      choices.append(stay, leave);
      leave.onclick = async () => {
        leave.disabled = stay.disabled = true;
        leave.textContent = "LEAVING…";
        await options.leave();
      };
      body.append(choices);
      const list = standingsList(options.playerId());
      if (list) body.append(list);
      if (!solo) {
        const diagnostics = node("pre", "", "link-diagnostics", doc);
        diagnostics.textContent =
          options.linkDiagnostics() ?? "collecting link diagnostics…";
        const statsToggle = node(
          "button",
          options.statsHidden() ? "SHOW NETWORK STATS" : "HIDE NETWORK STATS",
          "",
          doc,
        );
        statsToggle.onclick = () => {
          options.toggleStats();
          dialogs.close("menu");
        };
        body.append(
          statsToggle,
          node(
            "p",
            "LINK DIAGNOSTICS (redacted: candidate types and states, no addresses)",
            "",
            doc,
          ),
          diagnostics,
        );
        const refresh = setInterval(() => {
          if (dialogs.current() !== "menu") {
            clearInterval(refresh);
            return;
          }
          diagnostics.textContent =
            options.linkDiagnostics() ?? diagnostics.textContent;
        }, 1000);
      }
      dialogs.open("menu");
    },
  };
}
