import { CAPACITY, MIN_RIDERS } from "../basics.js";
import type { Reason } from "../engine/index.js";
import { BREAK_STEPS, secondsLeft } from "../engine/view-kit.js";
import type { View } from "../online/game.js";

/**
 * What the page shows, decided from one frame: the screen (lobby, the deck, or a phone controller for a shared
 * screen), the lobby's roster, choices and buttons, the riders, the line a controller reads and the match result.
 * Pure, so the decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the deck and never plays. */
  display: boolean;
}

/** The lobby's choices. A room may hold other values (a link or the dev hook set them); then none is lit. */
export const HIT_CHOICES = [
  { value: 2, title: "2" },
  { value: 3, title: "3" },
  { value: 4, title: "4" },
  { value: 5, title: "5" },
] as const;
export const TIME_CHOICES = [
  { value: 30, title: "30 S" },
  { value: 60, title: "60 S" },
  { value: 90, title: "90 S" },
  { value: 120, title: "2 MIN" },
] as const;
export const PACE_CHOICES = [
  { value: 0, title: "CHILL" },
  { value: 1, title: "STANDARD" },
  { value: 2, title: "FRANTIC" },
] as const;
export const TARGET_CHOICES = [
  { value: 1, title: "1" },
  { value: 2, title: "2" },
  { value: 3, title: "3" },
  { value: 5, title: "5" },
] as const;
export const RECOVER_CHOICES = [
  { value: true, title: "ON" },
  { value: false, title: "OFF" },
] as const;
export const BOT_CHOICES = [
  { value: 0, title: "EASY" },
  { value: 1, title: "NORMAL" },
  { value: 2, title: "HARD" },
] as const;

/** One rider of the match. */
export interface RiderLine {
  id: string;
  slot: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** The seat is gone or its device is not connected. */
  away: boolean;
  wins: number;
  out: boolean;
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  /** This device has a rider in the match being played: its controls are live. */
  riding: boolean;
  /** This device's rider slot in the match, or −1. */
  localSlot: number;
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
    /** A bot is seated: the level choice matters. */
    hasBot: boolean;
  };
  /** The match's riders in lane order. */
  riders: RiderLine[];
  /** Each rider's name by slot, for the tags over their heads and the cards. */
  names: readonly string[];
  /** One line for a phone controller: hits left, a round's call, the result. */
  status: string;
  /** A line under the deck for a device that is not playing. */
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
/** Names as one phrase: "A", "A & B" or "A, B & C". */
export const listNames = (names: readonly string[]): string =>
  names.length > 2
    ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`
    : names.join(" & ");

export function present(view: View, viewer: Viewer): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.world;
  const inMatch = view.stage !== "lobby" && !!world;
  const localSlot =
    inMatch && world
      ? world.riders.findIndex((each) => each.id === viewer.me)
      : -1;
  const riding = view.stage === "running" && localSlot !== -1;
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && localSlot !== -1
      ? "controller"
      : "play";

  const riders: RiderLine[] =
    inMatch && world
      ? view.roster.map((entrant) => {
          const seat = view.seats.find((each) => each.id === entrant.id);
          const rider = world.riders[entrant.slot];
          return {
            id: entrant.id,
            slot: entrant.slot,
            name: entrant.name,
            you: entrant.id === viewer.me,
            bot: entrant.bot,
            away: !entrant.bot && (!seat || seat.away || !seat.connected),
            wins: rider?.wins ?? 0,
            out: rider?.out ?? false,
          };
        })
      : [];
  const me = world && localSlot !== -1 ? world.riders[localSlot] : undefined;

  let status = "";
  if (world && inMatch) {
    if (view.stage === "over" || world.phase === "over")
      status = !me
        ? "MATCH OVER"
        : !world.winners.includes(localSlot)
          ? "YOU LOSE"
          : world.winners.length > 1
            ? "A DRAW!"
            : "YOU WIN!";
    else if (!me) status = `ROUND ${world.round}`;
    else if (world.phase === "ready")
      status = `ROUND ${world.round} · GET READY`;
    else if (world.phase === "break")
      status = !world.lastWinners.includes(localSlot)
        ? "ROUND LOST"
        : world.lastWinners.length > 1
          ? "ROUND DRAWN"
          : "ROUND WON!";
    else if (me.out) status = "KNOCKED OFF";
    else {
      const left = world.maxHits - me.hits;
      status = `${plural(left, "HIT", "HITS")} LEFT · ${secondsLeft(world.clock)} S`;
    }
  }

  let note = "";
  if (inMatch && !viewer.display && localSlot === -1 && view.stage !== "over")
    note = seated
      ? "You ride in the next match"
      : mine
        ? "Watching"
        : "Pick a name to ride in the next match";

  let result: Model["result"] = null;
  if (view.stage === "over" && world && riders.length) {
    const winners = riders.filter((rider) => view.winners.includes(rider.id));
    const youWon = winners.some((rider) => rider.you);
    const title = !winners.length
      ? "MATCH OVER"
      : winners.length > 1
        ? youWon
          ? "A DRAW: YOU SHARE IT!"
          : `A DRAW: ${listNames(winners.map((rider) => rider.name)).toUpperCase()}`
        : youWon
          ? "YOU WIN!"
          : `${winners[0]!.name.toUpperCase()} WINS`;
    result = {
      title,
      lines: [...riders]
        .sort((a, b) => b.wins - a.wins || a.slot - b.slot)
        .map((rider) => {
          const stats = world.riders[rider.slot];
          return `${rider.name}: ${plural(rider.wins, "round", "rounds")} · ${stats?.dodges ?? 0} dodged · ${plural(stats?.taken ?? 0, "hit", "hits")}`;
        }),
      host: viewer.host,
      waiting: viewer.host ? "" : "Waiting for the host to start a rematch",
    };
  }

  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? seats.length < MIN_RIDERS
        ? "A match needs two riders: invite a friend or add a bot."
        : view.settings.display
          ? "Shared screen: open the TV screen, then every rider uses a phone"
          : ""
      : "Waiting for the host to start";
  return {
    screen,
    askName: !seated && !viewer.display && !viewer.solo && !mine,
    seated,
    riding,
    localSlot,
    controlsVisible:
      view.stage === "running" && world?.phase === "ready" && world.round === 1,
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
      canStart: seats.length >= MIN_RIDERS,
      editable: viewer.host,
      note: lobbyNote,
      hasBot: seats.some((seat) => seat.bot),
    },
    riders,
    names: world
      ? world.riders.map(
          (each) =>
            view.roster.find((entrant) => entrant.id === each.id)?.name ?? "",
        )
      : [],
    status,
    note,
    result,
  };
}

/** One round as the metrics report it: nothing here names a player or a room. */
export interface RoundReport {
  round: number;
  reason: Reason;
  /** This device's rider took the round, alone or shared. */
  won: boolean;
  riders: number;
  /** Seconds the round was given, and hits a rider could take. */
  seconds: number;
  hits: number;
}

/** A round is counted this far into its break, in steps: past any rollback of the round's end. */
export const ROUND_SETTLE_STEPS = 60;

/**
 * Finds the rounds a device should report, once each: only rounds its own rider played, counted once the break
 * after them has run `ROUND_SETTLE_STEPS`, so a predicted ending that a rollback takes back is never reported.
 */
export function createRoundWatch(): (view: View, me: string) => RoundReport[] {
  let match = "",
    counted = 0;
  return (view, me) => {
    const world = view.world;
    if (!world || view.stage === "lobby" || !view.matchId) return [];
    if (view.matchId !== match) {
      match = view.matchId;
      counted = 0;
    }
    if (world.round <= counted) return [];
    const settled =
      world.phase === "over" ||
      (world.phase === "break" &&
        world.remaining <= BREAK_STEPS - ROUND_SETTLE_STEPS);
    if (!settled) return [];
    counted = world.round;
    const slot = world.riders.findIndex((rider) => rider.id === me);
    if (slot === -1) return [];
    return [
      {
        round: world.round,
        reason: world.lastReason,
        won: world.lastWinners.includes(slot),
        riders: world.riders.length,
        seconds: view.play.seconds,
        hits: view.play.hits,
      },
    ];
  };
}
