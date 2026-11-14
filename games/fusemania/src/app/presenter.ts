import {
  BATTLE_MODE,
  CAPACITY,
  BOO,
  DROPPED,
  FULL_RATING,
  GOOD,
  GREAT,
  HELD,
  MARVELOUS,
  MINED,
  MISS,
  PERFECT,
  type Library,
  type PlayerView,
} from "../engine/index.js";
import type { View } from "../online/game.js";

/**
 * What the page shows, decided from one frame: the screen (the lobby with its song select, the note field, or a
 * phone controller for a shared screen), the lobby's roster, the names the field is labelled with and the result.
 * Pure, so the decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the fields and never plays. */
  display: boolean;
}

/** A rating as a letter grade and a percentage. */
export function grade(rating: number): string {
  const share = rating / FULL_RATING;
  return share >= 1
    ? "AAAA"
    : share >= 0.97
      ? "AAA"
      : share >= 0.93
        ? "AA"
        : share >= 0.85
          ? "A"
          : share >= 0.75
            ? "B"
            : share >= 0.6
              ? "C"
              : "D";
}
export const percent = (rating: number): string =>
  `${(Math.floor((rating / FULL_RATING) * 1000) / 10).toFixed(1)}%`;
/** A rating as a score with thousands separators. */
export const scoreText = (rating: number): string =>
  String(rating).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** What a best result reads as on a chart chip. */
export const bestText = (rating: number): string =>
  `${grade(rating)} ${percent(rating)}`;
export const ordinal = (place: number): string =>
  `${place}${["TH", "ST", "ND", "RD"][place % 100 > 10 && place % 100 < 14 ? 0 : place % 10 < 4 ? place % 10 : 0]}`;

/** One line of the result table. */
export interface Row {
  place: number;
  slot: number;
  name: string;
  you: boolean;
  grade: string;
  score: string;
  /** The chart played and the accuracy: "HARD 9 · 94.2%". */
  detail: string;
  /** "MAX COMBO 212". */
  combo: string;
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  /** This device has a field in the match being played: its keys are live. */
  playing: boolean;
  /** This device's player slot in the match, or −1. */
  localSlot: number;
  lobby: {
    members: {
      id: string;
      name: string;
      slot: number;
      connected: boolean;
      you: boolean;
      bot: boolean;
      /** The chart the seat will play: "HARD 9". */
      chart: string;
    }[];
    /** The host may seat another AI rival, and take these seats' AI away. */
    canAddBot: boolean;
    removable: string[];
    showStart: boolean;
    canStart: boolean;
    editable: boolean;
    note: string;
  };
  /** Each player's name and chart by slot, for the fields. */
  names: string[];
  chartNames: string[];
  /** The song being played. */
  title: string;
  /** One line for a phone controller. */
  status: string;
  /** A line under the field for a device that is not playing. */
  note: string;
  /** The chart this device will play next, as the song select shows it. */
  chart: number;
  result: {
    title: string;
    rows: Row[];
    /** This device's own judgments, one line each: ["MARVELOUS", "212"]. */
    counts: [label: string, value: string][];
    /** Extra lines: a new best. */
    lines: string[];
    host: boolean;
    waiting: string;
    solo: boolean;
  } | null;
}

const chartLabel = (library: Library, song: string, chart: number): string => {
  const info = library.song(song)?.charts;
  const picked = info?.[Math.min(chart, info.length - 1)];
  return picked ? `${picked.name.toUpperCase()} ${picked.meter}` : "";
};

const countLines = (player: PlayerView): [string, string][] => [
  ["MARVELOUS", String(player.counts[MARVELOUS])],
  ["PERFECT", String(player.counts[PERFECT])],
  ["GREAT", String(player.counts[GREAT])],
  ["GOOD", String(player.counts[GOOD])],
  ["BOO", String(player.counts[BOO])],
  ["MISS", String(player.counts[MISS])],
  [
    "HOLDS",
    `${player.counts[HELD]} / ${player.counts[HELD]! + player.counts[DROPPED]!}`,
  ],
  ...(player.counts[MINED]
    ? [["MINES HIT", String(player.counts[MINED])] as [string, string]]
    : []),
];

export function present(
  library: Library,
  view: View,
  viewer: Viewer,
  /** This device's best rating on the chart before this match, if there was one. */
  bestBefore?: number,
): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.world;
  const inMatch = view.stage !== "lobby" && !!world;
  const localSlot =
    inMatch && world
      ? world.players.findIndex((each) => each.id === viewer.me)
      : -1;
  const player = world?.players[localSlot];
  const playing = view.stage === "running" && localSlot !== -1;
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && localSlot !== -1
      ? "controller"
      : "play";
  const song = library.song(inMatch ? view.play.song : view.settings.song);
  const title = (song?.title ?? "").toUpperCase();

  let status = "";
  if (inMatch && world) {
    if (view.stage === "over")
      status = !player
        ? "SONG OVER"
        : world.players.length === 1
          ? `${grade(player.rating)} · ${percent(player.rating)}`
          : view.winner === viewer.me
            ? "YOU WIN!"
            : `${ordinal(player.place)} PLACE`;
    else if (world.ms < 0) status = "GET READY";
    else if (!player) status = title;
    else
      status = `${scoreText(player.rating)}${world.players.length > 1 ? ` · ${ordinal(player.place)}` : ""}`;
  }

  let note = "";
  if (inMatch && !viewer.display && localSlot === -1 && view.stage !== "over")
    note = seated
      ? "You play in the next song"
      : mine
        ? "Watching"
        : "Pick a name to play in the next song";

  let result: Model["result"] = null;
  if (view.stage === "over" && world) {
    const alone = world.players.length === 1;
    const winner = view.roster.find((entrant) => entrant.id === view.winner);
    const rows: Row[] = [...world.players]
      .sort((a, b) => a.place - b.place)
      .map((each) => ({
        place: each.place,
        slot: each.slot,
        name: view.roster[each.slot]?.name ?? "",
        you: each.id === viewer.me,
        grade: grade(each.rating),
        score: scoreText(each.rating),
        detail: `${chartLabel(library, world.song, each.chart)} · ${percent(each.rating)}`,
        combo: `MAX COMBO ${each.best}`,
      }));
    const lines: string[] = [];
    if (player && !player.bot) {
      if (bestBefore === undefined || player.rating > bestBefore)
        lines.push(
          bestBefore === undefined
            ? "FIRST SCORE ON THIS CHART"
            : `NEW BEST! (WAS ${percent(bestBefore)})`,
        );
      else lines.push(`BEST ${bestText(bestBefore)}`);
    }
    result = {
      title: alone
        ? `${title} · ${grade(world.players[0]!.rating)}`
        : !winner
          ? "SONG OVER"
          : winner.id === viewer.me
            ? "YOU WIN!"
            : `${winner.name.toUpperCase()} WINS`,
      rows,
      counts: player ? countLines(player) : [],
      lines,
      host: viewer.host,
      waiting: viewer.host ? "" : "Waiting for the host to pick the next song",
      solo: viewer.solo,
    };
  }

  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? view.settings.display
        ? "Shared screen: open the TV screen, then every player uses a phone"
        : seats.length === 1 && !viewer.solo
          ? "Start alone, add an AI rival, or invite up to four friends."
          : view.settings.mode === BATTLE_MODE && seats.length === 1
            ? "A battle needs a rival: add an AI player or invite a friend."
            : ""
      : "Waiting for the host to start";
  return {
    screen,
    askName: !seated && !viewer.display && !viewer.solo && !mine,
    seated,
    playing,
    localSlot,
    lobby: {
      members: seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        slot: seat.slot,
        connected: seat.connected,
        you: seat.id === viewer.me,
        bot: seat.bot,
        chart: chartLabel(library, view.settings.song, seat.chart),
      })),
      canAddBot: viewer.host && seats.length < CAPACITY,
      removable: viewer.host
        ? seats.filter((seat) => seat.bot).map((seat) => seat.id)
        : [],
      showStart: viewer.host,
      canStart: seats.length >= 1,
      editable: viewer.host,
      note: lobbyNote,
    },
    names: inMatch ? view.roster.map((entrant) => entrant.name) : [],
    chartNames:
      inMatch && world
        ? world.players.map((each) =>
            chartLabel(library, world.song, each.chart),
          )
        : [],
    title,
    status,
    note,
    chart: mine?.chart ?? view.settings.chart,
    result,
  };
}
