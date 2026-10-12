import { defaultText, type RollbackGame, type Stage } from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
import { JOBS } from "./data/jobs.js";
import { holder } from "./actions.js";
import type { Economy } from "./economy.js";
import {
  AVATARS,
  BOT_PREFIX,
  BRIEFING,
  CAPACITY,
  MAX_WATCHERS,
  createRoom,
  foldTick,
  isAvatar,
  isFuseLaneEntry,
  nameOf,
  parseSettings,
  playerOrder,
  seatName,
  type FuseLaneEntry,
  type FuseLaneEvent,
  type FuseLaneRoom,
  type FuseLaneSettings,
} from "./rules.js";
import {
  createPlayer,
  defaultGoals,
  investments,
  liquid,
  netWorth,
  progress,
  stats,
  type Goals,
  type PlayerState,
} from "./state.js";

export interface FuseLanePlayerView {
  id: string;
  name: string;
  /** Roster slot: the player's colour. */
  slot: number;
  avatarId: string;
  bot: boolean;
  /** Seated and here (a bot always is). */
  present: boolean;
  /** A copy of the player's whole state. */
  state: PlayerState;
  hours: number;
  stats: Goals;
  progress: number;
  liquid: number;
  investments: number;
  netWorth: number;
}

/** What the page renders: a copy of everything it shows, so a frame never changes after it was made. */
export interface FuseLaneView {
  tick: number;
  phase: Stage;
  /** "week" while the week runs, "briefing" on Monday. */
  part: "week" | "briefing";
  week: number;
  /** Ticks left in the current part, and the part's length. */
  timerTicks: number;
  partTicks: number;
  weekSeconds: number;
  players: FuseLanePlayerView[];
  watchers: { id: string; name: string; connected: boolean }[];
  economy: Economy;
  /** Who holds each position, by job index. */
  holders: Record<number, string>;
  headlines: string[];
  ranking: string[];
  winners: string[];
  /** Goals picked in the lobby, by member id. */
  goals: Record<string, Goals>;
}

export function fuseLaneView(room: FuseLaneRoom): FuseLaneView {
  const economy = room.economy;
  const lobby = room.stage === "lobby";
  const ids = lobby
    ? [...room.seats.values()]
        .filter((seat) => !seat.watcher)
        .sort((a, b) => a.slot - b.slot)
        .map((seat) => seat.id)
    : playerOrder(room);
  const players = ids.map((id): FuseLanePlayerView => {
    const seat = room.seats.get(id),
      state = room.players[id];
    // In the lobby a seat has no life yet: it shows a fresh one with the goals it picked.
    const copy = state
      ? structuredClone(state)
      : createPlayer(room.goals[id] ?? defaultGoals());
    return {
      id,
      name: nameOf(room, id),
      slot: seat?.slot ?? room.roster[id]?.slot ?? 0,
      avatarId: seat?.avatarId ?? AVATARS[0],
      bot: seat?.bot ?? id.startsWith(BOT_PREFIX),
      present:
        seat !== undefined && !seat.watcher && (seat.bot || seat.connected),
      state: copy,
      hours: state ? state.time / 15 : 0,
      stats: state ? stats(state, economy) : [0, 0, 0, 0],
      progress: state ? progress(state, economy) : 0,
      liquid: state ? liquid(state, economy) : 0,
      investments: state ? investments(state, economy) : 0,
      netWorth: state ? netWorth(state, economy) : 0,
    };
  });
  const holders: Record<number, string> = {};
  if (!lobby)
    JOBS.forEach((_, index) => {
      const id = holder(room, index);
      if (id) holders[index] = id;
    });
  const running = room.stage === "running";
  return {
    tick: room.tick,
    phase: room.stage,
    part: room.phase === BRIEFING ? "briefing" : "week",
    week: room.week,
    timerTicks: running ? Math.max(0, room.phaseEnd - room.tick) : 0,
    partTicks: running ? Math.max(1, room.phaseEnd - room.phaseStart) : 1,
    weekSeconds: room.weekTicks / 20,
    players,
    watchers: [...room.seats.values()]
      .filter((seat) => seat.watcher)
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        connected: seat.connected,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    economy: structuredClone(economy),
    holders,
    headlines: [...room.headlines],
    ranking: [...room.ranking],
    winners: [...room.winners],
    goals: structuredClone(room.goals),
  };
}

export const fuseLaneGame: RollbackGame<
  FuseLaneRoom,
  FuseLaneEntry,
  FuseLaneView,
  FuseLaneEvent,
  FuseLaneSettings
> = {
  id: "fuse-lane",
  rules: "fuse-lane-1",
  isEntry: isFuseLaneEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: 1 }),
  clock: (room) => room.tick,
  steps: () => 1,
  maxSteps: 1,
  view: fuseLaneView,
  hash: hashRoom,
  checkpoint: { leading: 3, encode: encodeRoom, decode: decodeRoom },
  members: (room) =>
    [...room.seats.values()].sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  seating: {
    capacity: CAPACITY,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar,
    defaultAvatar: "robot",
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      let number = 1;
      const taken = (id: string) =>
        room.seats.has(id) ||
        pending.has(id) ||
        Object.hasOwn(room.roster, id) ||
        Object.hasOwn(room.players, id);
      while (taken(`${BOT_PREFIX}${number}`)) number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) =>
      ["Jones", "Morgan", "Riley", "Casey", "Quinn"][slot] ?? `Bot ${slot + 1}`,
    solo: { name: "You", bots: 1 },
  },
  text: defaultText,
};
