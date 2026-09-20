import { defaultText, type RollbackGame, type Stage } from "fuse-netcode";
import { BOT_PREFIX, CAPACITY, MAX_WATCHERS } from "./basics.js";
import { decodeRoom, encodeRoom, hashRoom } from "./checkpoint.js";
import {
  DEFAULT_SETTINGS,
  createRoom,
  foldTick,
  isAvatar,
  isFuseDriversEntry,
  parseSettings,
  players,
  seatName,
  stepsForTick,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
} from "./rules.js";
import type { RaceState } from "./sim/race.js";

export interface FuseDriversDriverView {
  id: string;
  name: string;
  slot: number;
  avatarId: string;
  bot: boolean;
  connected: boolean;
  /** Which truck this seat drives, or -1 before the grid is formed. */
  truck: number;
}

/**
 * What the arena renders. Outcomes are read from here rather than from events, because a rollback
 * corrects history without emitting the events again.
 */
export interface FuseDriversView {
  /** The log tick, which is this game's clock. */
  tick: number;
  phase: Stage;
  round: number;
  track: string;
  drivers: FuseDriversDriverView[];
  watchers: { id: string; name: string; connected: boolean }[];
  /** The race as of this tick, or undefined in the lobby. */
  race?: RaceState;
}

export function fuseDriversView(room: FuseDriversRoom): FuseDriversView {
  return {
    tick: room.tick,
    phase: room.stage,
    round: room.round,
    track: room.settings.track,
    drivers: players(room).map((seat) => ({
      id: seat.id,
      name: seat.name,
      slot: seat.slot,
      avatarId: seat.avatarId,
      bot: seat.bot,
      connected: seat.connected,
      truck: room.grid.indexOf(seat.id),
    })),
    watchers: [...room.seats.values()]
      .filter((seat) => seat.watcher)
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        connected: seat.connected,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    // The race is replaced wholesale by each simulation step and never mutated in place, so handing the
    // retained frame this reference is as safe as copying it, and far cheaper at twenty frames a second.
    ...(room.race ? { race: room.race } : {}),
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
  // The next tick's step count, so the runtime paces the same cadence the fold will run.
  steps: (room) => stepsForTick(room.tick + 1),
  maxSteps: 2,
  view: fuseDriversView,
  hash: hashRoom,
  checkpoint: { leading: 4, encode: encodeRoom, decode: decodeRoom },
  // Slot then id: an order that depends only on the room, so a device that recovered it from a checkpoint
  // names members exactly as the devices that folded it.
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
    // Nobody else is watching a solo race, so it never runs as a shared screen.
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      // Never an id this match remembers, so a new bot does not inherit a departed one's tallies.
      let number = 1;
      const taken = (id: string) => room.seats.has(id) || pending.has(id);
      while (taken(`${BOT_PREFIX}${number}`)) number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) => `CPU ${slot + 1}`,
    // A full grid against the computer, which is how the arcade original is played.
    solo: { name: "You", bots: 4 },
  },
  text: defaultText,
};

export { DEFAULT_SETTINGS };
