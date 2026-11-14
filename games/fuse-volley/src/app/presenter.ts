import type { Scoring } from "../engine/index.js";
import { DEAD_STEPS } from "../engine/view-kit.js";
import { seatsFor, sideOf, type View } from "../online/game.js";

/**
 * What the page shows, decided from one frame: the screen (lobby, the court, or a phone controller for a shared
 * screen), the lobby's roster, scoring and bot choices and buttons, the two sides, the line a controller reads and the
 * match result. Pure, so the decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the court and never plays. */
  display: boolean;
}

/** The scoring choices in the lobby, in words a first-time player understands. */
export const SCORING_CHOICES: readonly {
  id: Scoring;
  title: string;
  blurb: string;
}[] = [
  {
    id: "rally",
    title: "QUICK · TO 11",
    blurb: "Every rally scores a point, whoever served. First to 11, win by 2.",
  },
  {
    id: "classic",
    title: "CLASSIC · TO 15",
    blurb:
      "Only the serving side can score; win a rally on the other's serve to take the serve. First to 15, win by 2.",
  },
];
/** One a side or two a side, as the lobby offers them. */
export const MODE_CHOICES = [
  { doubles: false, title: "1 V 1" },
  { doubles: true, title: "2 V 2" },
] as const;
export const BOT_CHOICES = [
  { level: 0, title: "EASY" },
  { level: 1, title: "NORMAL" },
  { level: 2, title: "HARD" },
] as const;

/** One blob of the match. */
export interface Side {
  id: string;
  /** Its blob slot; even slots play the left side. */
  slot: number;
  side: 0 | 1;
  name: string;
  you: boolean;
  bot: boolean;
  /** The seat is gone or its device is not connected. */
  away: boolean;
  score: number;
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  /** This device has a blob in the match being played: its controls are live. */
  riding: boolean;
  /** This device's blob slot in the match, or −1. */
  localSlot: number;
  /** This device's side in the match, or −1. */
  localSide: 0 | 1 | -1;
  /** The control guide shows for a match's first serve; `guideKey` names that match. */
  controlsVisible: boolean;
  guideKey: string;
  lobby: {
    members: {
      id: string;
      name: string;
      slot: number;
      bot: boolean;
      connected: boolean;
      you: boolean;
    }[];
    watchers: number;
    canAddBot: boolean;
    removable: string[];
    showStart: boolean;
    canStart: boolean;
    /** Seats START fills with bots first: doubles starts with whoever is seated and bots for the rest. */
    fill: number;
    editable: boolean;
    note: string;
    /** A bot is seated: the level choice matters. */
    hasBot: boolean;
  };
  /** The match's blobs in slot order. */
  sides: Side[];
  /** Each side's label: its player, or in doubles both, "A & B". */
  names: readonly [string, string] | undefined;
  /** Each blob's name by slot, for the tags under blobs in doubles. */
  tags: readonly string[];
  /** The scoring rule of the match being played (or the lobby's choice), in words. */
  scoringName: string;
  /** One line for a phone controller: the score, a point, the result. */
  status: string;
  /** A line under the court for a device that is not playing. */
  note: string;
  result: {
    title: string;
    lines: string[];
    host: boolean;
    waiting: string;
  } | null;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function present(view: View, viewer: Viewer): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.world;
  const inMatch = view.stage !== "lobby" && !!world;
  const mySlot = world
    ? world.blobs.findIndex((each) => each.id === viewer.me)
    : -1;
  const localSlot = inMatch ? mySlot : -1;
  const localSide: 0 | 1 | -1 = localSlot === -1 ? -1 : sideOf(localSlot);
  const riding = view.stage === "running" && localSlot !== -1;
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && localSlot !== -1
      ? "controller"
      : "play";

  const sides: Side[] =
    inMatch && world
      ? view.roster.map((entrant) => {
          const seat = view.seats.find((each) => each.id === entrant.id);
          return {
            id: entrant.id,
            slot: entrant.slot,
            side: sideOf(entrant.slot),
            name: entrant.name,
            you: entrant.id === viewer.me,
            bot: entrant.bot,
            away: !entrant.bot && (!seat || seat.away || !seat.connected),
            score: world.score[sideOf(entrant.slot)],
          };
        })
      : [];
  const label = (side: 0 | 1) =>
    sides
      .filter((each) => each.side === side)
      .map((each) => each.name)
      .join(" & ");
  const names = sides.length >= 2 ? ([label(0), label(1)] as const) : undefined;

  let status = "";
  if (world && inMatch) {
    const score = `${world.score[0]} – ${world.score[1]}`;
    if (view.stage === "over" || world.phase === "over")
      status =
        localSide === -1
          ? score
          : world.winner === localSide
            ? "YOU WIN!"
            : "YOU LOSE";
    else if (world.phase === "serve")
      status =
        localSide !== -1 && world.server === localSide
          ? `${score} · YOUR SERVE`
          : `${score} · SERVE`;
    else if (world.phase === "dead" && world.lastFault !== -1)
      status =
        localSide === -1
          ? score
          : world.lastFault === localSide
            ? `${score} · MISSED`
            : `${score} · POINT!`;
    else status = score;
  }

  let note = "";
  if (inMatch && !viewer.display && localSlot === -1 && view.stage !== "over")
    note = seated
      ? "You play in the next match"
      : mine
        ? "Watching"
        : "Pick a name to play in the next match";

  let result: Model["result"] = null;
  if (view.stage === "over" && world && names) {
    const winner = sides.find((side) => side.id === view.winner);
    const team = winner && sides.filter((side) => side.side === winner.side);
    result = {
      title: !winner
        ? "MATCH OVER"
        : team!.some((side) => side.you)
          ? "YOU WIN!"
          : `${names[winner.side].toUpperCase()} ${team!.length > 1 ? "WIN" : "WINS"}`,
      lines: [
        `${names[0]} ${world.score[0]} – ${world.score[1]} ${names[1]}`,
        ...sides.map(
          (side) =>
            `${side.name}: ${plural(world.blobs[side.slot]?.hits ?? 0, "touch", "touches")}`,
        ),
      ],
      host: viewer.host,
      waiting: viewer.host ? "" : "Waiting for the host to start a rematch",
    };
  }

  const needed = seatsFor(view.settings),
    doubles = view.settings.doubles;
  const fill = doubles && seats.length < needed ? needed - seats.length : 0;
  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? seats.length > needed
        ? "1 V 1 takes two seats: pick 2 V 2, or remove a bot."
        : !doubles && seats.length < needed
          ? "A match needs two players: invite a friend or add a bot."
          : fill
            ? `2 V 2: seats 1 and 3 play cyan, 2 and 4 pink. START adds ${plural(fill, "bot", "bots")} for the empty ${fill === 1 ? "seat" : "seats"}.`
            : view.settings.display
              ? "Shared screen: open the TV screen, then every player uses a phone"
              : doubles
                ? "2 V 2: seats 1 and 3 play cyan, 2 and 4 pink."
                : ""
      : "Waiting for the host to start";
  const scoring = inMatch ? view.play.scoring : view.settings.scoring;
  return {
    screen,
    askName: !seated && !viewer.display && !viewer.solo && !mine,
    seated,
    riding,
    localSlot,
    localSide,
    controlsVisible:
      view.stage === "running" &&
      world?.phase === "serve" &&
      world.score[0] + world.score[1] === 0 &&
      world.lastFault === -1,
    guideKey: view.matchId,
    lobby: {
      members: seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        slot: seat.slot,
        bot: seat.bot,
        connected: seat.connected || seat.bot,
        you: seat.id === viewer.me,
      })),
      watchers: view.seats.length - seats.length,
      canAddBot: viewer.host && seats.length < needed,
      removable: viewer.host ? seats.filter((s) => s.bot).map((s) => s.id) : [],
      showStart: viewer.host,
      canStart: doubles
        ? seats.length >= 1 && seats.length <= needed
        : seats.length === needed,
      fill,
      editable: viewer.host,
      note: lobbyNote,
      hasBot: seats.some((seat) => seat.bot),
    },
    sides,
    names,
    tags: world
      ? world.blobs.map(
          (each) =>
            view.roster.find((entrant) => entrant.id === each.id)?.name ?? "",
        )
      : [],
    scoringName:
      SCORING_CHOICES.find((choice) => choice.id === scoring)?.title ?? "",
    status,
    note,
    result,
  };
}

/** One point as the metrics report it: nothing here names a player or a room. */
export interface PointReport {
  scoring: Scoring;
  /** The rally went to this device's blob. */
  mine: boolean;
  /** Counted touches in the match so far, both sides: a measure of rally length. */
  touches: number;
}

/** A rally is counted this far into its settle, in steps: past any rollback of the point itself. */
export const POINT_SETTLE_STEPS = 60;

/**
 * Finds the points a device should report, once each. Every device sees every rally end, so only rallies this
 * device's blob played are its to report, and of those only the ones it won, plus the ones it lost to a bot (which
 * has no device of its own). A rally is counted once its settle has run `POINT_SETTLE_STEPS`, so a predicted point
 * that a rollback takes back is never reported.
 */
export function createPointWatch(): (view: View, me: string) => PointReport[] {
  let match = "",
    counted = 0,
    total = 0;
  return (view, me) => {
    const world = view.world;
    if (!world || view.stage === "lobby" || !view.matchId) return [];
    if (view.matchId !== match) {
      match = view.matchId;
      counted = world.pointCounter;
      total = world.score[0] + world.score[1];
    }
    const delta = (world.pointCounter - counted + 0x10000) % 0x10000;
    if (delta === 0 || delta >= 0x8000) return [];
    const settled =
      world.phase !== "dead" ||
      world.remaining <= DEAD_STEPS - POINT_SETTLE_STEPS;
    if (!settled) return [];
    counted = world.pointCounter;
    const scored = world.score[0] + world.score[1] !== total;
    total = world.score[0] + world.score[1];
    // A classic side-out moves the serve, not the score: it is not a point.
    if (!scored) return [];
    // Normally one rally at a time; a device that slept through several reports the last.
    const loser = world.lastFault;
    if (loser === -1) return [];
    const winner = loser === 0 ? 1 : 0;
    const mySide = world.blobs.find((blob) => blob.id === me)?.side;
    if (mySide === undefined) return [];
    const mine = winner === mySide,
      toBot = view.roster.some(
        (entrant) => sideOf(entrant.slot) === winner && entrant.bot,
      );
    if (!mine && !toBot) return [];
    return [
      {
        scoring: world.scoring,
        mine,
        touches: world.blobs.reduce((sum, blob) => sum + blob.hits, 0),
      },
    ];
  };
}
