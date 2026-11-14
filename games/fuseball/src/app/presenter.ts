import {
  CAPACITY,
  MAPS,
  MAP_IDS,
  RANDOM,
  mapOf,
  ZAP_STEPS,
  type MapId,
} from "../engine/index.js";
import type { View } from "../online/game.js";

/**
 * What the page shows, decided from one frame: the screen (lobby, the arena, or a phone controller for a shared
 * screen), the lobby's roster, map choice and buttons, the two sides of the duel, the line a controller reads and
 * the match result. Pure, so the decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the arena and never plays. */
  display: boolean;
}

/** What each arena is like, in a line, for the lobby's map picker. */
export const MAP_BLURBS: Readonly<Record<MapId, string>> = {
  gridlock: "Wraps sideways. The goals are the gaps in the side wall.",
  downlink: "Wraps top to bottom. The goals are the shafts in the floor.",
  halo: "Wraps every way. Two round goals float up high.",
  overflow: "Wraps every way. Side-wall goals, and holes in the floor.",
  firewall: "No floor at all. The goals hide behind two short walls.",
  cornercase: "Wraps top to bottom. The goals are the corner pockets.",
  coredump: "Wraps top to bottom. Both goals are pits in the middle.",
  bruteforce: "A force field guards each goal. Three hits break it.",
  bouncerate: "A closed box of bumpers. One guards each goal.",
  portforward: "Corner portals carry the ball across. Roofed pits.",
  backdoor: "Trapdoors shut the pits. Knock one open, then drop in.",
  stacktrace: "Lifts ride up to the goals. Ledges you jump up through.",
  random: "A mirrored arena from a seed. Re-roll or share your favourite.",
};

export interface Side {
  id: string;
  slot: 0 | 1;
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
  /** This device has a rider in the match being played: its controls are live. */
  riding: boolean;
  /** This device's rider in the match, or −1: the arena marks it. */
  localSlot: 0 | 1 | -1;
  /** The control guide shows for a match's first countdown; `guideKey` names that match. */
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
    editable: boolean;
    note: string;
    maps: { id: MapId; name: string; blurb: string; selected: boolean }[];
  };
  /** The match's two riders in slot order; empty in the lobby. */
  sides: Side[];
  /** The riders' names for the arena's winner banner, once there is a match. */
  names: readonly [string, string] | undefined;
  /** The arena being played (or the lobby's choice). */
  mapName: string;
  /** One line for a phone controller: the countdown, the score, a goal, the result. */
  status: string;
  /** A line under the arena for a device that is not riding. */
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
  const rider = world?.riders.find((each) => each.id === viewer.me);
  const localSlot = inMatch && rider ? rider.slot : -1;
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
            name: entrant.name,
            you: entrant.id === viewer.me,
            bot: entrant.bot,
            away: !entrant.bot && (!seat || seat.away || !seat.connected),
            score: world.score[entrant.slot],
          };
        })
      : [];
  const names =
    sides.length === 2
      ? ([sides[0]!.name, sides[1]!.name] as const)
      : undefined;

  let status = "";
  if (world && inMatch) {
    const score = `${world.score[0]} – ${world.score[1]}`;
    if (view.stage === "over" || world.phase === "over")
      status =
        localSlot === -1
          ? score
          : world.winner === localSlot
            ? "YOU WIN!"
            : "YOU LOSE";
    else if (world.phase === "countdown")
      status = world.suddenDeath
        ? `SUDDEN DEATH · ${world.count}`
        : `${score} · ${world.count}`;
    else if (world.phase === "zap")
      status =
        localSlot === -1
          ? "GOAL!"
          : world.lastScorer === localSlot
            ? "YOU SCORED!"
            : "ZAPPED!";
    else status = world.suddenDeath ? "SUDDEN DEATH" : score;
  }

  let note = "";
  if (inMatch && !viewer.display && localSlot === -1 && view.stage !== "over")
    note = seated
      ? "You ride in the next match"
      : mine
        ? "Watching"
        : shared
          ? // A page showing a shared-screen match is the big screen, whoever opened it: nothing is asked of it.
            ""
          : "Pick a name to ride in the next match";

  let result: Model["result"] = null;
  if (view.stage === "over" && world && sides.length === 2) {
    const winner = sides.find((side) => side.id === view.winner);
    const [left, right] = [sides[0]!, sides[1]!];
    result = {
      title: winner
        ? winner.you
          ? "YOU WIN!"
          : `${winner.name.toUpperCase()} WINS`
        : "MATCH OVER",
      lines: [
        `${left.name} ${left.score} – ${right.score} ${right.name}`,
        ...sides.map((side) => {
          const stats = world.riders[side.slot];
          return `${side.name}: ${plural(stats.goals, "goal", "goals")}, ${plural(stats.ownGoals, "own goal", "own goals")}, ${plural(world.bubbles[side.slot].seq, "bubble", "bubbles")}`;
        }),
      ],
      host: viewer.host,
      waiting: viewer.host ? "" : "Waiting for the host to start a rematch",
    };
  }

  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? seats.length < CAPACITY
        ? "A duel needs two riders: invite a friend or add a bot."
        : view.settings.display
          ? "Shared screen: open the TV screen, then both riders play on their phones"
          : ""
      : "Waiting for the host to start";
  const playing = inMatch ? view.play.mapId : view.settings.mapId;
  return {
    screen,
    // A shared-screen match is watched on whatever page shows the arena, the room creator's included: the name
    // bar stays off it until the room is back in the lobby.
    askName:
      !seated &&
      !viewer.display &&
      !viewer.solo &&
      !mine &&
      !(shared && inMatch),
    seated,
    riding,
    localSlot,
    controlsVisible:
      view.stage === "running" &&
      world?.phase === "countdown" &&
      world.score[0] + world.score[1] === 0,
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
      canAddBot: viewer.host && seats.length < CAPACITY,
      removable: viewer.host ? seats.filter((s) => s.bot).map((s) => s.id) : [],
      showStart: viewer.host,
      canStart: seats.length === CAPACITY,
      editable: viewer.host,
      note: lobbyNote,
      maps: ([...MAP_IDS, RANDOM] as const).map((id) => ({
        id,
        name: id === RANDOM ? "Random" : MAPS[id].name,
        blurb: MAP_BLURBS[id],
        selected: id === view.settings.mapId,
      })),
    },
    sides,
    names,
    mapName:
      playing === RANDOM
        ? `Random · ${inMatch ? view.play.seed : view.settings.seed}`
        : mapOf(playing).name,
    status,
    note,
    result,
  };
}

/**
 * The match's round for the play metrics, which count a match as started only in round 1: 1 while the first countdown
 * is running and 2 from then on. A device that loads into a match already under way (a late join, a reload) is not
 * a second start with a shortened duration.
 */
export const playRound = (view: View): number =>
  view.world?.phase === "countdown" &&
  view.world.score[0] + view.world.score[1] === 0
    ? 1
    : 2;

/** One goal as the metrics report it: nothing here names a player or a room. */
export interface GoalReport {
  mapId: MapId;
  /** The loser of the point sent the ball in themselves. */
  ownGoal: boolean;
  /** The point was played at 2–2. */
  suddenDeath: boolean;
  /** The point went to this device's rider. */
  mine: boolean;
}

/** A point is counted this long into its celebration, in micro-steps: past any rollback of the goal itself. */
export const GOAL_SETTLE_STEPS = 60;

/**
 * Finds the goals a device should report, once each. Every device in a room sees every goal, so only the points this
 * device's rider was in are its to report, and of those only the ones it won — plus the ones it lost to a bot, which
 * has no device of its own. A point is counted once its celebration has run `GOAL_SETTLE_STEPS` (or play has moved
 * on), so a predicted goal that a rollback takes back is never reported. Only points scored while this page watched
 * count: one already on the board at the first frame is not reported again.
 */
export function createGoalWatch(): (view: View, me: string) => GoalReport[] {
  let match = "",
    counted = 0,
    ownGoals = 0;
  return (view, me) => {
    const world = view.world;
    if (!world || view.stage === "lobby" || !view.matchId) return [];
    const total = world.score[0] + world.score[1],
      given = world.riders[0].ownGoals + world.riders[1].ownGoals;
    if (view.matchId !== match) {
      // The first frame seen of a match is where the count starts: the points already on the board when a device
      // loads into it (a reload, a late join) were reported, or were never this page's to report.
      match = view.matchId;
      counted = total;
      ownGoals = given;
    }
    // Until this device knows who it is, a point waits: it is weighed once it does, not dropped.
    if (!me || total <= counted) return [];
    const settled =
      world.phase !== "zap" ||
      world.remaining <= 0 ||
      ZAP_STEPS - world.remaining >= GOAL_SETTLE_STEPS;
    if (!settled) return [];
    const reports: GoalReport[] = [];
    // Normally one point at a time; a device that slept through several reports the last and skips the rest.
    if (total === counted + 1 && world.lastScorer !== -1) {
      const scorer = world.lastScorer,
        mine = world.riders[scorer].id === me,
        mySlot = world.riders.find((rider) => rider.id === me)?.slot,
        toBot = view.roster.some(
          (entrant) => entrant.slot === scorer && entrant.bot,
        );
      if (mySlot !== undefined && (mine || toBot))
        reports.push({
          mapId: world.mapId,
          ownGoal: given > ownGoals,
          suddenDeath: total === world.target * 2 - 1,
          mine,
        });
    }
    counted = total;
    ownGoals = given;
    return reports;
  };
}
