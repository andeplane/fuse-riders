import { MAX_BOARD_PICKUPS, MAX_POWER_PICKUPS, POWER_TUNING } from '../shared/power-progression.js';
import { ARENA_WIDTH, ARENA_HEIGHT, PICKUP_TYPES, SLOT_COLORS, type GameState, type PlayerState, type BombState, type BlastState, type PickupState } from '../shared/game.js';
import { isDeviceProfile } from '../shared/device-profile.js';
import { isAvatarId } from '../shared/avatars.js';
import { MAX_PORTAL_PAIRS } from '../shared/portal.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { MatchPlayerStatsState } from '../shared/match-stats.js';
import { MAX_MOMENTS, MAX_MOMENTS_PER_KIND, MOMENT_KINDS, type Moment, type MomentKind } from '../shared/moments.js';

export const MAX_CHECKPOINT_BYTES = 2_000_000;
export const MAX_CHECKPOINT_TRAILS = 1024;
const MAX_HISTORY = 128;
type Guard = (value: unknown) => boolean;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map);
const number: Guard = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
const integer: Guard = v => number(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const range = (min: number, max: number): Guard => v => number(v) && (v as number) >= min && (v as number) <= max;
const count = (max: number): Guard => v => integer(v) && (v as number) <= max;
const text: Guard = v => typeof v === 'string' && v.length > 0 && v.length <= 128;
const name: Guard = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 20;
const boolean: Guard = v => typeof v === 'boolean';
const optional = (guard: Guard): Guard => v => v === undefined || guard(v);
const array = (guard: Guard, max: number): Guard => v => Array.isArray(v) && v.length <= max && v.every(guard);
const shape = (fields: Record<string, Guard>): Guard => v => record(v) && Object.keys(v).every(key => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, guard]) => guard(v[key]));
const map = (keyGuard: Guard, valueGuard: Guard, max: number): Guard => v => v instanceof Map && v.size <= max && [...v].every(([key, value]) => keyGuard(key) && valueGuard(value));
const position = range(-1000, ARENA_WIDTH + 1000);
const portalPair: Guard = shape({ id: text, gates: v => Array.isArray(v) && v.length === 2 && v.every(shape({ x: position, y: position, halfLength: range(0.001, 150) })), expiresAtTick: integer });
const trail: Guard = v => shape({ x1: position, y1: position, x2: position, y2: position, createdTick: integer, expiresAtTick: integer })(v) && record(v) && (v.expiresAtTick as number) > (v.createdTick as number);
const playerFields = {
  id: text, name, slot: count(4), color: v => SLOT_COLORS.includes(v as typeof SLOT_COLORS[number]), avatarId: isAvatarId, deviceProfile: isDeviceProfile,
  connected: boolean, x: position, y: position, angle: range(-Math.PI * 2, Math.PI * 2), alive: boolean,
  roundWins: integer, bombReadyAtTick: integer, bombChargeStartedTick: optional(integer), gunArmed: optional(boolean), shellArmed: optional(boolean), targetBombArmed: boolean,
  bombTarget: optional(shape({ x: range(0, ARENA_WIDTH), y: range(0, ARENA_HEIGHT) })), gravityArmed: boolean, powerPickups: count(MAX_POWER_PICKUPS), reloadDurationTicks: v => integer(v) && range(POWER_TUNING.minReloadTicks, POWER_TUNING.baseReloadTicks)(v), invulnerableUntilTick: integer, boostUntilTick: integer, drunkUntilTick: integer, inkUntilTick: integer,
  drunkStartedTick: integer, drunkHeadingOffset: range(-Math.PI, Math.PI), tripleShotArmed: boolean, fiveShotArmed: boolean,
  shielded: boolean, shieldGraceUntilTick: integer, portalCooldownUntilTick: integer, portalGraceUntilTick: integer, trail: array(trail, MAX_CHECKPOINT_TRAILS),
} satisfies Record<keyof PlayerState, Guard>;
const player = shape(playerFields);
const bombFields = {
  id: integer, ownerId: text, launchX: position, launchY: position, x: position, y: position,
  launchedTick: integer, landsAtTick: integer, placedTick: integer, explodeAtTick: integer, blastRange: range(0, 1000),
  flightPath: array(shape({ x: position, y: position, angle: number }), 32),
  gravity: optional(boolean),
  shell: optional(shape({ vx: range(-1000, 1000), vy: range(-1000, 1000), gun: optional(boolean), bounces: optional(v => count(1_000_000)(v) && v !== 0) })),
} satisfies Record<keyof BombState, Guard>;
const bomb = shape(bombFields);
const blast = shape({ bombId: integer, ownerId: text, circle: shape({ x: position, y: position, radius: range(0, 1000) }), expiresAtTick: integer } satisfies Record<keyof BlastState, Guard>);
const pickup = shape({ id: integer, type: v => typeof v === 'string' && (PICKUP_TYPES as readonly string[]).includes(v), x: position, y: position, expiresAtTick: integer } satisfies Record<keyof PickupState, Guard>);
const statsFields = {
  playerId: text, name, slot: count(4), color: text, roundsPlayed: integer, roundWins: integer, roundsDrawn: integer,
  survivalTicks: integer, longestSurvivalTicks: integer, distanceUnits: range(0, Number.MAX_SAFE_INTEGER), bombsPlaced: integer, bombsExploded: integer, eliminations: integer,
  deathsByCause: shape({ wall: integer, trail: integer, explosion: integer, rider: integer }), pickupsCollected: integer,
  powerPickups: integer, starPickups: integer, beerPickups: integer, inkPickups: integer, triplePickups: integer, fivePickups: integer, targetPickups: integer,
  shieldPickups: integer, portalPickups: integer, portalTransits: integer, invulnerableTicks: integer, wallBounces: integer, earlyExits: integer, currentRoundSurvivalTicks: integer,
} satisfies Record<keyof MatchPlayerStatsState, Guard>;
const stats = shape(statsFields);
const momentFields = {
  kind: v => typeof v === 'string' && MOMENT_KINDS.includes(v as MomentKind), round: v => integer(v) && (v as number) > 0, tick: integer, elapsed: integer,
  playerId: text, targetIds: array(text, 4), value: integer,
} satisfies Record<keyof Moment, Guard>;
const moment = shape(momentFields);
const settings: Guard = v => v === undefined || parseRoomSettings(v) !== undefined;
const gravityField: Guard = shape({ bombId: integer, ownerId: text, x: position, y: position, radius: range(0, 1000), expiresAtTick: integer });
const gameShape = shape({
  settings, matchId: text, round: v => integer(v) && (v as number) > 0, tick: integer,
  phase: v => typeof v === 'string' && ['lobby','countdown','playing','roundOver','matchOver'].includes(v), phaseEndsAtTick: optional(integer), roundStartedTick: optional(integer),
  width: v => v === ARENA_WIDTH, height: v => v === ARENA_HEIGHT, boundaryInset: range(0, ARENA_HEIGHT / 2 - 1),
  players: map(text, player, 5), bombs: map(integer, bomb, 256), blasts: array(blast, 256), pickups: array(pickup, MAX_BOARD_PICKUPS),
  portalPairs: array(portalPair, MAX_PORTAL_PAIRS),
  gravityFields: array(gravityField, 256),
  nextBombId: integer, nextPickupId: integer, nextPickupSpawnTick: integer, seed: count(0xffffffff), randomState: count(0xffffffff),
  leaderboard: map(text, shape({ id: text, name, totalScoreUnits: integer, roundsPlayed: integer, roundWins: integer, matchWins: integer }), MAX_HISTORY),
  roundParticipants: map(text, shape({ id: text, name, eliminatedAtTick: optional(integer) }), 5),
  roundPlacements: array(shape({ playerId: text, name, place: v => count(5)(v) && v !== 0, scoreUnits: integer }), 5), roundScored: boolean,
  matchStats: map(text, stats, MAX_HISTORY), moments: array(moment, MAX_MOMENTS), roundWinnerId: optional(text), matchWinnerId: optional(text),
} satisfies Record<keyof GameState, Guard>);

/** A bounded traversal precedes map construction and catches deep/large hostile storage. */
function decodeTree(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 150_000 || depth > 16) throw new Error('Checkpoint complexity limit');
  if (Array.isArray(value)) {
    if (value.length > MAX_CHECKPOINT_TRAILS) throw new Error('Checkpoint array limit');
    return value.map(item => decodeTree(item, depth + 1, budget));
  }
  if (!record(value)) return value;
  if (Object.keys(value).length === 1 && value.$number === '-0') return -0;
  if (Object.hasOwn(value, '$map')) {
    if (Object.keys(value).length !== 1 || !Array.isArray(value.$map) || value.$map.length > 256) throw new Error('Invalid map');
    const result = new Map<unknown, unknown>();
    for (const entry of value.$map) {
      if (!Array.isArray(entry) || entry.length !== 2 || !(typeof entry[0] === 'string' || typeof entry[0] === 'number') || result.has(entry[0])) throw new Error('Invalid map entry');
      result.set(entry[0], decodeTree(entry[1], depth + 1, budget));
    }
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid object key');
    result[key] = decodeTree(item, depth + 1, budget);
  }
  return result;
}

function gameInvariants(game: GameState): boolean {
  const slots = new Set<number>();
  for (const [id, p] of game.players) {
    if (id !== p.id || slots.has(p.slot) || p.color !== SLOT_COLORS[p.slot] || !game.leaderboard.has(id)) return false;
    slots.add(p.slot);
    if (p.alive && (!game.roundParticipants.has(id) || !game.matchStats.has(id))) return false;
    if (p.bombChargeStartedTick !== undefined && p.bombChargeStartedTick > game.tick) return false;
    if (p.drunkStartedTick > game.tick || p.trail.some(t => t.createdTick > game.tick)) return false;
  }
  for (const [id, entry] of game.leaderboard) if (id !== entry.id) return false;
  for (const [id, entry] of game.matchStats) if (id !== entry.playerId || !game.leaderboard.has(id)) return false;
  for (const [id, entry] of game.roundParticipants) if (id !== entry.id || !game.matchStats.has(id) || (entry.eliminatedAtTick !== undefined && entry.eliminatedAtTick > game.tick)) return false;
  if (game.roundStartedTick !== undefined && game.roundStartedTick > game.tick) return false;
  if (['countdown','roundOver','matchOver'].includes(game.phase) && game.phaseEndsAtTick === undefined) return false;
  if (game.phase !== 'lobby' && game.roundParticipants.size < 2) return false;
  if (game.phase === 'playing' && game.roundStartedTick === undefined) return false;
  const placements = new Set<string>();
  for (const entry of game.roundPlacements) { if (!game.roundParticipants.has(entry.playerId) || placements.has(entry.playerId)) return false; placements.add(entry.playerId); }
  if (game.roundWinnerId !== undefined && !game.roundParticipants.has(game.roundWinnerId)) return false;
  if (game.matchWinnerId !== undefined && !game.leaderboard.has(game.matchWinnerId)) return false;
  for (const [id, b] of game.bombs) {
    if (id !== b.id || id >= game.nextBombId || !game.matchStats.has(b.ownerId) || b.launchedTick > game.tick || b.placedTick > game.tick || b.landsAtTick < b.launchedTick || b.explodeAtTick < b.launchedTick) return false;
    if (!b.shell && b.flightPath.length === 0) return false;
  }
  for (const b of game.blasts) if (b.bombId >= game.nextBombId || !game.matchStats.has(b.ownerId)) return false;
  const pickupIds = new Set<number>();
  for (const p of game.pickups) { if (pickupIds.has(p.id) || p.id >= game.nextPickupId) return false; pickupIds.add(p.id); }
  // Transit exit safety exempts the pair in use by id, so duplicate ids would exempt a foreign wall.
  const portalIds = new Set<string>();
  for (const pair of game.portalPairs) { if (portalIds.has(pair.id) || pair.expiresAtTick <= game.tick) return false; portalIds.add(pair.id); }
  const fieldBombIds = new Set<number>();
  for (const field of game.gravityFields) { if (fieldBombIds.has(field.bombId) || field.bombId >= game.nextBombId || !game.matchStats.has(field.ownerId) || field.expiresAtTick <= game.tick) return false; fieldBombIds.add(field.bombId); }
  // Moments name riders by match statistics, which outlive a seat; the lobby has cleared both.
  if (game.phase === 'lobby' && game.moments.length > 0) return false;
  const perKind = new Map<string, number>();
  for (const m of game.moments) {
    if (m.round > game.round || m.tick > game.tick || m.elapsed > m.tick || !game.matchStats.has(m.playerId)) return false;
    const targets = new Set(m.targetIds);
    if (targets.size !== m.targetIds.length || targets.has(m.playerId) || m.targetIds.some(id => !game.matchStats.has(id))) return false;
    const kept = (perKind.get(m.kind) ?? 0) + 1;
    if (kept > MAX_MOMENTS_PER_KIND) return false;
    perKind.set(m.kind, kept);
  }
  return true;
}

/** Replica state: connection flags and active gestures are preserved exactly, including negative zero. */
export function encodeGameState(game: GameState): string {
  return JSON.stringify(game, (_key, value: unknown) => value instanceof Map ? { $map: [...value] } : Object.is(value, -0) ? { $number: '-0' } : value);
}
export function decodeGameState(raw: unknown): GameState | undefined {
  if (typeof raw !== 'string' || raw.length > MAX_CHECKPOINT_BYTES) return;
  try {
    const value: unknown = decodeTree(JSON.parse(raw));
    if (!gameShape(value)) return;
    const game = value as GameState;
    return gameInvariants(game) ? game : undefined;
  } catch { return; }
}
