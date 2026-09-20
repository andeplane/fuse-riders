import {
  addPlayer,
  AVATARS,
  createGame,
  removePlayer,
  resetMatch,
  returnToLobby,
  setPlayerConnected,
  MAX_PLAYERS,
  RIDER_COLORS,
  startMatch,
  sortedPlayers,
  type AvatarId,
  type GameState,
  type InputIntent,
  type Phase,
  stepsPerTick,
} from "./game.js";
import { BotController, BOT_ID_PREFIX } from "./bot-controller.js";
import { parseRoomSettings, type RoomSettings } from "./room-settings.js";
import {
  ACTION,
  AVATAR,
  COLOR,
  READY,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
  foldPlayerEntries,
  intentOf,
  isManagementKind,
  neutralControls,
  type Entry,
  type HeldControls,
} from "./input-log.js";
import type { GameEvent } from "./state.js";
import { driveGameTick } from "./tick-driver.js";

/** Bump on any simulation change: peers on different rules never share a world. */
export const RULES = "fuse-p2p-49"; // 49: a rider renames itself over the seat it holds: a `JOIN` for a rider the room already seats now takes the name it carries instead of ignoring it, which is what lets the room be the join screen and the join card go (`docs/design/room-is-the-join-screen.md`). Names are not kept unique; colour and head are what tell riders apart. 48: a rider's colour and head are its own and unique in the room: ten `RIDER_COLORS` instead of five seat colours, a `COLOR` entry beside `AVATAR`, both refused when another rider already wears the choice, and a join that takes the lowest free colour and repairs a taken head. 46: the room passes to the rider in the next seat, not the lowest member id: succession ranks connected human riders by seat. 45: generation- and match-scoped ready votes start games and rematches deterministically. 44 and 47 are reserved by the hidden-tab policy PR (#361).
// 43: the state takes the registries' shape (timed effects as `effects[]`, weapons as `armed[]`, Gun tracers in `tracers` rather than `bombs`, one fresh-round rider, no dead pickup, bomb or transit fields); every event and every view is unchanged. 42: the `drift` map (the wrapping board with a cross of walls on it that wanders like a screensaver logo) and the `trains` map (classic walls, trains round two loops of track): an obstacle may carry a `motion`, advanced by the `moveScenery` phase after `fitField`; `wall` and `train` obstacles stand through blasts and the overtime walls; scenery is met across open edges by riders and bullets, as trails are. 41: spectators are room members in the fold: SPECTATOR entries seat and free them, PRESENCE and LEAVE reach them, and they rank last in the succession order. 40: Target Bomb and the aim input are gone; Star drops by default. 39: the Gun fires on release, a held trigger steers its sight instead of the rider, and it drops more often (weight 400). 38: the clock keeps one rate; a bots-only endgame runs three simulation steps per log tick, and the room state counts its log tick apart from the game clock. 37: `rotate` visits the obstacle-free classic arena as well as the obstacle maps. 36: permanent Range pickup raises maximum bomb reach over three levels. 35: bomb aim bounce eases near both endpoints and holds maximum reach for 100 ms; bots target the shared curve. 34: dead and detached trails pause three seconds before shrinking. 33: Target Bomb has zero default spawn weight. 32: stable simulation ordering (slot/id players, id bombs, id pickups and obstacles, seat-ordered round ranking, PICKUP_TYPES weights). 31: holding the bomb button eases the rider down to half speed for up to a second. 30: the final round pauses for its own result, then MATCH_WINNER_TICKS more to name the match winner. 29: frozen round rating standings enter canonical state. 28: drunk stagger and drift (ADR-046). 27: wrap and cross maps.
export const RECLAIMABLE_PHASES = ["lobby", "roundOver", "matchOver"] as const;
export const BOT_NAMES = ["Ada", "Turing", "Hopper", "Nova", "Byte"] as const;
/** How many named watchers a room lists beside its five seats. The room service admits them (`ROOM_LIMITS.maxGuests`). */
export const MAX_SPECTATORS = 5;

export interface Fold extends HeldControls {
  generation: number;
  ready?: true;
}
/** A member that watches: named and listed like a rider, but with no seat, no colour, no inputs and no place in the game. */
export interface Spectator {
  name: string;
  connected: boolean;
  generation: number;
}
/** State at tick T is a pure fold of the seed and every entry with tick ≤ T. */
export interface RoomState {
  /**
   * The log tick this state has folded through: the tick of the last `applyTick`, and what entries, snapshots,
   * rollback, the stall rule and the shared clock count in. The game's own clock, `game.tick`, counts simulation steps
   * and is the one every rule inside the game reads (phase ends, fuses, the round timer, statistics).
   */
  tick: number;
  game: GameState;
  settings: RoomSettings;
  folds: Map<string, Fold>;
  bots: Set<string>;
  /** Watchers by member id. Never passed to `step`, the leaderboard or the match report: they are the room's, not the game's. */
  spectators: Map<string, Spectator>;
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
  const game = createGame(matchId, settings);
  return {
    tick: game.tick,
    game,
    settings,
    folds: new Map(),
    bots: new Set(),
    spectators: new Map(),
  };
}
export const reclaimable = (game: GameState): boolean =>
  (RECLAIMABLE_PHASES as readonly string[]).includes(game.phase);
export function freeSlot(game: GameState): number {
  for (let slot = 0; slot < MAX_PLAYERS; slot++)
    if (!sortedPlayers(game).some((player) => player.slot === slot))
      return slot;
  return -1;
}

/**
 * The colour a rider joining now gets: the lowest one no rider is wearing. There are twice as many colours as seats,
 * so a room the game would accept always has one free; the caller still handles the empty answer rather than seating a
 * rider with no colour. Riders claim seats lowest-first, so a room nobody recolours wears exactly the seat colours it
 * always did, in the same order.
 */
export function freeColor(game: Readonly<GameState>): string | undefined {
  const taken = new Set(sortedPlayers(game).map((player) => player.color));
  return RIDER_COLORS.find((color) => !taken.has(color));
}
/**
 * The head a rider asking for `wanted` gets: its own choice while no other rider wears it, otherwise the next free one
 * in `AVATARS` order. Bots are counted as wearing theirs — `robot` reads as taken while an AI sits — but are not
 * subject to the rule themselves, so several AI riders share the one head they are drawn with (ADR 027).
 */
export function repairedAvatar(
  game: Readonly<GameState>,
  wanted: AvatarId,
): AvatarId {
  const taken = new Set(sortedPlayers(game).map((player) => player.avatarId));
  if (!taken.has(wanted)) return wanted;
  return AVATARS.find((avatar) => !taken.has(avatar.id))?.id ?? wanted;
}

/**
 * Who manages the room when those before them are absent: the creator, then the connected human riders in seat order,
 * then the connected spectators by id. Seat order is what a player reads off the lobby list, so the room passes to the
 * rider in the next seat down rather than to whoever holds the lowest member id. Watchers rank last because a room with
 * a seat left in it should be managed from that seat, but they do rank: a room whose riders all dropped is still run by
 * whoever is left watching.
 */
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
      .map((player) => player.id),
    ...[...state.spectators]
      .filter(([id, spectator]) => spectator.connected && id !== creatorId)
      .map(([id]) => id)
      .sort(),
  ];
}
/** Whether the room lists this member as present, in a seat or in the watching list. */
export function memberConnected(state: RoomState, id: string): boolean {
  return (
    state.game.players.get(id)?.connected === true ||
    state.spectators.get(id)?.connected === true
  );
}
/** The lowest connected human other than the creator: it manages the room while the creator is absent. */
export function delegate(
  state: RoomState,
  creatorId: string,
): string | undefined {
  return successionOrder(state, creatorId)[1];
}
/**
 * Which non-creator stream may carry management entries right now: the delegate, only while the creator is disconnected.
 * A creator watching from the spectator row counts as present and keeps the crown, so a room only ever has one manager
 * once its creator has said what it is; a creator with no record at all (a TV host that never took a seat) still makes
 * the next member a manager beside it.
 */
export function actingCreator(
  state: RoomState,
  creatorId: string,
): string | undefined {
  return memberConnected(state, creatorId)
    ? undefined
    : delegate(state, creatorId);
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

/**
 * Who runs the room for the players: the one name the screens show as HOST, and the one the room commands are gated on.
 * It is the log's own answer — the creator while the room counts it present, otherwise whoever the duties fall to — so
 * every replica names the same member from the same fold.
 *
 * It does not try to be cleverer than the log about a creator the room has no record of, which is a host driving a
 * shared screen from a page that took no seat. There the crown goes to the rider in the first seat, beside the
 * creator's own page, which keeps its controls because it knows it is the creator (`RoomRuntime.managing`). That is
 * what the log has always permitted there (`permitted` accepts every management kind from that rider, ADR 047 §9), and
 * the alternative is worse: any rule that keeps the crown on an unrecorded creator also keeps it on one that has left,
 * and a room whose crown sits on a member no device answers for cannot be started, rematched or emptied by anyone.
 * A creator that means to hand the room over for good is ADR 047 N5.
 */
export function roomManager(state: RoomState, creatorId: string): string {
  return actingCreator(state, creatorId) ?? creatorId;
}

function pruneDisconnected(state: RoomState): void {
  for (const player of sortedPlayers(state.game))
    if (!player.connected) {
      removePlayer(state.game, player.id);
      state.folds.delete(player.id);
      state.bots.delete(player.id);
    }
  dropAbsentSpectators(state);
}
/** A watcher that is gone is dropped where a rider's seat would be freed: at a start, a rematch and a return to the lobby. */
function dropAbsentSpectators(state: RoomState): void {
  for (const [id, spectator] of state.spectators)
    if (!spectator.connected) state.spectators.delete(id);
}
/** Folds and bots for riders the game no longer seats (a lobby reset drops disconnected riders itself) would make every snapshot undecodable. */
function pruneOrphans(state: RoomState): void {
  for (const id of [...state.folds.keys()])
    if (!state.game.players.has(id)) state.folds.delete(id);
  for (const id of [...state.bots])
    if (!state.game.players.has(id)) state.bots.delete(id);
}
function resetGestures(state: RoomState): void {
  for (const fold of state.folds.values()) fold.activeGesture = 0;
}

/** Every management entry is applied defensively: an inapplicable entry is a no-op on every replica alike. */
function applyManagement(state: RoomState, entry: Entry): void {
  const game = state.game;
  try {
    switch (entry[2]) {
      case JOIN: {
        const [, , , id, playerName, slot, avatarId, generation] = entry;
        // A member is a rider or a watcher, never both: it leaves the watching list first (`SPECTATOR leave`).
        if (state.spectators.has(id)) return;
        const existing = game.players.get(id);
        if (existing) {
          // A join for a rider the room already seats is its reconnection, and now also its rename: the name the
          // entry carries is the one it means to wear, and the seat, colour and head it holds are untouched. Unlike a
          // colour and a head, a name is not kept unique — two friends called Sam could always both be Sam, and the
          // colour and head are what tell riders apart. When a rename is allowed at all is `RoomRuntime`'s to say
          // (`seating.renameable`: the lobby, before this rider's READY); the fold takes whatever it is given.
          const wanted = playerName.trim();
          if (wanted) {
            existing.name = wanted;
            const historical = game.leaderboard.get(id);
            if (historical) historical.name = wanted;
          }
          setPlayerConnected(game, id, true);
          state.folds.set(id, { ...neutralControls(), generation });
          return;
        }
        // A seat no longer decides a colour or a head: both are the rider's own and unique in the room, so the join
        // takes the lowest free colour and repairs a head another rider already wears. The device says what it wants
        // with its own `COLOR` and `AVATAR` entries once it is seated, and those are repaired the same way.
        const color = freeColor(game);
        if (color === undefined) return;
        addPlayer(game, {
          id,
          name: playerName.trim(),
          slot,
          color,
          avatarId: repairedAvatar(game, avatarId),
          connected: true,
        });
        state.folds.set(id, { ...neutralControls(), generation });
        return;
      }
      case LEAVE: {
        const id = entry[3];
        // A watcher holds no seat and no simulation state, so leaving frees it outright in every phase.
        if (state.spectators.delete(id)) return;
        if (!game.players.has(id)) return;
        if (reclaimable(game)) {
          removePlayer(game, id);
          state.folds.delete(id);
          state.bots.delete(id);
        } else {
          setPlayerConnected(game, id, false);
          const fold = state.folds.get(id);
          if (fold) {
            Object.assign(fold, neutralControls());
            delete fold.ready;
          }
        }
        return;
      }
      case PRESENCE: {
        const [, , , id, connected, generation] = entry;
        const spectator = state.spectators.get(id);
        if (spectator) {
          spectator.connected = connected;
          spectator.generation = generation;
          return;
        }
        if (!game.players.has(id) || state.bots.has(id)) return;
        setPlayerConnected(game, id, connected);
        state.folds.set(id, { ...neutralControls(), generation });
        return;
      }
      case SPECTATOR: {
        if (entry[3] === "leave") {
          state.spectators.delete(entry[4]);
          return;
        }
        const [, , , , id, watcherName, generation] = entry;
        const existing = state.spectators.get(id);
        if (existing) {
          existing.connected = true;
          existing.generation = generation;
          return;
        }
        // A seat and the watching list are exclusive, and the list is capped: both are refused here so every replica refuses alike.
        if (game.players.has(id) || state.spectators.size >= MAX_SPECTATORS)
          return;
        state.spectators.set(id, {
          name: watcherName.trim(),
          connected: true,
          generation,
        });
        return;
      }
      case SETTINGS: {
        const settings = parseRoomSettings(entry[3])!;
        state.settings = settings;
        for (const fold of state.folds.values()) delete fold.ready;
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
          dropAbsentSpectators(state);
        } else if (action === "start") {
          game.settings = state.settings;
          startMatch(game);
        } else {
          game.settings = state.settings;
          resetMatch(game, matchId);
        }
        resetGestures(state);
        for (const fold of state.folds.values()) delete fold.ready;
        return;
      }
      case BOT: {
        if (entry[3] === "add") {
          const [, , , , id, botName, slot] = entry;
          // The same exclusivity JOIN and SPECTATOR keep: a seat and the watching list never hold one id. A bot id is
          // server-issued nowhere, so only a modified peer could list one as a watcher, and a state with both would
          // fold on every replica and then fail every snapshot decode, which nothing in the room could recover from.
          if (
            !id.startsWith(BOT_ID_PREFIX) ||
            state.spectators.has(id) ||
            game.leaderboard.size >= 128
          )
            return;
          // An AI takes the lowest free colour like anyone else, and always wears the head it is drawn with: several
          // AI riders share `robot` (ADR 027), and it reads as taken to the humans in the room while one of them sits.
          const color = freeColor(game);
          if (color === undefined) return;
          addPlayer(game, {
            id,
            name: botName,
            slot,
            color,
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
 * The inputs of a step after the first in one log tick: a rider holds what its fold holds, without the tick's bomb
 * commands (a press is one press), and a bot is asked again about the game as it now stands.
 */
function laterInputs(
  state: RoomState,
  game: Readonly<GameState>,
  first: ReadonlyMap<string, InputIntent>,
  bots: BotController,
): Map<string, InputIntent> {
  const inputs = new Map<string, InputIntent>();
  for (const id of first.keys()) {
    if (state.bots.has(id)) inputs.set(id, bots.input(game, id));
    else {
      const fold = state.folds.get(id);
      if (fold) inputs.set(id, intentOf(fold));
    }
  }
  return inputs;
}

/** Ready votes are accepted only before a race and after the complete results presentation. */
export const readyPhase = (
  game: Pick<GameState, "phase" | "tick" | "phaseEndsAtTick">,
): boolean =>
  game.phase === "lobby" ||
  (game.phase === "matchOver" && game.tick >= (game.phaseEndsAtTick ?? 0));

/**
 * Advance the room by one log tick, `state.tick + 1`, from the entries stamped with that tick. Management entries apply first, then each
 * player's entries fold into its held controls, then `driveGameTick`: the shared `step` and automatic round
 * progression. What is the room's and not the game's (folds, bot seats) follows what the driver reports.
 *
 * Not transactional, as it never was: if `step` throws (a `TickFault` naming the phase), `state` is left part-way
 * through the tick and the error reaches the caller. `phases` is the fault-injection seam of `step`, passed through
 * for tests.
 */
export function applyTick(
  state: RoomState,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries>,
  bots: BotController,
  phases?: readonly Phase[],
): GameEvent[] {
  const game = state.game,
    tick = state.tick + 1,
    // Decided on the state the previous tick left, before this tick's entries: the same count on every replica.
    steps = stepsPerTick(game, state.bots);
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
  /** Whether no rider but this one wears `value`: the uniqueness rule behind the `AVATAR` and `COLOR` entries. */
  const free = (
    player: { id: string },
    field: "color" | "avatarId",
    value: string,
  ): boolean =>
    !sortedPlayers(game).some(
      (other) => other.id !== player.id && other[field] === value,
    );
  const inputs = new Map<string, InputIntent>();
  for (const player of sortedPlayers(game)) {
    if (state.bots.has(player.id)) {
      inputs.set(player.id, bots.input(game, player.id));
      continue;
    }
    const fold = state.folds.get(player.id);
    if (!fold) continue;
    if (!player.connected) {
      delete fold.ready;
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
    for (const entry of entries) {
      // A head and a colour are the room's to keep unique, so a choice another rider already wears is a no-op rather
      // than a clash. Riders fold in seat order, so two riders reaching for the same one in a tick resolve the same
      // way on every replica: the rider in the lower seat takes it and the other keeps what it had.
      if (entry[2] === AVATAR && free(player, "avatarId", entry[3]))
        player.avatarId = entry[3];
      if (entry[2] === COLOR) {
        const wanted = RIDER_COLORS[entry[3]];
        if (wanted !== undefined && free(player, "color", wanted))
          player.color = wanted;
      }
      if (
        entry[2] === READY &&
        entry[4] === game.matchId &&
        entry[5] === game.phase &&
        readyPhase(game)
      ) {
        if (entry[3]) fold.ready = true;
        else delete fold.ready;
      }
    }
    inputs.set(player.id, foldPlayerEntries(fold, entries));
  }
  const connected = sortedPlayers(game).filter((player) => player.connected);
  const humans = connected.filter((player) => !state.bots.has(player.id));
  if (
    readyPhase(game) &&
    connected.length >= 2 &&
    humans.length > 0 &&
    humans.every((player) => state.folds.get(player.id)?.ready)
  ) {
    applyManagement(state, [
      1,
      tick,
      ACTION,
      game.phase === "lobby" ? "start" : "rematch",
      `ready-${hashText(`${game.matchId}:${tick}`)}`,
    ]);
  }
  const driven = driveGameTick(game, inputs, state.settings, phases, {
    count: steps,
    later: (current) => laterInputs(state, current, inputs, bots),
  });
  for (const id of driven.removed) {
    state.folds.delete(id);
    state.bots.delete(id);
  }
  if (driven.roundStarted) resetGestures(state);
  state.tick = tick;
  return driven.events;
}

/** Canonical JSON of the whole room state: Map entries and object keys sorted, so insertion order never matters. */
export function canonicalRoomState(
  state: Omit<RoomState, "tick"> & { tick?: number },
): string {
  return JSON.stringify(
    {
      tick: state.tick,
      game: state.game,
      settings: state.settings,
      folds: state.folds,
      bots: [...state.bots].sort(),
      spectators: state.spectators,
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
export function hashRoomState(
  state: Omit<RoomState, "tick"> & { tick?: number },
): string {
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
