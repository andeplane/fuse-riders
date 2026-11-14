import type { Format, Scoring } from "../engine/index.js";
import { DEAD_STEPS } from "../engine/view-kit.js";
import { seatsFor, teamOfSlot, teamsIn, type View } from "../online/game.js";

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
/** The formats as the lobby offers them. */
export const MODE_CHOICES: readonly { format: Format; title: string }[] = [
  { format: "1v1", title: "DUEL" },
  { format: "2v2", title: "2 V 2" },
  { format: "3v3", title: "3 V 3" },
  { format: "2v2v2", title: "2 V 2 V 2" },
];
/** The team colours' names, by team: two sides, or three teams of two. */
export const TEAM_NAMES = ["CYAN", "PINK", "LIME"] as const;
export const BOT_CHOICES = [
  { level: 0, title: "EASY" },
  { level: 1, title: "NORMAL" },
  { level: 2, title: "HARD" },
] as const;

/** One blob of the match. */
export interface Side {
  id: string;
  /** Its blob slot; even slots play the left side (three teams of two, slot % 3 is the team). */
  slot: number;
  /** Its team: its side on two sides, or three teams of two, 0–2. */
  team: number;
  /** The side it plays now; three teams of two, −1 while it waits off court. */
  side: 0 | 1 | -1;
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
  /** This device's side in the match, or −1 (three teams of two, also while it waits off court). */
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
    /** Seats START fills with bots first: two or three a side starts with whoever is seated and bots for the rest. */
    fill: number;
    editable: boolean;
    note: string;
    /** A bot is seated: the level choice matters. */
    hasBot: boolean;
  };
  /** The match's blobs in slot order. */
  sides: Side[];
  /**
   * Each side's label: its player, or its team, "A & B" or "A, B & C"; three teams of two, the waiting team's third.
   */
  names: readonly string[] | undefined;
  /** Each blob's name by slot, for the tags under blobs two and three a side. */
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

/** A side's players as one label: "A", "A & B" or "A, B & C". */
export const teamLabel = (names: readonly string[]): string =>
  names.length > 2
    ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`
    : names.join(" & ");

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
  const riding = view.stage === "running" && localSlot !== -1;
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && localSlot !== -1
      ? "controller"
      : "play";

  const format = inMatch ? view.play.format : view.settings.format,
    kings = format === "2v2v2";
  const sides: Side[] =
    inMatch && world
      ? view.roster.map((entrant) => {
          const seat = view.seats.find((each) => each.id === entrant.id);
          const blob = world.blobs[entrant.slot],
            team = teamOfSlot(entrant.slot, format);
          return {
            id: entrant.id,
            slot: entrant.slot,
            team,
            side: !blob || blob.benched ? -1 : blob.side,
            name: entrant.name,
            you: entrant.id === viewer.me,
            bot: entrant.bot,
            away: !entrant.bot && (!seat || seat.away || !seat.connected),
            score: kings
              ? (world.points[team] ?? 0)
              : world.score[team === 1 ? 1 : 0],
          };
        })
      : [];
  /** A team's label by team: its players' names. */
  const teamName = (team: number) =>
    teamLabel(
      sides.filter((each) => each.team === team).map((each) => each.name),
    );
  const localSide: 0 | 1 | -1 =
    localSlot === -1
      ? -1
      : (sides.find((each) => each.slot === localSlot)?.side ?? -1);
  const localTeam = localSlot === -1 ? -1 : teamOfSlot(localSlot, format);
  const benchTeam =
    world && kings ? 3 - world.onCourt[0] - world.onCourt[1] : -1;
  const names =
    sides.length < 2 || !world
      ? undefined
      : kings
        ? [
            teamName(world.onCourt[0]),
            teamName(world.onCourt[1]),
            teamName(benchTeam),
          ]
        : [teamName(0), teamName(1)];

  let status = "";
  if (world && inMatch) {
    const score = kings
      ? [0, 1, 2]
          .map((team) => `${TEAM_NAMES[team]} ${world.points[team] ?? 0}`)
          .join(" · ")
      : `${world.score[0]} – ${world.score[1]}`;
    const winningTeam =
      world.winner === -1
        ? -1
        : kings
          ? world.onCourt[world.winner]
          : world.winner;
    if (view.stage === "over" || world.phase === "over")
      status =
        localTeam === -1
          ? score
          : winningTeam === localTeam
            ? "YOU WIN!"
            : "YOU LOSE";
    else if (kings && localTeam !== -1 && localSide === -1)
      status = `${score} · YOU'RE NEXT UP`;
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
            ? kings
              ? `${score} · OFF YOU GO`
              : `${score} · MISSED`
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
    const team = winner && sides.filter((side) => side.team === winner.team);
    const order = [...Array(teamsIn(format)).keys()].sort(
      (a, b) =>
        (sides.find((side) => side.team === b)?.score ?? 0) -
        (sides.find((side) => side.team === a)?.score ?? 0),
    );
    result = {
      title: !winner
        ? "MATCH OVER"
        : team!.some((side) => side.you)
          ? "YOU WIN!"
          : `${teamName(winner.team).toUpperCase()} ${team!.length > 1 ? "WIN" : "WINS"}`,
      lines: [
        kings
          ? order
              .map((each) => `${teamName(each)} ${world.points[each] ?? 0}`)
              .join(" · ")
          : `${teamName(0)} ${world.score[0]} – ${world.score[1]} ${teamName(1)}`,
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
    lobbyFormat = view.settings.format,
    teams = lobbyFormat !== "1v1",
    mode =
      MODE_CHOICES.find((choice) => choice.format === lobbyFormat)?.title ?? "";
  const fill = teams && seats.length < needed ? needed - seats.length : 0;
  const colours =
    lobbyFormat === "2v2v2"
      ? "2 V 2 V 2, king of the court: seats 1 and 4 play cyan, 2 and 5 pink, 3 and 6 lime. Winners stay on, losers swap with the waiting team."
      : lobbyFormat === "3v3"
        ? "3 V 3 on one big court: seats 1, 3 and 5 play cyan, 2, 4 and 6 pink."
        : "2 V 2: seats 1 and 3 play cyan, 2 and 4 pink.";
  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? seats.length > needed
        ? `${mode} takes ${needed} seats: pick a bigger match, or remove a bot.`
        : !teams && seats.length < needed
          ? "A match needs two players: invite a friend or add a bot."
          : fill
            ? `${colours} START adds ${plural(fill, "bot", "bots")} for the empty ${fill === 1 ? "seat" : "seats"}.`
            : view.settings.display
              ? "Shared screen: open the TV screen, then every player uses a phone"
              : teams
                ? colours
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
      canStart: teams
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

/** Every point on the board: both sides', or three teams of two, all three teams'. */
const totalOf = (world: NonNullable<View["world"]>): number =>
  world.format === "2v2v2"
    ? world.points.reduce((sum, each) => sum + each, 0)
    : world.score[0] + world.score[1];

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
      total = totalOf(world);
    }
    const delta = (world.pointCounter - counted + 0x10000) % 0x10000;
    if (delta === 0 || delta >= 0x8000) return [];
    const settled =
      world.phase !== "dead" ||
      world.remaining <= DEAD_STEPS - POINT_SETTLE_STEPS;
    if (!settled) return [];
    counted = world.pointCounter;
    const scored = totalOf(world) !== total;
    total = totalOf(world);
    // A classic side-out moves the serve, not the score: it is not a point.
    if (!scored) return [];
    // Normally one rally at a time; a device that slept through several reports the last.
    const loser = world.lastFault;
    if (loser === -1) return [];
    const winner = loser === 0 ? 1 : 0;
    const myBlob = world.blobs.find((blob) => blob.id === me);
    if (!myBlob || myBlob.benched) return [];
    const winningTeam =
      world.format === "2v2v2" ? world.onCourt[winner] : winner;
    const mine = winner === myBlob.side,
      toBot = view.roster.some(
        (entrant) =>
          teamOfSlot(entrant.slot, world.format) === winningTeam && entrant.bot,
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
