import type { Frame } from "fuse-netcode";
import { MAPS, isQueenSlot } from "../engine/index.js";
import {
  CAPACITY,
  STEPS_PER_TICK,
  botName,
  countdownTicks,
  teamOfSlot,
  type BotLevel,
  type Settings,
  type VictoryKind,
  type View,
} from "../online/index.js";

/**
 * What the Killer Fuse page shows, as a pure function of the room's view and who this device is. The arena itself is
 * the renderer's (`src/render`): this decides the lobby, the seat buttons, the banners around the arena and the
 * result. Everything comes from the view (state), never from events, so a rollback corrects what is shown.
 */
export interface Viewer {
  /** This device's member id ("" before the room service admitted it). */
  me: string;
  solo: boolean;
  /** The shared screen (`?display=1`): it shows the arena and never plays. */
  display: boolean;
}

export const TEAM_NAMES = ["CYAN", "PINK"] as const;
export const TEAM_KEYS = ["cyan", "pink"] as const;
export const VICTORY_NAMES: Record<VictoryKind, string> = {
  military: "MILITARY",
  economy: "ECONOMIC",
  snail: "SNAIL",
};
/** What a victory of each kind was, in a sentence fragment. */
export const VICTORY_DEEDS: Record<VictoryKind, string> = {
  military: "killed the enemy Queen three times",
  economy: "filled the hive with berries",
  snail: "rode the snail home",
};
export const BOT_LEVELS: readonly { value: BotLevel; label: string }[] = [
  { value: "easy", label: "EASY" },
  { value: "medium", label: "MEDIUM" },
  { value: "hard", label: "HARD" },
];
export const roleOf = (slot: number): "QUEEN" | "WORKER" =>
  isQueenSlot(slot) ? "QUEEN" : "WORKER";
/** "Cyan Queen", "Pink Worker": a seat in words. */
export const seatTitle = (slot: number): string =>
  `${teamOfSlot(slot) === 0 ? "Cyan" : "Pink"} ${isQueenSlot(slot) ? "Queen" : "Worker"}`;

/** What a tap on a seat does for this device: sit there, ask its holder to swap, answer their wish, or take a wish back. */
export type SeatAction = "none" | "take" | "ask" | "accept" | "withdraw";
export interface SeatModel {
  slot: number;
  team: number;
  role: "QUEEN" | "WORKER";
  /** The person's name, or the bot's. */
  name: string;
  kind: "you" | "player" | "away" | "bot";
  action: SeatAction;
  /** The seat button's text; "" when a tap does nothing. */
  label: string;
  /** What is pending about this seat, in words. */
  note: string;
}
export interface SettingsModel {
  botLevel: BotLevel;
  map: Settings["map"];
  wins: number;
  /** This device may change them. */
  editable: boolean;
  /** For a device that may not: the settings in one line. */
  summary: string;
}
export interface LobbyModel {
  teams: { name: string; key: string; seats: SeatModel[] }[];
  watchers: string[];
  showStart: boolean;
  canStart: boolean;
  note: string;
  settings: SettingsModel;
}
export interface ArenaModel {
  /** Display names by slot, as the renderer tags the units: "" where a bot plays. */
  names: string[];
  /** The slot this device plays, or -1. */
  localSlot: number;
  /** Games won this set, per team, and how many take it. */
  score: number[];
  wins: number;
  line: string;
  /** A game counting down, for the countdown card: its number, its map, log ticks since it began and until play. */
  countdown?: {
    round: number;
    map: string;
    elapsed: number;
    left: number;
  };
  /** Over the arena: the pause after a game. */
  banner?: { title: string; detail: string; team?: number };
}
export interface ResultModel {
  title: string;
  /** The team that took the set. */
  team: number;
  games: string[];
  players: string[];
  /** This device may start the rematch or return to the lobby. */
  host: boolean;
  waiting: string;
}
export interface PageModel {
  screen: "lobby" | "arena";
  /** A seated phone in a shared-screen room is a controller: the pad and the button, no arena. */
  layout: "arena" | "controller";
  /** This device holds a seat (a unit of its own). */
  seated: boolean;
  /** This device is in the watching list. */
  watching: boolean;
  /** This device should offer its name: neither seated nor watching, nor the shared screen. */
  askName: boolean;
  /** A seat is free for a person: JOIN is offered beside WATCH. */
  canJoin: boolean;
  /** This device's controls drive a unit right now. */
  playing: boolean;
  host: boolean;
  lobby: LobbyModel;
  arena: ArenaModel;
  result?: ResultModel;
  /** How many of the six units people play, and how many the bots do. */
  humans: number;
  bots: number;
}

const TICKS_PER_SECOND = 20;
const secondsUntil = (tick: number, now: number): number =>
  Math.max(1, Math.ceil((tick - now) / TICKS_PER_SECOND));
const count = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
const mapName = (map: Settings["map"]): string =>
  map === 0 ? "Maps rotate" : MAPS[map].name;
export const settingsSummary = (settings: Settings): string =>
  `${settings.botLevel[0]!.toUpperCase()}${settings.botLevel.slice(1)} bots · ${mapName(settings.map)} · First to ${settings.wins}`;

function seats(view: View, viewer: Viewer): SeatModel[] {
  const mine = view.seats.find(
      (seat) => seat.id === viewer.me && !seat.watcher,
    ),
    // Seats change in the lobby only, and only for a connected player: the fold refuses the rest.
    canMove = view.stage === "lobby" && !viewer.display && mine?.connected;
  return Array.from({ length: CAPACITY }, (_, slot) => {
    const holder = view.seats.find(
        (seat) => !seat.watcher && seat.slot === slot,
      ),
      base = { slot, team: teamOfSlot(slot), role: roleOf(slot) };
    if (!holder)
      return {
        ...base,
        name: botName(slot),
        kind: "bot" as const,
        action: canMove ? ("take" as const) : ("none" as const),
        label: canMove ? "SIT HERE" : "",
        note: "",
      };
    if (holder.id === viewer.me) {
      const asker = view.seats.find((seat) => view.asks[seat.id] === slot);
      return {
        ...base,
        name: holder.name,
        kind: "you" as const,
        action: "none" as const,
        label: "",
        note: asker ? `${asker.name} asks to swap` : "",
      };
    }
    const kind = holder.connected ? ("player" as const) : ("away" as const),
      person = { ...base, name: holder.name, kind };
    if (!canMove || !mine)
      return { ...person, action: "none" as const, label: "", note: "" };
    if (view.asks[holder.id] === mine.slot)
      return {
        ...person,
        action: "accept" as const,
        label: "SWAP",
        note: `${holder.name} asks for your seat`,
      };
    if (view.asks[mine.id] === slot)
      return {
        ...person,
        action: "withdraw" as const,
        label: "CANCEL",
        note: "You asked to swap",
      };
    return {
      ...person,
      action: "ask" as const,
      label: "ASK TO SWAP",
      note: "",
    };
  });
}

function lobby(
  view: View,
  viewer: Viewer,
  all: SeatModel[],
  host: boolean,
): LobbyModel {
  const people = all.filter((seat) => seat.kind !== "bot").length;
  return {
    teams: TEAM_NAMES.map((name, team) => ({
      name,
      key: TEAM_KEYS[team]!,
      seats: all.filter((seat) => seat.team === team),
    })),
    watchers: view.seats
      .filter((seat) => seat.watcher)
      .map((seat) => seat.name),
    showStart: host,
    canStart: host && people > 0,
    note: host
      ? people > 0
        ? "Bots play every empty seat"
        : "Take a seat to start"
      : viewer.display
        ? "Waiting for the host to start"
        : people > 0
          ? "Waiting for the host to start"
          : "Waiting for players",
    settings: {
      botLevel: view.settings.botLevel,
      map: view.settings.map,
      wins: view.settings.wins,
      editable: host,
      summary: settingsSummary(view.settings),
    },
  };
}

function arena(view: View, viewer: Viewer): ArenaModel {
  const names = view.crew.map(
      (id) => view.seats.find((seat) => seat.id === id)?.name ?? "",
    ),
    localSlot =
      viewer.display || !viewer.me ? -1 : view.crew.indexOf(viewer.me),
    wins = view.play.wins,
    line = `CYAN ${view.score[0]} · ${view.score[1]} PINK · FIRST TO ${wins}`;
  let banner: ArenaModel["banner"];
  const world = view.world,
    last = view.results.at(-1);
  const countdown =
    view.stage === "running" && world && view.logTick < view.startAt
      ? {
          round: view.round,
          map: world.map.name,
          elapsed: Math.max(
            0,
            view.logTick - (view.startAt - 1 - countdownTicks(view.round)),
          ),
          left: view.startAt - view.logTick,
        }
      : undefined;
  if (view.stage === "between" && last)
    banner = {
      title: `${TEAM_NAMES[last.team]} TAKES GAME ${last.round}`,
      detail: `${VICTORY_NAMES[last.kind]} VICTORY · Next game in ${secondsUntil(view.resumeAt, view.logTick)}`,
      team: last.team,
    };
  return {
    names,
    localSlot,
    score: [...view.score],
    wins,
    line,
    ...(countdown ? { countdown } : {}),
    ...(banner ? { banner } : {}),
  };
}

function result(view: View, viewer: Viewer, host: boolean): ResultModel {
  const team = view.winner,
    mine = view.roster[viewer.me],
    played = mine !== undefined && !viewer.display;
  return {
    title: played
      ? teamOfSlot(mine.slot) === team
        ? "YOUR TEAM WINS!"
        : "YOUR TEAM LOST"
      : `${TEAM_NAMES[team]} WINS THE SET`,
    team,
    games: view.results.map(
      (record) =>
        `Game ${record.round}, ${MAPS[record.mapId].name}: ${TEAM_NAMES[record.team]} ${VICTORY_DEEDS[record.kind]} in ${Math.round(record.steps / (STEPS_PER_TICK * TICKS_PER_SECOND))} s`,
    ),
    players: Object.entries(view.roster)
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1))
      .map(({ id, name, slot }) => {
        const stats = view.stats[id];
        return `${name} (${seatTitle(slot)}): ${count(stats?.kills ?? 0, "kill")}, ${count(stats?.deaths ?? 0, "death")}, ${count(stats?.berries ?? 0, "berry", "berries")}`;
      }),
    host,
    waiting: host ? "" : "Waiting for the host to start a rematch",
  };
}

export function present(view: Frame<View>, viewer: Viewer): PageModel {
  const mine = view.seats.find((seat) => seat.id === viewer.me),
    seated = mine !== undefined && !mine.watcher && !viewer.display,
    watching = mine?.watcher === true && !viewer.display,
    host = !viewer.display && viewer.me !== "" && view.managerId === viewer.me,
    all = seats(view, viewer),
    people = all.filter((seat) => seat.kind !== "bot").length,
    humans = view.crew.filter((id) => id !== "").length;
  return {
    screen: view.stage === "lobby" ? "lobby" : "arena",
    layout: view.settings.display && seated ? "controller" : "arena",
    seated,
    watching,
    askName: !seated && !watching && !viewer.display && viewer.me !== "",
    canJoin: people < CAPACITY,
    playing:
      seated &&
      view.stage === "running" &&
      mine.connected &&
      view.logTick >= view.startAt - 1 &&
      !view.world?.winner,
    host,
    lobby: lobby(view, viewer, all, host),
    arena: arena(view, viewer),
    ...(view.stage === "over" ? { result: result(view, viewer, host) } : {}),
    humans,
    bots: CAPACITY - humans,
  };
}
