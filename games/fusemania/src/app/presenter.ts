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
import type { SessionView, View } from "../online/game.js";

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

/**
 * What a song that waits for its audio says over the field: this device's own download first, then who else the
 * room waits for.
 */
export function holdText(waiting: readonly string[], settled: boolean): string {
  if (!settled) return "DOWNLOADING SONG…";
  return waiting.length
    ? `WAITING FOR ${waiting.join(", ").toUpperCase()} · DOWNLOADING SONG…`
    : "GET READY…";
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
  /** The player's id in the room. */
  id: string;
  bot: boolean;
  place: number;
  slot: number;
  name: string;
  you: boolean;
  /** The chart played: "HARD 9". */
  chart: string;
  /** "94.2%". */
  accuracy: string;
  /** The longest combo, as a number. */
  maxCombo: string;
  /** How many of each judgment, Marvelous first and Miss last. */
  judgments: string[];
  grade: string;
  score: string;
  /** The chart played and the accuracy: "HARD 9 · 94.2%". */
  detail: string;
  /** "MAX COMBO 212". */
  combo: string;
}
/** This device's own run on the result. */
export interface Own {
  grade: string;
  /** The score with thousands separators. */
  score: string;
  /** "CHALLENGE 13 · 94.2% · MAX COMBO 212". */
  detail: string;
  /** What a run with no broken combo earned ("FULL GREAT COMBO", "FULL PERFECT COMBO", ...), or "". */
  badge: string;
}
/** One line of a session's standings. */
export interface Standing {
  place: number;
  name: string;
  you: boolean;
  /** The seat the rider sits in now, for its colour, or −1 for one who left. */
  slot: number;
  /** The session total, with thousands separators. */
  points: string;
  /** "2 WINS", or "" for none. */
  wins: string;
}
/** A session's standings under a heading: "SESSION · AFTER SONG 2 OF 5", "FINAL STANDINGS". */
export interface SessionModel {
  title: string;
  rows: Standing[];
}
/** What a button of the result does: the room action it sends. */
export interface ResultAction {
  text: string;
  action: "rematch" | "lobby";
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  /** This device has a field in the match being played: its keys are live. */
  playing: boolean;
  /** This device's player slot in the match, or −1. */
  localSlot: number;
  /**
   * Who else the started song waits for while their devices download it, by name ("THE TV" for the shared
   * screen), this device left out. Empty when the song is not held, or held for this device alone.
   */
  waiting: string[];
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
    /** What the START button says: "START", or "START SONG 2 OF 5" in a session. */
    startText: string;
    /** The session the room is in the middle of, between two of its songs. */
    session: SessionModel | null;
  };
  /** Each player's name and chart by slot, for the fields. */
  names: string[];
  chartNames: string[];
  /** Each player's session total before this song, by slot; empty when the song is not one of a session. */
  totals: number[];
  /** The song being played, after its number in a session: "SONG 2 OF 5 · NEON KICKOFF". */
  title: string;
  /** One line for a phone controller. */
  status: string;
  /** A line under the field for a device that is not playing. */
  note: string;
  /** The chart this device will play next, as the song select shows it. */
  chart: number;
  result: {
    title: string;
    /** The song that was played: "NEON KICKOFF". */
    song: string;
    rows: Row[];
    /** This device's own run, large: null for a watcher and for the TV. */
    own: Own | null;
    /** This device's own judgments, one line each: ["MARVELOUS", "212"]. */
    counts: [label: string, value: string][];
    /** Extra lines: a new best. */
    lines: string[];
    host: boolean;
    waiting: string;
    solo: boolean;
    /** The session's standings with this song in them. */
    session: SessionModel | null;
    /** The session is over: its standings lead the card. */
    final: boolean;
    /** The host's main button, and the other one where there is a second thing to do. */
    primary: ResultAction;
    secondary: ResultAction | null;
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

/** A run that never broke its combo, named after the worst judgment in it. */
export const comboBadge = (counts: readonly number[]): string => {
  const at = (judgment: number) => counts[judgment] ?? 0;
  if (
    at(MISS) ||
    at(BOO) ||
    at(GOOD) ||
    at(DROPPED) ||
    at(MARVELOUS) + at(PERFECT) + at(GREAT) === 0
  )
    return "";
  return at(GREAT)
    ? "FULL GREAT COMBO"
    : at(PERFECT)
      ? "FULL PERFECT COMBO"
      : "ALL MARVELOUS";
};

const standingRows = (
  session: SessionView,
  view: View,
  viewer: Viewer,
): Standing[] =>
  session.standings.map((score, index) => ({
    place: index + 1,
    name: score.name,
    you: score.id === viewer.me,
    slot:
      view.seats.find((seat) => seat.id === score.id && !seat.watcher)?.slot ??
      -1,
    points: scoreText(score.points),
    wins: score.wins
      ? `${score.wins} ${score.wins === 1 ? "WIN" : "WINS"}`
      : "",
  }));

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
  // A match of several songs a session is one of its session's; in the lobby the session waits for its next song
  // unless the host has changed how long a session is.
  const session = view.session;
  const between =
    !inMatch && session && session.length === view.settings.songs
      ? session
      : null;
  const songTitle = (song?.title ?? "").toUpperCase();
  const title =
    inMatch && session
      ? `SONG ${session.songs.length} OF ${session.length} · ${songTitle}`
      : songTitle;

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
    else if (!player) status = songTitle;
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
        id: each.id,
        bot: each.bot,
        chart: chartLabel(library, world.song, each.chart),
        accuracy: percent(each.rating),
        maxCombo: String(each.best),
        judgments: [MARVELOUS, PERFECT, GREAT, GOOD, BOO, MISS].map((kind) =>
          String(each.counts[kind]),
        ),
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
            : `NEW BEST! +${scoreText(player.rating - bestBefore)} (WAS ${percent(bestBefore)})`,
        );
      else
        lines.push(
          player.rating === bestBefore
            ? `BEST ${bestText(bestBefore)}`
            : `BEST ${bestText(bestBefore)} · −${scoreText(bestBefore - player.rating)}`,
        );
    }
    const final = !!session && session.done >= session.length;
    const leader = session?.standings[0];
    const random = view.settings.random;
    const again: ResultAction = { text: "PLAY AGAIN", action: "rematch" };
    const select: ResultAction = { text: "SONG SELECT", action: "lobby" };
    // What the host does next: another go at a single song; in a session its next song, drawn by the room or
    // picked in the song select; and after the last one a new session.
    const [primary, secondary]: [ResultAction, ResultAction | null] = !session
      ? [again, select]
      : final
        ? random
          ? [{ text: "NEW SESSION", action: "rematch" }, select]
          : [{ text: "NEW SESSION", action: "lobby" }, null]
        : random
          ? [{ text: "NEXT SONG", action: "rematch" }, select]
          : [{ text: "PICK NEXT SONG", action: "lobby" }, null];
    result = {
      title:
        final && leader
          ? leader.id === viewer.me
            ? "YOU WIN THE SESSION!"
            : `${leader.name.toUpperCase()} WINS THE SESSION`
          : alone
            ? `${songTitle} · ${grade(world.players[0]!.rating)}`
            : !winner
              ? "SONG OVER"
              : winner.id === viewer.me
                ? "YOU WIN!"
                : `${winner.name.toUpperCase()} WINS`,
      song: songTitle,
      rows,
      own: player
        ? {
            grade: grade(player.rating),
            score: scoreText(player.rating),
            detail: `${chartLabel(library, world.song, player.chart)} · ${percent(player.rating)} · MAX COMBO ${player.best}`,
            badge: comboBadge(player.counts),
          }
        : null,
      counts: player ? countLines(player) : [],
      lines,
      host: viewer.host,
      waiting: viewer.host
        ? ""
        : final
          ? "Waiting for the host to start a new session"
          : session && random
            ? "Waiting for the host to start the next song"
            : "Waiting for the host to pick the next song",
      solo: viewer.solo,
      session: session
        ? {
            title: final
              ? "FINAL STANDINGS"
              : `SESSION · AFTER SONG ${session.done} OF ${session.length}`,
            rows: standingRows(session, view, viewer),
          }
        : null,
      final,
      primary,
      secondary,
    };
  }

  // A session in the middle that the next song would not continue: the host changed how many songs one plays.
  const ending =
    !inMatch && !!session && session.done > 0 && !between && viewer.host;
  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : ending
      ? `Another number of songs starts a new session: pick ${session.length} again to go on with this one.`
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
    waiting: view.waiting
      ? [
          ...view.waiting.ids
            .filter((id) => id !== viewer.me)
            .map((id) => view.seats.find((seat) => seat.id === id)?.name ?? "")
            .filter((name) => name !== ""),
          ...(view.waiting.screen && !viewer.display ? ["THE TV"] : []),
        ]
      : [],
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
      startText: between
        ? `START SONG ${between.done + 1} OF ${between.length}`
        : view.settings.songs > 1
          ? `START SONG 1 OF ${view.settings.songs}`
          : "START",
      session:
        between && between.done > 0
          ? {
              title: `SESSION · ${between.done} OF ${between.length} PLAYED`,
              rows: standingRows(between, view, viewer),
            }
          : null,
    },
    names: inMatch ? view.roster.map((entrant) => entrant.name) : [],
    chartNames:
      inMatch && world
        ? world.players.map((each) =>
            chartLabel(library, world.song, each.chart),
          )
        : [],
    totals:
      inMatch && world && session
        ? world.players.map((each) => {
            const points =
              session.standings.find((score) => score.id === each.id)?.points ??
              0;
            // Once the song is decided its rating is in the total already.
            return Math.max(
              0,
              points - (view.stage === "over" ? each.rating : 0),
            );
          })
        : [],
    title,
    status,
    note,
    chart: mine?.chart ?? view.settings.chart,
    result,
  };
}
