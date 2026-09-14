import { addPlayer, createGame, toSnapshot, type GameState, type PlayerIdentity } from '../shared/game.js';
import { applyOperation, canonical, replayHash, validOperation, type GameOperation } from '../shared/action-log.js';
import { DIRECT_RULES, uint32, type DirectState } from '../shared/direct-input.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import { HostSession } from './host-session.js';
import { encodeCheckpoint, isGameSnapshot } from './checkpoint.js';
import { packBootstrap, RollbackWorld } from './rollback-world.js';
import { packMessage, unpackMessage } from './action-replication.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';

export interface LobbyCatalog { matchId: string; seed: number; tick: number; leaderboard: ViewSnapshot['leaderboard']; settings: RoomSettings; players: PlayerIdentity[] }
export interface RoomMember { id: string; connection: string; display: boolean; view: boolean }
export interface RoomPlan { type: 'directPlan'; rules: typeof DIRECT_RULES; revision: number; initialize: boolean; incarnation: string; epoch: number; source: string; coordinator: string | null; members: RoomMember[]; settings: RoomSettings }
export interface Preparation { type: 'directPrepare'; revision: number; alias: number; bytes: number; hash: string; matchId: string; tick: number; round: number; status: ViewSnapshot; lobby?: LobbyCatalog; owners: [number, string][] }
export const textId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function isPlan(raw: unknown): raw is RoomPlan {
  if (!record(raw) || raw.type !== 'directPlan' || raw.rules !== DIRECT_RULES || typeof raw.initialize !== 'boolean' || !uint32(raw.revision) || !raw.revision || !textId(raw.incarnation) || !uint32(raw.epoch) || !textId(raw.source) || (raw.coordinator !== null && !textId(raw.coordinator)) || !parseRoomSettings(raw.settings) || !Array.isArray(raw.members) || raw.members.length < 1 || raw.members.length > 6) return false;
  const members = raw.members;
  if (members.some(m => !record(m) || !textId(m.id) || !textId(m.connection) || typeof m.display !== 'boolean' || typeof m.view !== 'boolean' || m.view !== (m.display || (raw.settings as RoomSettings).mode === 'devices')) || new Set(members.map(m => m.id)).size !== members.length) return false;
  return members.some(m => m.id === raw.source) && (raw.coordinator === null ? members.every(m => !m.view) : members.some(m => m.id === raw.coordinator && m.view));
}
export function isCatalog(raw: unknown): raw is LobbyCatalog {
  return record(raw) && textId(raw.matchId) && uint32(raw.seed) && uint32(raw.tick) && isGameSnapshot({ ...toSnapshot(createGame('catalog-validation')), leaderboard: raw.leaderboard }) && !!parseRoomSettings(raw.settings) && Array.isArray(raw.players) && raw.players.length <= 5 && raw.players.every(p => validOperation([1, p])) && new Set(raw.players.map(p => p.id)).size === raw.players.length && new Set(raw.players.map(p => p.slot)).size === raw.players.length;
}
export function catalog(game: GameState, settings: RoomSettings): LobbyCatalog {
  return { matchId: game.matchId, seed: game.seed, tick: game.tick, leaderboard: structuredClone([...game.leaderboard.values()]), settings: structuredClone(settings), players: [...game.players.values()].map(({ id, name, slot, color, avatarId, connected }) => ({ id, name, slot, color, avatarId, connected })) };
}
export function lobbyGame(value: LobbyCatalog): GameState {
  if (!isCatalog(value)) throw new Error('Invalid lobby');
  const game = createGame(value.matchId, value.seed); game.settings = structuredClone(value.settings); game.tick = value.tick; game.leaderboard = new Map(structuredClone(value.leaderboard).map(p => [p.id, p]));
  for (const player of value.players) addPlayer(game, structuredClone(player));
  return game;
}
export function manager(host: string, game: GameState, settings: RoomSettings): HostSession {
  const session = new HostSession(host, settings, { token: () => crypto.randomUUID(), captureActions: true });
  if (!session.restore(encodeCheckpoint(host, game, settings, [...game.players.keys()].map(id => [id, -1]), [...game.players.keys()].filter(id => id.startsWith(BOT_ID_PREFIX))))) throw new Error('Invalid management base');
  for (const player of game.players.values()) session.journal.apply([3, player.id, player.connected]);
  return session;
}
export function neutral(state: DirectState): DirectState {
  const next = structuredClone(state); next.held.clear(); next.gestures.clear();
  for (const player of next.game.players.values()) { player.bombChargeStartedTick = undefined; player.bombTarget = undefined; }
  return next;
}
export function thinSnapshot(view: ViewSnapshot, owner?: string): ViewSnapshot {
  return { ...view, matchStats: view.phase === 'matchOver' ? view.matchStats : [], players: view.players.map(p => ({ ...p, x: p.id === owner ? p.x : 0, y: p.id === owner ? p.y : 0, angle: 0, trail: [] })), bombs: [], blasts: [], pickups: [], portalPair: undefined };
}
export function isView(raw: unknown): raw is ViewSnapshot {
  if (!record(raw) || !uint32(raw.tick) || !uint32(raw.round) || !raw.round) return false;
  const { tick, round, ...snapshot } = raw;
  return isGameSnapshot(snapshot);
}
export function isThinView(raw: unknown, owner?: string): raw is ViewSnapshot {
  return isView(raw) && !raw.bombs.length && !raw.blasts.length && !raw.pickups.length && raw.portalPair === undefined && (raw.phase === 'matchOver' || !raw.matchStats.length) && raw.players.every(p => !p.trail.length && p.angle === 0 && (p.id === owner || p.x === 0 && p.y === 0));
}
export function ownersFor(game: { players: ReadonlyMap<string, PlayerIdentity> }, plan: RoomPlan): [number, string][] {
  return [...game.players.values()].map(p => [p.slot, !p.id.startsWith(BOT_ID_PREFIX) && p.connected && plan.members.some(m => m.id === p.id) ? p.id : plan.coordinator!]);
}
export function isPreparation(raw: unknown, plan: RoomPlan): raw is Preparation {
  if (!record(raw) || raw.type !== 'directPrepare' || raw.revision !== plan.revision || raw.alias !== plan.revision || !uint32(raw.bytes) || raw.bytes < 1 || raw.bytes > 2_000_000 || !textId(raw.matchId) || !uint32(raw.tick) || !uint32(raw.round) || typeof raw.hash !== 'string' || !/^[a-f0-9]{16}$/.test(raw.hash) || !isThinView(raw.status) || raw.status.tick !== raw.tick || raw.status.round !== raw.round || !Array.isArray(raw.owners) || raw.owners.length !== raw.status.players.length) return false;
  if (raw.status.phase === 'lobby' ? !isCatalog(raw.lobby) || raw.lobby.matchId !== raw.matchId || raw.lobby.tick !== raw.tick : raw.lobby !== undefined) return false;
  const slots = new Set(raw.status.players.map(p => p.slot));
  const expectedOwners = new Map(ownersFor({ players: new Map(raw.status.players.map(p => [p.id, p])) }, plan));
  return raw.owners.every(p => Array.isArray(p) && p.length === 2 && uint32(p[0]) && slots.delete(p[0]) && plan.members.some(m => m.id === p[1])) && slots.size === 0 && raw.owners.every(([slot, owner]) => expectedOwners.get(slot) === owner);
}
/** Lifecycle payload proves its pre-neutralization base, then deterministically derives the replacement. */
export function transitionBytes(base: RollbackWorld, operations: GameOperation[]): Uint8Array {
  const bytes = packMessage([base.segment, base.bootstrap(), operations]);
  if (bytes.byteLength > 2_000_000) throw new Error('Lifecycle checkpoint exceeds its bound');
  return bytes;
}
export function deriveTransition(bytes: Uint8Array, alias: number, fence?: RollbackWorld): { state: DirectState; bootstrap: Uint8Array; hash: string } | undefined {
  if (bytes.byteLength > 2_000_000 || !uint32(alias) || !alias) return;
  try {
    const raw = unpackMessage(bytes);
    if (!Array.isArray(raw) || raw.length !== 3 || !uint32(raw[0]) || !(raw[1] instanceof Uint8Array) || !Array.isArray(raw[2]) || raw[2].length > 64 || raw[2].some(op => !validOperation(op) || op[0] === 0)) return;
    const base = RollbackWorld.open(raw[1], raw[0]); if (!base) return;
    if (fence && base.state.game.matchId === fence.state.game.matchId && (base.finalizedTick < fence.finalizedTick || base.finalizedTick === fence.finalizedTick && replayHash(base.state) !== replayHash(fence.finalizedState()))) return;
    const state = neutral(base.finalizedState());
    for (const op of raw[2] as GameOperation[]) applyOperation(state, op);
    const bootstrap = packBootstrap(alias, state, [...state.game.players.values()].map(p => [p.slot, 0]));
    if (!RollbackWorld.open(bootstrap, alias)) return;
    return { state, bootstrap, hash: replayHash(state) };
  } catch { return; }
}
export function initialWorld(value: LobbyCatalog, alias: number): RollbackWorld {
  const game = lobbyGame(value), state: DirectState = { game, held: new Map(), gestures: new Map() };
  return RollbackWorld.open(packBootstrap(alias, state, [...game.players.values()].map(p => [p.slot, 0])), alias)!;
}
export function catalogView(value: LobbyCatalog): ViewSnapshot { const game = lobbyGame(value); return { ...toSnapshot(game), tick: game.tick, round: game.round }; }

/** Full views verify every activation field against the derived, hash-checked state. */
export function prepareWorld(payload: Uint8Array, header: Preparation, plan: RoomPlan, fence?: RollbackWorld): Uint8Array | undefined {
  if (!isPreparation(header, plan) || payload.length !== header.bytes) return;
  const derived = deriveTransition(payload, plan.revision, fence);
  if (!derived) return;
  const game = derived.state.game, view = thinSnapshot({ ...toSnapshot(game), tick: game.tick, round: game.round });
  if (derived.hash !== header.hash || game.matchId !== header.matchId || canonical(view) !== canonical(header.status) || canonical(ownersFor(game, plan)) !== canonical(header.owners) || header.lobby && canonical(catalog(game, plan.settings)) !== canonical(header.lobby)) return;
  return derived.bootstrap;
}
