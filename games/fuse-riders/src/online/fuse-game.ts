import {
  memberId,
  uint32,
  type DecodedSnapshot,
  type Frame as NetFrame,
  type RollbackGame,
  type RulesMismatchText,
  type Seat,
  type Stage,
  type World,
} from "fuse-netcode";
import {
  BOT_NAMES,
  MAX_SPECTATORS,
  RULES,
  readyPhase,
  applyTick,
  createRoomState,
  hashRoomState,
  type Fold,
  type RoomState,
  type Spectator,
} from "../engine/apply-tick.js";
import {
  BOT_ID_PREFIX,
  BotController,
  botDisplayName,
} from "../engine/bot-controller.js";
import {
  decodeGameState,
  encodeGameState,
} from "../engine/codec/checkpoint.js";
import { PRESS, isEntry, type Entry } from "../engine/input-log.js";
import {
  MAX_RIDER_NAME,
  loggedRiderName,
  seatRiderName,
} from "../engine/rider-name.js";
import {
  parseRoomSettings,
  type RoomSettings,
} from "../engine/room-settings.js";
import { stepsPerTick } from "../engine/game.js";
import { MAX_STEPS_PER_TICK, stepsCover } from "../engine/tick-driver.js";
import { toView, type GameEvent, type WorldView } from "../engine/view.js";
import type { PlayerState } from "../engine/state.js";
import { isAvatarId } from "../shared/avatars.js";

/**
 * What a rules mismatch tells each side. Reloading only helps the page that is behind, so only its lines say "reload this
 * page", which the header turns into a reload button. `staleRoom` and `replyToNewer` are for the page that is current
 * and stuck: "start a new room" keeps them on screen verbatim (the boot card would otherwise swap in its network hint)
 * without offering a reload that does nothing. `staleRider` is a passing notice on a page that has nothing to do.
 */
export const RULES_MISMATCH = {
  stale: "This page is out of date — reload this page",
  staleRider: "A rider is on an older game version — they must reload",
  staleRoom:
    "This room is on an older game version — start a new room, or have its riders reload",
  unknown: "A rider is on a different game version — reload this page",
  replyToStale: "This room runs a newer game version — reload this page",
  replyToNewer: "This room is on an older game version — start a new room",
  replyToUnknown: "This room runs a different game version — reload this page",
} as const satisfies RulesMismatchText;

/** A watcher as a screen sees it: named and present or not, with no seat, colour or score of its own. */
export interface SpectatorView {
  id: string;
  name: string;
  connected: boolean;
}
/** What Fuse Riders' screen reads: the engine's view, and the room's watching list beside it (room state, not game state). */
export type FuseView = WorldView & {
  spectators: SpectatorView[];
  readyPlayers: string[];
};

const seatOf = (state: RoomState, player: PlayerState): Seat => ({
  id: player.id,
  name: player.name,
  slot: player.slot,
  connected: player.connected === true,
  bot: state.bots.has(player.id),
  generation: state.folds.get(player.id)?.generation,
});
const watcherOf = (id: string, spectator: Spectator): Seat => ({
  id,
  name: spectator.name,
  slot: -1,
  connected: spectator.connected,
  bot: false,
  watcher: true,
  generation: spectator.generation,
});
/** Riders in the game's order, then the watchers. */
const members = (state: RoomState): Seat[] => [
  ...[...state.game.players.values()].map((player) => seatOf(state, player)),
  ...[...state.spectators].map(([id, spectator]) => watcherOf(id, spectator)),
];
const STAGES: Partial<Record<string, Stage>> = {
  lobby: "lobby",
  roundOver: "between",
  matchOver: "over",
};

/**
 * The snapshot's game fields, `[game, settings, folds, bots]` before the streams and `[spectators]` after the hash, each
 * checked against the game it describes.
 */
function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): RoomState | undefined {
  if (fields.length !== 5) return;
  const [gameJson, rawSettings, rawFolds, rawBots, rawSpectators] = fields;
  const game = decodeGameState(gameJson),
    settings = parseRoomSettings(rawSettings);
  if (
    !game ||
    !settings ||
    !stepsCover(tick, game.tick) ||
    !Array.isArray(rawFolds) ||
    !Array.isArray(rawBots) ||
    !Array.isArray(rawSpectators) ||
    rawSpectators.length > MAX_SPECTATORS
  )
    return;
  const bots = new Set<string>();
  for (const id of rawBots) {
    if (
      typeof id !== "string" ||
      !id.startsWith(BOT_ID_PREFIX) ||
      !game.players.has(id) ||
      bots.has(id)
    )
      return;
    bots.add(id);
  }
  const folds = new Map<string, Fold>();
  for (const raw of rawFolds) {
    if (!Array.isArray(raw) || (raw.length !== 5 && raw.length !== 6)) return;
    const [id, generation, flags, active, latest, ready] = raw;
    if (
      !memberId(id) ||
      !game.players.has(id) ||
      bots.has(id) ||
      folds.has(id) ||
      !uint32(generation) ||
      !uint32(flags) ||
      flags > 3 ||
      !uint32(active) ||
      !uint32(latest) ||
      (raw.length === 6 && ready !== true) ||
      (ready === true &&
        (!game.players.get(id)?.connected || !readyPhase(game))) ||
      (active !== 0 && active !== latest)
    )
      return;
    folds.set(id, {
      generation,
      flags,
      activeGesture: active,
      latestGesture: latest,
      ...(ready ? { ready: true as const } : {}),
    });
  }
  for (const player of game.players.values())
    if (!bots.has(player.id) && !folds.has(player.id)) return;
  const spectators = new Map<string, Spectator>();
  for (const raw of rawSpectators) {
    if (!Array.isArray(raw) || raw.length !== 4) return;
    const [id, watcherName, connected, generation] = raw;
    // A member is a rider or a watcher, never both, and the fold never lists one twice.
    if (
      !memberId(id) ||
      spectators.has(id) ||
      game.players.has(id) ||
      !loggedRiderName(watcherName) ||
      watcherName.trim() !== watcherName ||
      typeof connected !== "boolean" ||
      !uint32(generation)
    )
      return;
    spectators.set(id, { name: watcherName, connected, generation });
  }
  return { tick, game, settings, folds, bots, spectators };
}

/** Fuse Riders behind the netcode's contract: its engine folds the log, the netcode does the rest. */
export const fuseGame: RollbackGame<
  RoomState,
  Entry,
  FuseView,
  GameEvent,
  RoomSettings
> = {
  id: "fuse-riders",
  rules: RULES,
  isEntry,
  ordinal: (entry) => (entry[2] === PRESS ? entry[3] : undefined),
  createRoom: createRoomState,
  createTicker() {
    const bots = new BotController();
    return (state, creatorId, streams) =>
      applyTick(state, creatorId, streams, bots);
  },
  scope: (state) => ({ matchId: state.game.matchId, round: state.game.round }),
  clock: (state) => state.game.tick,
  steps: (state) => stepsPerTick(state.game, state.bots),
  maxSteps: MAX_STEPS_PER_TICK,
  view: (state) => ({
    ...toView(state.game),
    readyPlayers: [...state.folds]
      .filter(([, fold]) => fold.ready)
      .map(([id]) => id)
      .sort(),
    spectators: [...state.spectators]
      .map(([id, watcher]) => ({
        id,
        name: watcher.name,
        connected: watcher.connected,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  }),
  hash: hashRoomState,
  checkpoint: {
    leading: 4,
    encode: (state) => [
      encodeGameState(state.game),
      state.settings,
      [...state.folds].map(([id, fold]) => [
        id,
        fold.generation,
        fold.flags,
        fold.activeGesture,
        fold.latestGesture,
        ...(fold.ready ? [true] : []),
      ]),
      [...state.bots],
      [...state.spectators].map(([id, watcher]) => [
        id,
        watcher.name,
        watcher.connected,
        watcher.generation,
      ]),
    ],
    decode: decodeRoom,
  },
  members,
  seat(state, id) {
    const player = state.game.players.get(id);
    if (player) return seatOf(state, player);
    const spectator = state.spectators.get(id);
    return spectator && watcherOf(id, spectator);
  },
  stage: (state) => STAGES[state.game.phase] ?? "running",
  settings: (state) => state.settings,
  matchSettings: (state) => state.game.settings,
  seating: {
    capacity: 5,
    maxWatchers: MAX_SPECTATORS,
    seatName: seatRiderName,
    isAvatar: isAvatarId,
    defaultAvatar: "fox",
    parseSettings: parseRoomSettings,
    soloSettings: (settings) => ({
      ...settings,
      mode: "devices",
      weights: { ...settings.weights },
    }),
    sharedScreen: (settings) => settings.mode === "shared",
    botId(state, pending) {
      let number = 1;
      while (
        state.game.leaderboard.has(`${BOT_ID_PREFIX}${number}`) ||
        pending.has(`${BOT_ID_PREFIX}${number}`)
      )
        number++;
      return `${BOT_ID_PREFIX}${number}`;
    },
    botName: (slot) => botDisplayName(BOT_NAMES[slot]!),
    solo: { name: "You", bots: 4 },
  },
  text: {
    solo: "Solo · you and four AI riders",
    connected: "Connected · direct game link",
    preparing: "Connected · preparing the room",
    waitingForGame: "Connected · waiting for the game",
    waitingFor: "Waiting for {name}",
    lagging: "Connected · {name} lagging",
    waitingForDisplay: "Waiting for a display",
    recovering: "Recovering the room from {who} — {peer}",
    recoverFromOne: "a rider",
    recoverFromAll: "the riders",
    waitingForHost: "Waiting for the game — {peer}",
    loading: "Waiting for the game to load",
    hostOnly: "Only the host can manage the room",
    invalidSettings: "Invalid settings",
    matchRunning: "A match is already running",
    needTwo: "Two riders are needed to start",
    rematchLater: "Rematch is available after the match ends",
    full: "Room is full (5 players)",
    fullWithBots: "Room is full (5 players including AI)",
    botNotFound: "AI rider not found",
    botBetweenRounds: "Remove AI between rounds or return to menu",
    stillLoading: "The room is still loading",
    chooseName: `Choose a name (1–${MAX_RIDER_NAME} characters)`,
    reconnectFirst: "Reconnect before joining",
    stopWatching: "Stop watching before taking a seat",
    leaveSeat: "Leave your seat before watching",
    watchersFull: `Room is full (${MAX_SPECTATORS} spectators watching)`,
    hostReplaced: "This host tab was replaced — use the newer tab",
    couldNotLoad: "Could not load the game — reload this page",
    outOfSync: "Simulation out of sync — reload this page",
    resyncing: "Simulation corrected · resyncing",
    mismatch: RULES_MISMATCH,
  },
};

/** Fuse Riders' world and frames. */
export type FuseWorld = World<
  RoomState,
  Entry,
  FuseView,
  GameEvent,
  RoomSettings
>;
export type Frame = NetFrame<FuseView>;
export type FuseSnapshot = DecodedSnapshot<RoomState, Entry>;
