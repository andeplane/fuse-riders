import { addPlayer, removePlayer, setPlayerConnected, startMatch, startNextRound, returnToLobby, resetMatch, step, SLOT_COLORS, MAX_PLAYERS, type GameState, type InputIntent } from './game.js';
import { BombInputBuffer } from './bomb-input.js';
import { isAvatarId, type AvatarId } from './avatars.js';
import { parseRoomSettings, type RoomSettings } from './room-settings.js';
import type { AimPoint, GameEvent } from './protocol.js';

/** Bump on any change to the fold or the simulation; replicas on different rules never share a room. */
export const REPLAY_RULES = 'fuse-rollback-6';
/** Ticks a simulator can rewind; older entries reach it only through a fresh baseline. */
export const ROLLBACK_WINDOW_TICKS = 40;
/** Entries one stream may carry in one packet; low enough that a full packet of every stream still fits the unreliable channel. */
export const MAX_ENTRIES_PER_TICK = 12;

/** Entry bodies. Player kinds 0-5 belong to any member's stream; management kinds 10-14 only to the creator's. */
export type EntryBody =
  | [kind: 0, flags: number]                                   // steer: left = 1, right = 2
  | [kind: 1, x: number, y: number]                            // aim, 0..1 of the arena
  | [kind: 2, gesture: number]                                 // press
  | [kind: 3, gesture: number, x: number | null, y: number | null] // release with the final aim, if any
  | [kind: 4, gesture: number]                                 // cancel
  | [kind: 5, avatarId: AvatarId]
  | [kind: 10, memberId: string, name: string, slot: number, avatarId: AvatarId | null] // join, or reconnect of a known member
  | [kind: 11, memberId: string]                               // leave: removed between rounds, otherwise a no-op
  | [kind: 12, memberId: string, connected: boolean]           // presence
  | [kind: 13, settings: RoomSettings]                         // pending settings; active at once in the lobby
  | [kind: 14, action: 'start' | 'rematch' | 'lobby', matchId: string];
export type LogEntry = [seq: number, tick: number, ...EntryBody];
export const isManagementKind = (kind: number): boolean => kind >= 10;

export interface StreamState { flags: number; aim?: AimPoint; gesture?: number; bombs: BombInputBuffer }
export interface ReplayState { game: GameState; pending: RoomSettings; streams: Map<string, StreamState> }

const integer = (x: unknown, max = Number.MAX_SAFE_INTEGER): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= max;
const unit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 && !Object.is(x, -0);
const text = (x: unknown, max = 128): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
export function validEntry(value: unknown): value is LogEntry {
  if (!Array.isArray(value) || value.length < 3 || !integer(value[0]) || value[0] < 1 || !integer(value[1]) || value[1] < 1) return false;
  const [, , kind, a, b, c, d] = value;
  switch (kind) {
    case 0: return value.length === 4 && integer(a, 3);
    case 1: return value.length === 5 && unit(a) && unit(b);
    case 2: case 4: return value.length === 4 && integer(a);
    case 3: return value.length === 6 && integer(a) && (b === null ? c === null : unit(b) && unit(c));
    case 5: return value.length === 4 && isAvatarId(a);
    case 10: return value.length === 7 && text(a) && text(b, 20) && (b as string).trim().length > 0 && integer(c, MAX_PLAYERS - 1) && (d === null || isAvatarId(d));
    case 11: return value.length === 4 && text(a);
    case 12: return value.length === 5 && text(a) && typeof b === 'boolean';
    case 13: return value.length === 4 && parseRoomSettings(a) !== undefined;
    case 14: return value.length === 5 && (a === 'start' || a === 'rematch' || a === 'lobby') && text(b);
    default: return false;
  }
}

export function createReplayState(game: GameState, pending: RoomSettings): ReplayState {
  game.settings = structuredClone(pending);
  return { game, pending: structuredClone(pending), streams: new Map() };
}
export function cloneState(state: ReplayState): ReplayState {
  return { game: structuredClone(state.game), pending: structuredClone(state.pending), streams: new Map([...state.streams].map(([id, s]) => [id, { flags: s.flags, ...(s.aim ? { aim: { ...s.aim } } : {}), ...(s.gesture === undefined ? {} : { gesture: s.gesture }), bombs: s.bombs.clone() }])) };
}
function stream(state: ReplayState, id: string): StreamState {
  let s = state.streams.get(id);
  if (!s) { s = { flags: 0, bombs: new BombInputBuffer() }; state.streams.set(id, s); }
  return s;
}
/** Charges and gestures never survive a phase change; held steering does, exactly as a held key would. */
function resetGestures(state: ReplayState): void {
  for (const s of state.streams.values()) { s.bombs = new BombInputBuffer(); s.gesture = undefined; s.aim = undefined; }
}
const connectedCount = (game: GameState): number => [...game.players.values()].filter(player => player.connected).length;
const reclaimable = (game: GameState): boolean => ['lobby', 'roundOver', 'matchOver'].includes(game.phase);
function pruneDisconnected(state: ReplayState): void {
  for (const player of [...state.game.players.values()]) if (!player.connected) { removePlayer(state.game, player.id); state.streams.delete(player.id); }
}

/** Every precondition is a pure function of the folded state; a failing one makes the entry a no-op, never a throw. */
function applyManagement(state: ReplayState, body: EntryBody): void {
  const game = state.game;
  switch (body[0]) {
    case 10: {
      const [, id, name, slot, avatarId] = body;
      if (game.players.has(id)) { setPlayerConnected(game, id, true); return; }
      if (reclaimable(game)) pruneDisconnected(state);
      if (game.players.size >= MAX_PLAYERS || [...game.players.values()].some(player => player.slot === slot)) return;
      if (!game.leaderboard.has(id) && game.leaderboard.size >= 128) return;
      addPlayer(game, { id, name: name.trim(), slot, color: SLOT_COLORS[slot]!, ...(avatarId ? { avatarId } : {}) });
      stream(state, id); return;
    }
    case 11: { if (game.players.has(body[1]) && reclaimable(game)) { removePlayer(game, body[1]); state.streams.delete(body[1]); } return; }
    case 12: {
      const [, id, connected] = body;
      if (!game.players.has(id)) return;
      setPlayerConnected(game, id, connected);
      if (!connected) { const s = stream(state, id); s.flags = 0; s.aim = undefined; s.gesture = undefined; s.bombs = new BombInputBuffer(); s.bombs.cancel(); }
      return;
    }
    case 13: { const settings = parseRoomSettings(body[1])!; state.pending = settings; if (game.phase === 'lobby') game.settings = structuredClone(settings); return; }
    case 14: {
      const [, action, matchId] = body;
      if (action === 'lobby') { const tick = game.tick; returnToLobby(game, matchId); game.tick = tick; resetGestures(state); return; }
      if (reclaimable(game)) pruneDisconnected(state);
      if (connectedCount(game) < 2) return;
      if (action === 'start' && game.phase === 'lobby') { game.settings = structuredClone(state.pending); startMatch(game); resetGestures(state); }
      else if (action === 'rematch' && game.phase === 'matchOver') { game.settings = structuredClone(state.pending); resetMatch(game, matchId); resetGestures(state); }
      return;
    }
  }
}

function applyPlayer(state: ReplayState, id: string, body: EntryBody): void {
  const s = stream(state, id);
  switch (body[0]) {
    case 0: s.flags = body[1]; return;
    case 1: s.aim = { x: body[1], y: body[2] }; return;
    case 2: {
      if (s.gesture === body[1]) return;
      if (s.gesture !== undefined) s.bombs.accept(false, 'cancel');
      s.gesture = body[1]; s.bombs.accept(true, 'press', s.aim); return;
    }
    case 3: {
      if (s.gesture !== body[1]) return;
      if (body[2] !== null && body[3] !== null) s.aim = { x: body[2], y: body[3] };
      s.bombs.accept(false, 'release', s.aim); s.gesture = undefined; return;
    }
    case 4: { if (s.gesture !== body[1]) return; s.bombs.accept(false, 'cancel'); s.gesture = undefined; return; }
    case 5: { const player = state.game.players.get(id); if (player) player.avatarId = body[1]; return; }
    default: return;
  }
}

/**
 * One simulation tick: the creator's management entries stamped T in seq order, then each member's player entries
 * stamped T folded into held controls and ordered bomb commands, then the shared step and round progression.
 * `entries` maps member id to that member's entries for tick T, already contiguous and sorted by seq.
 */
export function applyTick(state: ReplayState, tick: number, creatorId: string, entries: ReadonlyMap<string, readonly LogEntry[]>): GameEvent[] {
  const game = state.game;
  if (tick !== game.tick + 1) throw new Error(`applyTick expected tick ${game.tick + 1}, got ${tick}`);
  const before = game.phase;
  for (const [, , ...body] of entries.get(creatorId) ?? []) if (isManagementKind(body[0])) applyManagement(state, body as EntryBody);
  // Entries of a member marked absent are ignored until it is present again; a rewind cannot resurrect them.
  for (const [id, list] of entries) for (const [, , ...body] of list) if (!isManagementKind(body[0]) && game.players.get(id)?.connected) applyPlayer(state, id, body as EntryBody);
  const inputs = new Map<string, InputIntent>();
  for (const player of game.players.values()) {
    const s = state.streams.get(player.id);
    inputs.set(player.id, s ? { left: !!(s.flags & 1), right: !!(s.flags & 2), bomb: s.gesture !== undefined, ...(s.aim ? { aim: { ...s.aim } } : {}), bombCommands: s.bombs.drainCommands() } : { left: false, right: false, bomb: false });
  }
  const events = step(game, inputs).events;
  // Leaving play clears gestures; entering it keeps a press made in the transition tick, which the step already honoured.
  if (before !== game.phase && game.phase !== 'playing') resetGestures(state);
  if (game.phase !== 'playing') for (const player of game.players.values()) { player.bombChargeStartedTick = undefined; player.bombTarget = undefined; }
  if (game.phase === 'roundOver' && game.phaseEndsAtTick !== undefined && game.tick >= game.phaseEndsAtTick) {
    pruneDisconnected(state);
    if (connectedCount(game) >= 2) { game.settings = { ...structuredClone(state.pending), match: game.settings!.match, length: game.settings!.length }; startNextRound(game); resetGestures(state); }
  }
  return events;
}

/** Edge entries that move a member's stream from `previous` to `intent`; used by the creator for bots and by tests. */
export function edgesFrom(previous: { flags: number; aim?: AimPoint; gesture?: number }, intent: InputIntent, nextGesture: () => number): EntryBody[] {
  const bodies: EntryBody[] = [];
  const flags = Number(intent.left) | Number(intent.right) << 1;
  if (flags !== previous.flags) bodies.push([0, flags]);
  const aim = intent.aim;
  if (aim && (aim.x !== previous.aim?.x || aim.y !== previous.aim?.y)) bodies.push([1, aim.x, aim.y]);
  for (const command of intent.bombCommands ?? []) {
    if (command.action === 'press') bodies.push([2, nextGesture()]);
    else if (previous.gesture !== undefined) bodies.push(command.action === 'release' ? [3, previous.gesture, command.aim?.x ?? null, command.aim?.y ?? null] : [4, previous.gesture]);
  }
  return bodies;
}

/** Stable object keys, but Map order is semantic and must survive replay. */
export function canonical(value: unknown): string {
  if (value instanceof Map) return `{"$map":${canonical([...value])}}`;
  if (value instanceof BombInputBuffer) return canonical(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(v => canonical(v)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return Object.is(value, -0) ? '-0' : JSON.stringify(value) ?? 'null';
}
export function replayHash(state: ReplayState): string {
  const raw = canonical({ game: state.game, pending: state.pending, streams: state.streams }); let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
