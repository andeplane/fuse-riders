import { addPlayer, createGame, removePlayer, resetMatch, returnToLobby, setPlayerConnected, SLOT_COLORS, startMatch, startNextRound, step, type GameState, type InputIntent } from './game.js';
import { BotController, BOT_ID_PREFIX } from './bot-controller.js';
import { parseRoomSettings, type RoomSettings } from './room-settings.js';
import { ACTION, AVATAR, BOT, JOIN, LEAVE, PRESENCE, SETTINGS, foldPlayerEntries, intentOf, isManagementKind, neutralControls, type Entry, type HeldControls } from './input-log.js';
import type { GameEvent } from './protocol.js';

/** Bump on any simulation change: peers on different rules never share a world. */
export const RULES = 'fuse-p2p-1';
export const RECLAIMABLE_PHASES = ['lobby', 'roundOver', 'matchOver'] as const;
export const BOT_NAMES = ['Ada', 'Turing', 'Hopper', 'Nova', 'Byte'] as const;

export interface Fold extends HeldControls { generation: number }
/** State at tick T is a pure fold of the seed and every entry with tick ≤ T. */
export interface RoomState { game: GameState; settings: RoomSettings; folds: Map<string, Fold>; bots: Set<string> }
export interface StreamEntries { generation: number; entries: readonly Entry[] }

export function createRoomState(matchId: string, settings: RoomSettings): RoomState {
  const game = createGame(matchId); game.settings = settings;
  return { game, settings, folds: new Map(), bots: new Set() };
}
export const reclaimable = (game: GameState): boolean => (RECLAIMABLE_PHASES as readonly string[]).includes(game.phase);
export function freeSlot(game: GameState): number { return SLOT_COLORS.findIndex((_, slot) => ![...game.players.values()].some(player => player.slot === slot)); }

/** Which non-creator stream may carry management entries: the lowest connected human while the creator is disconnected. */
export function actingCreator(state: RoomState, creatorId: string): string | undefined {
  const creator = state.game.players.get(creatorId);
  if (creator?.connected) return undefined;
  return [...state.game.players.values()].filter(player => player.connected && !state.bots.has(player.id)).map(player => player.id).sort()[0];
}

function pruneDisconnected(state: RoomState): void {
  for (const player of [...state.game.players.values()]) if (!player.connected) { removePlayer(state.game, player.id); state.folds.delete(player.id); state.bots.delete(player.id); }
}
function resetGestures(state: RoomState): void { for (const fold of state.folds.values()) { fold.activeGesture = 0; fold.aim = undefined; } }

/** Every management entry is applied defensively: an inapplicable entry is a no-op on every replica alike. */
function applyManagement(state: RoomState, entry: Entry, newMatchIdTick: number): void {
  const game = state.game;
  try {
    switch (entry[2]) {
      case JOIN: {
        const [, , , id, playerName, slot, avatarId, generation] = entry;
        const existing = game.players.get(id);
        if (existing) { setPlayerConnected(game, id, true); state.folds.set(id, { ...neutralControls(), generation }); return; }
        addPlayer(game, { id, name: playerName.trim(), slot, color: SLOT_COLORS[slot]!, avatarId, connected: true });
        state.folds.set(id, { ...neutralControls(), generation }); return;
      }
      case LEAVE: {
        const id = entry[3]; if (!game.players.has(id)) return;
        if (reclaimable(game)) { removePlayer(game, id); state.folds.delete(id); state.bots.delete(id); }
        else { setPlayerConnected(game, id, false); const fold = state.folds.get(id); if (fold) Object.assign(fold, neutralControls()); }
        return;
      }
      case PRESENCE: {
        const [, , , id, connected, generation] = entry; if (!game.players.has(id) || state.bots.has(id)) return;
        setPlayerConnected(game, id, connected);
        state.folds.set(id, { ...neutralControls(), generation }); return;
      }
      case SETTINGS: {
        const settings = parseRoomSettings(entry[3])!; state.settings = settings;
        if (game.phase === 'lobby') game.settings = settings; return;
      }
      case ACTION: {
        const [, , , action, matchId] = entry;
        if (action !== 'lobby' && reclaimable(game)) pruneDisconnected(state);
        if (action === 'lobby') { const tick = game.tick; returnToLobby(game, matchId); game.tick = tick; }
        else if (action === 'start') { game.settings = state.settings; startMatch(game); }
        else { game.settings = state.settings; resetMatch(game, matchId); }
        resetGestures(state); return;
      }
      case BOT: {
        if (entry[3] === 'add') {
          const [, , , , id, botName, slot] = entry;
          if (!id.startsWith(BOT_ID_PREFIX) || game.leaderboard.size >= 128) return;
          addPlayer(game, { id, name: botName, slot, color: SLOT_COLORS[slot]!, avatarId: 'robot', connected: true }); state.bots.add(id);
        } else if (state.bots.has(entry[4]) && reclaimable(game)) { removePlayer(game, entry[4]); state.bots.delete(entry[4]); state.folds.delete(entry[4]); }
        return;
      }
      default: return;
    }
  } catch { /* A rejected transition leaves the state untouched; game.ts validates before mutating. */ void newMatchIdTick; }
}

/**
 * Advance the room by one tick from the entries stamped with that tick. Management entries apply first, then each
 * player's entries fold into its held controls, then the shared `step`, then automatic round progression.
 */
export function applyTick(state: RoomState, creatorId: string, streams: ReadonlyMap<string, StreamEntries>, bots: BotController): GameEvent[] {
  const game = state.game, tick = game.tick + 1;
  const delegate = actingCreator(state, creatorId);
  const managers = [creatorId, ...(delegate !== undefined && delegate !== creatorId ? [delegate] : [])];
  for (const manager of managers) {
    const stream = streams.get(manager); if (!stream) continue;
    for (const entry of stream.entries) {
      if (entry[1] !== tick || !isManagementKind(entry[2])) continue;
      // Delegation is re-evaluated per entry: the creator's own return revokes the acting creator mid-tick.
      if (manager !== creatorId && actingCreator(state, creatorId) !== manager) break;
      applyManagement(state, entry, tick);
    }
  }
  const inputs = new Map<string, InputIntent>();
  for (const player of game.players.values()) {
    if (state.bots.has(player.id)) { inputs.set(player.id, bots.input(game, player.id)); continue; }
    const fold = state.folds.get(player.id); if (!fold) continue;
    if (!player.connected) { Object.assign(fold, neutralControls()); inputs.set(player.id, intentOf(fold)); continue; }
    const stream = streams.get(player.id);
    const entries = stream && stream.generation === fold.generation ? stream.entries.filter(entry => entry[1] === tick && !isManagementKind(entry[2])) : [];
    for (const entry of entries) if (entry[2] === AVATAR) player.avatarId = entry[3];
    inputs.set(player.id, foldPlayerEntries(fold, entries));
  }
  const result = step(game, inputs);
  if (game.phase === 'roundOver' && game.phaseEndsAtTick !== undefined && game.tick >= game.phaseEndsAtTick) {
    pruneDisconnected(state);
    if ([...game.players.values()].filter(player => player.connected).length >= 2) {
      // Format stays fixed for a match; powerup changes apply at round boundaries.
      game.settings = { ...state.settings, match: game.settings!.match, length: game.settings!.length };
      startNextRound(game); resetGestures(state);
    }
  }
  if (game.phase !== 'playing') for (const player of game.players.values()) { player.bombChargeStartedTick = undefined; player.bombTarget = undefined; }
  return result.events;
}

/** Canonical JSON of the whole room state: Map entries sorted by key so insertion order never matters. */
export function canonicalRoomState(state: RoomState): string {
  return JSON.stringify({ game: state.game, settings: state.settings, folds: state.folds, bots: [...state.bots].sort() }, (_key, value: unknown) => {
    if (value instanceof Map) return [...value].sort(([a], [b]) => String(a) < String(b) ? -1 : 1);
    if (value instanceof Set) return [...value].sort();
    return value;
  });
}
/** Diagnostic only: two 32-bit FNV-1a lanes over the canonical text, as 16 hex characters. */
export function hashRoomState(state: RoomState): string { return hashText(canonicalRoomState(state)); }
export function hashText(text: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
