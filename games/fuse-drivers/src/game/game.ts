import { defaultText, type RollbackGame, type Stage } from "fuse-netcode";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
import {
  BOT_PREFIX,
  CAPACITY,
  MAX_WATCHERS,
  TARGET,
  WINS_NEEDED,
  createRoom,
  foldTick,
  isAvatar,
  isFuseDriversEntry,
  noStats,
  parseSettings,
  players,
  seatName,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
} from "./rules.js";

export interface FuseDriversPlayerView {
  id: string;
  name: string;
  slot: number;
  avatarId: string;
  bot: boolean;
  connected: boolean;
  /** Banked this round. */
  score: number;
  roundWins: number;
  /** Their play this match. */
  rolls: number;
  busts: number;
  bestTurn: number;
}
/** What the fuseDrivers UI renders. Outcomes are read from here, not from events, so a rollback's correction shows. */
export interface FuseDriversView {
  /** The game clock: the log tick. */
  tick: number;
  phase: Stage;
  round: number;
  target: number;
  winsNeeded: number;
  /** Seated players in turn (slot) order. */
  players: FuseDriversPlayerView[];
  watchers: { id: string; name: string; connected: boolean }[];
  /** Whose turn it is, and the turn number a ROLL or HOLD must name. */
  currentId?: string;
  turn: number;
  turnTotal: number;
  /** The newest roll; `n` counts rolls in the match, so two equal rolls in a row read as two. */
  lastRoll?: { id: string; value: number; n: number };
  /** Log ticks until the turn holds by itself, and the full turn. */
  timerTicks: number;
  turnTicks: number;
  roundWinnerId?: string;
  winnerId?: string;
}

export function fuseDriversView(room: FuseDriversRoom): FuseDriversView {
  const running = room.stage === "running" && room.turn !== "";
  return {
    tick: room.tick,
    phase: room.stage,
    round: room.round,
    target: TARGET,
    winsNeeded: WINS_NEEDED,
    players: players(room).map((seat) => {
      const { rolls, busts, bestTurn } = room.stats[seat.id] ?? noStats();
      return {
        id: seat.id,
        name: seat.name,
        slot: seat.slot,
        avatarId: seat.avatarId,
        bot: seat.bot,
        connected: seat.connected,
        score: room.scores[seat.id] ?? 0,
        roundWins: room.wins[seat.id] ?? 0,
        rolls,
        busts,
        bestTurn,
      };
    }),
    watchers: [...room.seats.values()]
      .filter((seat) => seat.watcher)
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        connected: seat.connected,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    ...(running ? { currentId: room.turn } : {}),
    turn: room.turnNo,
    turnTotal: room.turnTotal,
    ...(room.lastRoll
      ? {
          lastRoll: {
            id: room.lastRoller,
            value: room.lastRoll,
            n: room.rolls,
          },
        }
      : {}),
    timerTicks: running ? Math.max(0, room.deadline - room.tick) : 0,
    turnTicks: room.turnTicks,
    ...(room.roundWinner ? { roundWinnerId: room.roundWinner } : {}),
    ...(room.winner ? { winnerId: room.winner } : {}),
  };
}

export const fuseDriversGame: RollbackGame<
  FuseDriversRoom,
  FuseDriversEntry,
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
> = {
  id: "fuse-drivers",
  rules: "fuse-drivers-1",
  isEntry: isFuseDriversEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.tick,
  steps: () => 1,
  maxSteps: 1,
  view: fuseDriversView,
  hash: hashRoom,
  checkpoint: { leading: 5, encode: encodeRoom, decode: decodeRoom },
  // Slot then id: an order that depends only on the room, so a device that recovered it from a checkpoint (which
  // lists seats by slot) names members exactly as the devices that folded it.
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
      // Never an id this match remembers, so a new bot does not inherit a departed one's tallies.
      let number = 1;
      const taken = (id: string) =>
        room.seats.has(id) || pending.has(id) || Object.hasOwn(room.roster, id);
      while (taken(`${BOT_PREFIX}${number}`)) number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) => `Bot ${slot + 1}`,
    solo: { name: "You", bots: 1 },
  },
  text: defaultText,
};
