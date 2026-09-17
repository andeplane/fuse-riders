import {
  addPlayer,
  createGame,
  removePlayer,
  resetMatch,
  returnToLobby,
  setPlayerConnected,
  SLOT_COLORS,
  startMatch,
  startNextRound,
  step,
  sortedPlayers,
  type GameState,
  type InputIntent,
  type Phase,
} from "./game.js";
import { BotController, BOT_ID_PREFIX } from "./bot-controller.js";
import { parseRoomSettings, type RoomSettings } from "./room-settings.js";
import {
  ACTION,
  AVATAR,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  foldPlayerEntries,
  intentOf,
  isManagementKind,
  neutralControls,
  type Entry,
  type HeldControls,
} from "./input-log.js";
import type { GameEvent } from "../shared/protocol.js";

/** Bump on any simulation change: peers on different rules never share a world. */
export const RULES = "fuse-p2p-32"; // 32: stable simulation ordering (slot/id players, id bombs, id pickups and obstacles, seat-ordered round ranking, PICKUP_TYPES weights). 31: holding the bomb button eases the rider down to half speed for up to a second. 30: the final round pauses for its own result, then MATCH_WINNER_TICKS more to name the match winner. 29: frozen round rating standings enter canonical state. 28: drunk stagger and drift (ADR-046). 27: wrap and cross maps.
export const RECLAIMABLE_PHASES = ["lobby", "roundOver", "matchOver"] as const;
export const BOT_NAMES = ["Ada", "Turing", "Hopper", "Nova", "Byte"] as const;

export interface Fold extends HeldControls {
  generation: number;
}
/** State at tick T is a pure fold of the seed and every entry with tick ≤ T. */
export interface RoomState {
  game: GameState;
  settings: RoomSettings;
  folds: Map<string, Fold>;
  bots: Set<string>;
}
/** A member's entries for one tick from its current stream, plus any retired (older-generation) streams still replayable, oldest first. */
export interface StreamEntries {
  generation: number;
  entries: readonly Entry[];
  retired?: readonly { generation: number; entries: readonly Entry[] }[];
}

export function createRoomState(
  matchId: string,
  settings: RoomSettings,
): RoomState {
  const game = createGame(matchId);
  game.settings = settings;
  return { game, settings, folds: new Map(), bots: new Set() };
}
export const reclaimable = (game: GameState): boolean =>
  (RECLAIMABLE_PHASES as readonly string[]).includes(game.phase);
export function freeSlot(game: GameState): number {
  return SLOT_COLORS.findIndex(
    (_, slot) => !sortedPlayers(game).some((player) => player.slot === slot),
  );
}

/** Who manages the room when those before them are absent: the creator, then the connected humans by id. */
export function successionOrder(state: RoomState, creatorId: string): string[] {
  return [
    creatorId,
    ...sortedPlayers(state.game)
      .filter(
        (player) =>
          player.connected &&
          !state.bots.has(player.id) &&
          player.id !== creatorId,
      )
      .map((player) => player.id)
      .sort(),
  ];
}
/** The lowest connected human other than the creator: it manages the room while the creator is absent. */
export function delegate(
  state: RoomState,
  creatorId: string,
): string | undefined {
  return successionOrder(state, creatorId)[1];
}
/** Which non-creator stream may carry management entries right now: the delegate, only while the creator is disconnected. */
export function actingCreator(
  state: RoomState,
  creatorId: string,
): string | undefined {
  const creator = state.game.players.get(creatorId);
  return creator?.connected ? undefined : delegate(state, creatorId);
}
/**
 * Whether a management entry from `manager` applies: the creator always; the delegate while the creator is absent; and any
 * connected human may record the absence of someone ahead of it in the succession order, so a creator and a delegate that
 * drop together are both marked absent by the next rider rather than leaving the room stalled.
 */
export function permitted(
  state: RoomState,
  creatorId: string,
  manager: string,
  entry: Entry,
): boolean {
  if (manager === creatorId) return true;
  const order = successionOrder(state, creatorId),
    rank = order.indexOf(manager);
  if (rank < 0) return false;
  if (entry[2] === PRESENCE && entry[4] === false) {
    const target = order.indexOf(entry[3]);
    if (target >= 0 && target < rank) return true;
  }
  return actingCreator(state, creatorId) === manager;
}

function pruneDisconnected(state: RoomState): void {
  for (const player of sortedPlayers(state.game))
    if (!player.connected) {
      removePlayer(state.game, player.id);
      state.folds.delete(player.id);
      state.bots.delete(player.id);
    }
}
/** Folds and bots for riders the game no longer seats (a lobby reset drops disconnected riders itself) would make every snapshot undecodable. */
function pruneOrphans(state: RoomState): void {
  for (const id of [...state.folds.keys()])
    if (!state.game.players.has(id)) state.folds.delete(id);
  for (const id of [...state.bots])
    if (!state.game.players.has(id)) state.bots.delete(id);
}
function resetGestures(state: RoomState): void {
  for (const fold of state.folds.values()) {
    fold.activeGesture = 0;
    fold.aim = undefined;
  }
}

/** Every management entry is applied defensively: an inapplicable entry is a no-op on every replica alike. */
function applyManagement(state: RoomState, entry: Entry): void {
  const game = state.game;
  try {
    switch (entry[2]) {
      case JOIN: {
        const [, , , id, playerName, slot, avatarId, generation] = entry;
        const existing = game.players.get(id);
        if (existing) {
          setPlayerConnected(game, id, true);
          state.folds.set(id, { ...neutralControls(), generation });
          return;
        }
        addPlayer(game, {
          id,
          name: playerName.trim(),
          slot,
          color: SLOT_COLORS[slot]!,
          avatarId,
          connected: true,
        });
        state.folds.set(id, { ...neutralControls(), generation });
        return;
      }
      case LEAVE: {
        const id = entry[3];
        if (!game.players.has(id)) return;
        if (reclaimable(game)) {
          removePlayer(game, id);
          state.folds.delete(id);
          state.bots.delete(id);
        } else {
          setPlayerConnected(game, id, false);
          const fold = state.folds.get(id);
          if (fold) Object.assign(fold, neutralControls());
        }
        return;
      }
      case PRESENCE: {
        const [, , , id, connected, generation] = entry;
        if (!game.players.has(id) || state.bots.has(id)) return;
        setPlayerConnected(game, id, connected);
        state.folds.set(id, { ...neutralControls(), generation });
        return;
      }
      case SETTINGS: {
        const settings = parseRoomSettings(entry[3])!;
        state.settings = settings;
        if (game.phase === "lobby") game.settings = settings;
        return;
      }
      case ACTION: {
        const [, , , action, matchId] = entry;
        if (action !== "lobby" && reclaimable(game)) pruneDisconnected(state);
        if (action === "lobby") {
          const tick = game.tick;
          returnToLobby(game, matchId);
          game.tick = tick;
          pruneOrphans(state);
        } else if (action === "start") {
          game.settings = state.settings;
          startMatch(game);
        } else {
          game.settings = state.settings;
          resetMatch(game, matchId);
        }
        resetGestures(state);
        return;
      }
      case BOT: {
        if (entry[3] === "add") {
          const [, , , , id, botName, slot] = entry;
          if (!id.startsWith(BOT_ID_PREFIX) || game.leaderboard.size >= 128)
            return;
          addPlayer(game, {
            id,
            name: botName,
            slot,
            color: SLOT_COLORS[slot]!,
            avatarId: "robot",
            connected: true,
          });
          state.bots.add(id);
        } else if (state.bots.has(entry[4]) && reclaimable(game)) {
          removePlayer(game, entry[4]);
          state.bots.delete(entry[4]);
          state.folds.delete(entry[4]);
        }
        return;
      }
      default:
        return;
    }
  } catch {
    /* A rejected transition leaves the state untouched; game.ts validates before mutating. */
  }
}

/**
 * Advance the room by one tick from the entries stamped with that tick. Management entries apply first, then each
 * player's entries fold into its held controls, then the shared `step`, then automatic round progression.
 *
 * Not transactional: if `step` throws (a `TickFault`), `state` is left part-way through the tick and the caller must
 * discard it for a copy from before the tick. `World` does, from the snapshots it already retains; copying the state
 * here on every tick would nearly double what a re-simulated tick costs. `phases` is the fault-injection seam of
 * `step`, passed through.
 */
export function applyTick(
  state: RoomState,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries>,
  bots: BotController,
  phases?: readonly Phase[],
): GameEvent[] {
  const game = state.game,
    tick = game.tick + 1;
  for (const manager of successionOrder(state, creatorId)) {
    const stream = streams.get(manager);
    if (!stream) continue;
    // Management entries are not gated by generation: a returning creator's new stream must be able to log its own presence.
    for (const entry of [
      ...(stream.retired ?? []).flatMap((old) => old.entries),
      ...stream.entries,
    ]) {
      if (entry[1] !== tick || !isManagementKind(entry[2])) continue;
      // Delegation is re-evaluated per entry: the creator's own return revokes the acting creator mid-tick.
      if (!permitted(state, creatorId, manager, entry)) continue;
      applyManagement(state, entry);
    }
  }
  const inputs = new Map<string, InputIntent>();
  for (const player of sortedPlayers(game)) {
    if (state.bots.has(player.id)) {
      inputs.set(player.id, bots.input(game, player.id));
      continue;
    }
    const fold = state.folds.get(player.id);
    if (!fold) continue;
    if (!player.connected) {
      Object.assign(fold, neutralControls());
      inputs.set(player.id, intentOf(fold));
      continue;
    }
    // Chosen after the management entries applied: a presence that switches the fold's generation takes this tick's input from the new stream.
    const stream = streams.get(player.id),
      source =
        stream === undefined
          ? undefined
          : stream.generation === fold.generation
            ? stream
            : stream.retired?.find((old) => old.generation === fold.generation);
    const entries = source
      ? source.entries.filter(
          (entry) => entry[1] === tick && !isManagementKind(entry[2]),
        )
      : [];
    for (const entry of entries)
      if (entry[2] === AVATAR) player.avatarId = entry[3];
    inputs.set(player.id, foldPlayerEntries(fold, entries));
  }
  const result = step(game, inputs, phases);
  if (
    game.phase === "roundOver" &&
    game.phaseEndsAtTick !== undefined &&
    game.tick >= game.phaseEndsAtTick
  ) {
    pruneDisconnected(state);
    if (sortedPlayers(game).filter((player) => player.connected).length >= 2) {
      // Format stays fixed for a match; powerup changes apply at round boundaries.
      game.settings = {
        ...state.settings,
        match: game.settings!.match,
        length: game.settings!.length,
      };
      startNextRound(game);
      resetGestures(state);
    }
  }
  if (game.phase !== "playing")
    for (const player of sortedPlayers(game)) {
      player.bombChargeStartedTick = undefined;
      player.bombTarget = undefined;
    }
  return result.events;
}

/** Canonical JSON of the whole room state: Map entries and object keys sorted, so insertion order never matters. */
export function canonicalRoomState(state: RoomState): string {
  return JSON.stringify(
    {
      game: state.game,
      settings: state.settings,
      folds: state.folds,
      bots: [...state.bots].sort(),
    },
    (_key, value: unknown) => {
      if (value instanceof Map)
        return [...value].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1));
      if (value instanceof Set) return [...value].sort();
      if (value && typeof value === "object" && !Array.isArray(value))
        return Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1)),
        );
      return value;
    },
  );
}
/** Diagnostic only: two 32-bit FNV-1a lanes over the canonical text, as 16 hex characters. */
export function hashRoomState(state: RoomState): string {
  return hashText(canonicalRoomState(state));
}
export function hashText(text: string): string {
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
