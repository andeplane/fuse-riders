import type { View } from "../online/game.js";
import { CAPACITY, STEPS_PER_SECOND } from "../engine/index.js";
import { FINAL_STEPS } from "../engine/view-kit.js";

/** How long the start of the last stretch is announced. */
const FINAL_BANNER_STEPS = 90;

/**
 * What the page shows, decided from one frame: the screen (lobby, the depot, or a phone controller for a shared
 * screen), the lobby's roster and buttons, the HUD's cards, clock and banner, the scoreboard between rounds and the
 * match result. Pure, so the decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the depot and never plays. */
  display: boolean;
}

export interface Card {
  id: string;
  slot: number;
  tag: string;
  name: string;
  /** Wagons delivered this round. */
  score: number;
  /** Wagons it pulls right now. */
  carrying: number;
  full: boolean;
  /** Round wins this match. */
  wins: number;
  place: number;
  state: "ready" | "driving" | "out";
  you: boolean;
  bot: boolean;
  away: boolean;
}
export interface Row {
  place: number;
  name: string;
  slot: number;
  score: number;
  detail: string;
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  driving: boolean;
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
  };
  cards: Card[];
  time: string;
  /** The last stretch: the clock flashes and the depot calls for one last delivery. */
  urgent: boolean;
  callout: string;
  round: string;
  banner: { title: string; detail: string; tone: string } | null;
  /** Between rounds: the round just played. */
  board: { title: string; rows: Row[]; next: string } | null;
  note: string;
  result: {
    title: string;
    lines: string[];
    host: boolean;
    waiting: string;
  } | null;
  labels: Map<string, string>;
}

export const tag = (slot: number): string => `P${slot + 1}`;

/** `mm:ss` of simulation steps, rounded up so the clock reads 00:00 only at the whistle. */
export function clockText(steps: number): string {
  const seconds = Math.ceil(Math.max(0, steps) / STEPS_PER_SECOND),
    minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const wagons = (n: number) => `${n} ${n === 1 ? "wagon" : "wagons"}`;
const joined = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;

export function present(view: View, viewer: Viewer): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.world;
  const train = world?.trains.find((t) => t.id === viewer.me);
  const inMatch = view.stage !== "lobby";
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && seated
      ? "controller"
      : "play";
  const name = (id: string) =>
    view.seats.find((seat) => seat.id === id)?.name ??
    view.results.flatMap((r) => r.placings).find((p) => p.id === id)?.name ??
    "Nobody";
  const slotOf = (id: string) =>
    view.seats.find((seat) => seat.id === id)?.slot ??
    world?.trains.find((t) => t.id === id)?.slot ??
    0;

  const cards: Card[] = seats.map((seat) => {
    const t = world?.trains.find((each) => each.id === seat.id);
    return {
      id: seat.id,
      slot: seat.slot,
      tag: tag(seat.slot),
      name: seat.name,
      score: t?.score ?? 0,
      carrying: t?.wagons.length ?? 0,
      full: t?.full ?? false,
      wins: view.wins[seat.id] ?? 0,
      place: t?.place ?? 0,
      state: !inMatch ? "ready" : t ? "driving" : "out",
      you: seat.id === viewer.me,
      bot: seat.bot,
      away: seat.away || (!seat.connected && !seat.bot),
    };
  });

  let banner: Model["banner"] = null;
  if (world && view.stage === "running") {
    if (world.phase === "countdown") {
      const seconds = Math.ceil(world.remaining / STEPS_PER_SECOND);
      banner = {
        title: seconds > 0 ? String(seconds) : "GO!",
        detail: "COLLECT · STEAL · DELIVER",
        tone: "count",
      };
    } else if (world.phase === "play" && world.played < 50)
      banner = { title: "GO!", detail: "", tone: "go" };
    else if (world.final && world.timeLeft > FINAL_STEPS - FINAL_BANNER_STEPS)
      banner = {
        title: `${FINAL_STEPS / STEPS_PER_SECOND} SECONDS LEFT!`,
        detail: "",
        tone: "final",
      };
    else if (world.phase === "outro") {
      const top = Math.max(0, ...world.trains.map((t) => t.score));
      const leaders = world.trains.filter((t) => top > 0 && t.score === top);
      banner = !leaders.length
        ? {
            title: "NO DELIVERIES",
            detail: "Nobody wins the round",
            tone: "draw",
          }
        : leaders.length === 1
          ? {
              title: `${tag(leaders[0]!.slot)} WINS THE ROUND!`,
              detail: `${name(leaders[0]!.id)} delivered ${wagons(top)}`,
              tone: `seat-${leaders[0]!.slot}`,
            }
          : {
              title: "SHARED ROUND!",
              detail: `${joined(leaders.map((t) => name(t.id)))} on ${wagons(top)}`,
              tone: "draw",
            };
    }
  }

  let board: Model["board"] = null;
  if (view.stage === "between") {
    const last = view.results.at(-1);
    board = {
      title: !last?.winners.length
        ? `ROUND ${last?.round ?? view.round}: NO DELIVERIES`
        : last.winners.length === 1
          ? `ROUND ${last.round}: ${name(last.winners[0]!).toUpperCase()} +1 WIN`
          : `ROUND ${last.round}: SHARED WIN`,
      rows: (last?.placings ?? []).map((p) => ({
        place: p.place,
        name: p.name,
        slot: p.slot,
        score: p.score,
        detail: [
          `${view.wins[p.id] ?? 0}/${view.winsNeeded} wins`,
          p.stolen ? `cut ${p.stolen} loose` : "",
          p.stranded ? `${p.stranded} never delivered` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      })),
      next: `Round ${view.round + 1} in ${Math.ceil(view.resumeIn / 20)}…`,
    };
  }

  let note = "";
  if (world && view.stage === "running" && !viewer.display) {
    if (!train && seated) note = "You join the next round";
    else if (!seated)
      note = mine ? "Watching" : "Pick a name to drive from the next round";
  }

  let result: Model["result"] = null;
  if (view.stage === "over") {
    const ids = [
      ...new Set([
        ...Object.keys(view.wins),
        ...Object.keys(view.totals),
        ...seats.map((s) => s.id),
      ]),
    ];
    const rows = ids
      .map((id) => ({
        id,
        wins: view.wins[id] ?? 0,
        total: view.totals[id] ?? 0,
      }))
      .sort(
        (a, b) =>
          b.wins - a.wins || b.total - a.total || slotOf(a.id) - slotOf(b.id),
      )
      .slice(0, CAPACITY + 3);
    const placeOf = (row: (typeof rows)[number]) =>
      1 +
      rows.filter(
        (other) =>
          other.wins > row.wins ||
          (other.wins === row.wins && other.total > row.total),
      ).length;
    result = {
      title:
        view.winners.length === 1
          ? `${name(view.winners[0]!).toUpperCase()} RUNS THE DEPOT!`
          : view.winners.length > 1
            ? `SHARED VICTORY: ${joined(view.winners.map(name)).toUpperCase()}`
            : "THE DEPOT WINS",
      lines: rows.map(
        (row) =>
          `${placeOf(row)}. ${name(row.id)} — ${row.wins} ${row.wins === 1 ? "win" : "wins"} · ${wagons(row.total)}`,
      ),
      host: viewer.host,
      waiting: viewer.host ? "" : "Waiting for the host to start a rematch",
    };
  }

  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? view.settings.display
        ? "Shared screen: open the TV screen, then everyone joins on their phone"
        : ""
      : "Waiting for the host to start";
  const clock =
    !world || world.phase === "countdown"
      ? (world?.length ?? view.play.seconds * STEPS_PER_SECOND)
      : world.timeLeft;
  return {
    screen,
    askName: !seated && !viewer.display && !viewer.solo && !mine,
    seated,
    driving: !!train && world?.phase === "play",
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
      canStart: seats.length > 0,
      editable: viewer.host,
      note: lobbyNote,
    },
    cards,
    time: clockText(clock),
    urgent: world?.final ?? false,
    callout: world?.final ? "ONE LAST DELIVERY!" : "",
    round: inMatch
      ? `ROUND ${Math.max(1, view.round)} · FIRST TO ${view.winsNeeded} ${view.winsNeeded === 1 ? "WIN" : "WINS"}`
      : "",
    banner,
    board,
    note,
    result,
    labels: new Map(
      (world?.trains ?? []).map((t) => [
        t.id,
        t.id === viewer.me ? "YOU" : tag(t.slot),
      ]),
    ),
  };
}
