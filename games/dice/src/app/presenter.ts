import type { RosterMember } from "fuse-ui";
import {
  CAPACITY,
  TICKS_PER_SECOND,
  type DicePlayerView,
  type DiceView,
} from "../game/index.js";

/**
 * What the dice screen shows, as a pure function of the view and who this device is. The screen renders from the
 * view (state), never from events: a rollback can change a roll after it was shown, and events are deduplicated by
 * position, so only the view carries the correction.
 */
export interface Viewer {
  /** This device's member id ("solo" alone, "" before the room service admitted it). */
  me: string;
  /** This device created the room: it starts matches and adds or removes bots. */
  host: boolean;
  solo: boolean;
  /** The shared screen (`?display=1`): it shows the table and never plays. */
  display: boolean;
  /** The room's settings make it one shared screen with phones as controllers. */
  shared: boolean;
}

export interface PlayerRow {
  id: string;
  name: string;
  /** The name as the card shows it: marked when it is this device's seat. */
  label: string;
  score: number;
  /** One mark per round win needed, filled for each won: "●○". */
  wins: string;
  roundWins: number;
  /** Banked plus this turn's total, toward the target, 0 to 1. */
  progress: number;
  current: boolean;
  you: boolean;
  bot: boolean;
  away: boolean;
  winner: boolean;
}
export interface DieModel {
  value: number;
  /** Which of the nine pip cells are lit, row by row. */
  pips: boolean[];
  bust: boolean;
  /** Changes with every roll, even two equal rolls in a row: the screen restarts its roll animation on it. */
  key: string;
  by: string;
}
export interface ResultModel {
  title: string;
  lines: string[];
  /** This device may start the rematch or return to the lobby. */
  host: boolean;
  waiting: string;
}
export interface LobbyModel {
  members: RosterMember[];
  canStart: boolean;
  showStart: boolean;
  note: string;
  canAddBot: boolean;
  /** The bots this device may remove. */
  removable: string[];
}
export interface TableModel {
  screen: "lobby" | "table";
  /** A seated phone in a shared-screen room is a controller: big buttons, its own score. */
  layout: "table" | "controller";
  /** This device has a seat. */
  seated: boolean;
  /** This device should offer its name to join: not seated, not the shared screen. */
  askName: boolean;
  round: string;
  headline: string;
  detail: string;
  players: PlayerRow[];
  you?: PlayerRow;
  die?: DieModel;
  turnTotal: number;
  /** The turn timer, 1 when a turn starts and 0 when it holds by itself; 0 when no turn runs. */
  timer: number;
  seconds: number;
  controls: { visible: boolean; roll: boolean; hold: boolean };
  result?: ResultModel;
  lobby: LobbyModel;
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
/** The lit cells of a 3×3 die face; a blank face for 0. */
export const pips = (value: number): boolean[] =>
  Array.from({ length: 9 }, (_, cell) => PIPS[value]?.includes(cell) ?? false);

const possessive = (name: string) =>
  `${name.toUpperCase()}${name.endsWith("s") ? "'" : "'S"}`;

function row(view: DiceView, player: DicePlayerView, me: string): PlayerRow {
  const current = view.currentId === player.id,
    banked = player.score + (current ? view.turnTotal : 0);
  const you = player.id === me;
  return {
    id: player.id,
    name: player.name,
    label: you && player.name !== "You" ? `${player.name} (you)` : player.name,
    score: player.score,
    wins: Array.from({ length: view.winsNeeded }, (_, index) =>
      index < player.roundWins ? "●" : "○",
    ).join(""),
    roundWins: player.roundWins,
    progress: Math.min(1, banked / view.target),
    current,
    you,
    bot: player.bot,
    away: !player.bot && !player.connected,
    winner:
      view.winnerId === player.id ||
      (view.phase === "between" && view.roundWinnerId === player.id),
  };
}

function lobby(view: DiceView, viewer: Viewer): LobbyModel {
  const players = view.players,
    host = viewer.host && !viewer.display;
  return {
    members: players.map((player) => ({
      id: player.id,
      name:
        player.id === viewer.me && player.name !== "You"
          ? `${player.name} (you)`
          : player.name,
      status: player.bot ? "BOT" : player.connected ? "READY" : "AWAY",
      avatar: player.avatarId,
    })),
    canStart: host && players.length >= 2,
    showStart: host,
    note:
      players.length >= 2
        ? host
          ? ""
          : "Waiting for the host to start"
        : viewer.display || !host
          ? "Waiting for players"
          : "Add a bot or invite a friend: two players start a match",
    canAddBot: host && players.length < CAPACITY,
    removable: host
      ? players.filter((player) => player.bot).map((player) => player.id)
      : [],
  };
}

export function presentTable(view: DiceView, viewer: Viewer): TableModel {
  const players = view.players.map((player) => row(view, player, viewer.me)),
    you = players.find((player) => player.you),
    name = (id: string | undefined) =>
      view.players.find((player) => player.id === id)?.name ?? "Someone";
  const seated = you !== undefined && !viewer.display,
    running = view.phase === "running",
    yourTurn = running && seated && view.currentId === viewer.me;
  const roll = view.lastRoll;
  const die: DieModel | undefined = roll && {
    value: roll.value,
    pips: pips(roll.value),
    bust: roll.value === 1,
    key: `${view.round}:${roll.n}`,
    by: name(roll.id),
  };
  let headline = "",
    detail = "";
  if (view.phase === "lobby") {
    headline = "WAITING FOR PLAYERS";
    detail = `First to ${view.target} wins a round. ${view.winsNeeded} round wins take the match.`;
  } else if (running) {
    headline = yourTurn
      ? "YOUR TURN"
      : view.currentId
        ? `${possessive(name(view.currentId))} TURN`
        : "WAITING";
    if (die?.bust && roll!.id !== view.currentId)
      detail = `${die.by} rolled a 1: bust!`;
    else if (view.turnTotal > 0)
      detail = yourTurn
        ? `Hold to bank ${view.turnTotal}, or roll on`
        : `${view.turnTotal} at risk`;
    else detail = yourTurn ? "Roll the die" : "";
  } else if (view.phase === "between") {
    headline = `${name(view.roundWinnerId).toUpperCase()} WINS ROUND ${view.round}`;
    detail = "Next round starting…";
  } else {
    headline = `${name(view.winnerId).toUpperCase()} WINS THE MATCH`;
    detail = "";
  }
  const host = viewer.host && !viewer.display;
  const result: ResultModel | undefined =
    view.phase === "over"
      ? {
          title:
            view.winnerId === viewer.me && seated
              ? "YOU WIN!"
              : `${name(view.winnerId).toUpperCase()} WINS`,
          lines: [...view.players]
            .sort(
              (a, b) =>
                b.roundWins - a.roundWins ||
                b.score - a.score ||
                a.slot - b.slot,
            )
            .map(
              (player) =>
                `${player.name}: ${player.roundWins} round${player.roundWins === 1 ? "" : "s"}, best turn ${player.bestTurn}, ${player.busts} bust${player.busts === 1 ? "" : "s"}`,
            ),
          host,
          waiting: host ? "" : "Waiting for the host to start a rematch",
        }
      : undefined;
  return {
    screen: view.phase === "lobby" ? "lobby" : "table",
    layout: viewer.shared && seated ? "controller" : "table",
    seated,
    askName: !seated && !viewer.display && viewer.me !== "",
    round:
      view.phase === "lobby"
        ? `FIRST TO ${view.target}`
        : `ROUND ${view.round} · FIRST TO ${view.target}`,
    headline,
    detail,
    players,
    ...(you ? { you } : {}),
    ...(die ? { die } : {}),
    turnTotal: running ? view.turnTotal : 0,
    timer:
      running && view.turnTicks > 0
        ? Math.max(0, Math.min(1, view.timerTicks / view.turnTicks))
        : 0,
    seconds: running ? Math.ceil(view.timerTicks / TICKS_PER_SECOND) : 0,
    controls: {
      visible: seated,
      roll: yourTurn,
      hold: yourTurn && view.turnTotal > 0,
    },
    ...(result ? { result } : {}),
    lobby: lobby(view, viewer),
  };
}
