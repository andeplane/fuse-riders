import type { View } from "../online/game.js";
import { CAPACITY } from "../engine/index.js";

/**
 * What the page shows, decided from one frame: the screen (lobby, the cave, or a phone controller for a shared
 * screen), the lobby's roster and buttons, the HUD's cards, timer and banner, and the match result. Pure, so the
 * decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the cave and never plays. */
  display: boolean;
}

export interface Card {
  id: string;
  slot: number;
  tag: string;
  name: string;
  crowns: number;
  state: "ready" | "flying" | "crashed" | "escaped" | "out";
  you: boolean;
  bot: boolean;
  away: boolean;
  /** Active effects, for the status dots. */
  effects: ("shield" | "triple" | "turbo" | "scramble" | "stun")[];
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  flying: boolean;
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
  /** How far the camera is to the exit, 0–1. */
  progress: number;
  round: string;
  banner: { title: string; detail: string; tone: string } | null;
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

/** `mm:ss.t` of simulation steps at 60 a second. */
export function clockText(steps: number): string {
  const tenths = Math.floor(Math.max(0, steps) / 6),
    minutes = Math.floor(tenths / 600),
    seconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

export function present(view: View, viewer: Viewer): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.world;
  const chopper = world?.choppers.find((c) => c.id === viewer.me);
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
    world?.choppers.find((c) => c.id === id)?.slot ??
    0;

  const cards: Card[] = seats.map((seat) => {
    const c = world?.choppers.find((each) => each.id === seat.id);
    const effects: Card["effects"] = [];
    if (c?.shield) effects.push("shield");
    if (c && c.triple > 0) effects.push("triple");
    if (c && c.turbo > 0) effects.push("turbo");
    if (c && c.scramble > 0) effects.push("scramble");
    if (c && c.stun > 0) effects.push("stun");
    return {
      id: seat.id,
      slot: seat.slot,
      tag: tag(seat.slot),
      name: seat.name,
      crowns: view.wins[seat.id] ?? 0,
      state: !inMatch ? "ready" : c ? c.state : "out",
      you: seat.id === viewer.me,
      bot: seat.bot,
      away: seat.away || (!seat.connected && !seat.bot),
      effects,
    };
  });

  let banner: Model["banner"] = null;
  if (world && view.stage === "running") {
    if (world.phase === "countdown") {
      const seconds = Math.ceil(world.remaining / 60);
      banner = {
        title: seconds > 0 ? String(seconds) : "GO!",
        detail:
          world.lift === "classic"
            ? "HOLD TO CLIMB · LET GO TO FALL"
            : "W / S TO FLY UP AND DOWN",
        tone: "count",
      };
    } else if (world.played < 50)
      banner = { title: "GO!", detail: "", tone: "go" };
    else if (world.phase === "outro")
      banner =
        world.winner === null || world.winner === ""
          ? {
              title: "NOBODY SURVIVED",
              detail: "No crown this round",
              tone: "draw",
            }
          : {
              title: `${tag(slotOf(world.winner))} WINS THE ROUND!`,
              detail: `${name(world.winner)} takes the crown`,
              tone: `seat-${slotOf(world.winner)}`,
            };
  } else if (view.stage === "between") {
    const last = view.results.at(-1);
    banner = {
      title: last?.winner ? `${name(last.winner).toUpperCase()} +1 ♛` : "DRAW",
      detail: `Round ${view.round + 1} in ${Math.ceil(view.resumeIn / 20)}…`,
      tone: last?.winner ? `seat-${slotOf(last.winner)}` : "draw",
    };
  }

  let note = "";
  if (world && view.stage === "running" && viewer.display === false) {
    if (!chopper && seated) note = "You join the next round";
    else if (!seated) note = "Watching";
    else if (chopper?.state === "crashed")
      note = "Crashed! Watch the rest fight it out";
    else if (chopper?.state === "escaped") note = "You escaped the cave!";
  }

  let result: Model["result"] = null;
  if (view.stage === "over") {
    const standings = [
      ...new Set([...Object.keys(view.wins), ...seats.map((s) => s.id)]),
    ]
      .map((id) => ({ id, crowns: view.wins[id] ?? 0 }))
      .sort((a, b) => b.crowns - a.crowns || slotOf(a.id) - slotOf(b.id))
      .slice(0, CAPACITY + 3);
    result = {
      title: view.winner
        ? `${name(view.winner).toUpperCase()} RULES THE CAVE!`
        : "THE CAVE WINS",
      lines: standings.map(
        (row, i) =>
          `${i + 1}. ${name(row.id)} — ${row.crowns} ${row.crowns === 1 ? "crown" : "crowns"}`,
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
  return {
    screen,
    askName: !seated && !viewer.display && !viewer.solo && !mine,
    seated,
    flying: chopper?.state === "flying",
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
    time: clockText(world?.played ?? 0),
    progress: world
      ? Math.max(0, Math.min(1, world.camX / world.cameraEnd))
      : 0,
    round: inMatch
      ? `ROUND ${Math.max(1, view.round)} · FIRST TO ${view.winsNeeded} ♛`
      : "",
    banner,
    note,
    result,
    labels: new Map(
      (world?.choppers ?? []).map((c) => [
        c.id,
        c.id === viewer.me ? "YOU" : tag(c.slot),
      ]),
    ),
  };
}
