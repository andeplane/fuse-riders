import { MAX_RANGE_LEVEL } from "../bomb-launch.js";
import { parseCombat } from "../combat-stats.js";
import {
  MAX_TRAIL_SEGMENTS,
  TRAIL_DECAY_PAUSE_TICKS,
  trailSegmentsConnect,
} from "../trail-lifecycle.js";
import { POINT_UNIT } from "../leaderboard.js";
import { MAX_EXTRA_BOMBS, MAX_VOLLEY_BOMBS } from "../launch-modifiers.js";
import {
  MAX_BOARD_PICKUPS,
  MAX_POWER_PICKUPS,
  POWER_TUNING,
} from "../power-progression.js";
import {
  AIM_SLOW_MAX_TICKS,
  AIM_SLOW_RAMP_TICKS,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  GRAVITY_FIELD_TICKS,
  GRAVITY_MAX_RADIUS,
  GRAVITY_MIN_RADIUS,
  MAX_GRAVITY_FIELDS,
  MAX_SPEED_EFFECT_STACK,
  NITRO_DURATION_TICKS,
  PICKUP_TYPES,
  RIDER_COLORS,
  SNAIL_DURATION_TICKS,
  type GameState,
  type PlayerState,
  type BombState,
  type BlastState,
  type PickupState,
  type TracerState,
} from "../game.js";
import {
  EFFECT_KINDS,
  effectsAreCanonical,
  type ActiveEffect,
} from "../effects.js";
import { WEAPON_KINDS } from "../weapons.js";
import { isAvatarId } from "../../shared/avatars.js";
import { GUN_AIM_MAX } from "../gun.js";
import { MAX_PORTAL_PAIRS } from "../portal.js";
import {
  ARENA_MAPS,
  MAX_OBSTACLES,
  OBSTACLE_KINDS,
  type Obstacle,
} from "../arena-map.js";
import { parseRoomSettings, type RoomSettings } from "../room-settings.js";
import {
  MAX_MOVER_SPEED,
  MAX_TRAINS,
  TRAIN_TRACKS,
  trackLength,
} from "../scenery-motion.js";
import { loggedRiderName } from "../rider-name.js";
import type { MatchPlayerStatsState } from "../match-stats.js";
import { MAX_ROUND_SHOTS, WEAPONS, type RoundShot } from "../shot-log.js";
import {
  MAX_MOMENTS,
  MAX_MOMENTS_PER_KIND,
  MOMENT_KINDS,
  type Moment,
  type MomentKind,
} from "../moments.js";

export const MAX_CHECKPOINT_BYTES = 2_000_000;
export const MAX_CHECKPOINT_TRAILS = MAX_TRAIL_SEGMENTS;
const MAX_HISTORY = 128;
type Guard = (value: unknown) => boolean;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  !(v instanceof Map);
const number: Guard = (v) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  Math.abs(v) <= Number.MAX_SAFE_INTEGER;
const integer: Guard = (v) =>
  number(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const range =
  (min: number, max: number): Guard =>
  (v) =>
    number(v) && (v as number) >= min && (v as number) <= max;
const count =
  (max: number): Guard =>
  (v) =>
    integer(v) && (v as number) <= max;
const text: Guard = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 128;
/** The log's own bound: a name reaches a state only through a JOIN or BOT entry, so a checkpoint admits what those do. */
const name: Guard = loggedRiderName;
const boolean: Guard = (v) => typeof v === "boolean";
const optional =
  (guard: Guard): Guard =>
  (v) =>
    v === undefined || guard(v);
const array =
  (guard: Guard, max: number): Guard =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(guard);
const shape =
  (fields: Record<string, Guard>): Guard =>
  (v) =>
    record(v) &&
    Object.keys(v).every((key) => Object.hasOwn(fields, key)) &&
    Object.entries(fields).every(([key, guard]) => guard(v[key]));
const map =
  (keyGuard: Guard, valueGuard: Guard, max: number): Guard =>
  (v) =>
    v instanceof Map &&
    v.size <= max &&
    [...v].every(([key, value]) => keyGuard(key) && valueGuard(value));
const position = range(-1000, ARENA_WIDTH + 1000);
const portalPair: Guard = shape({
  id: text,
  gates: (v) =>
    Array.isArray(v) &&
    v.length === 2 &&
    v.every(shape({ x: position, y: position, halfLength: range(0.001, 150) })),
  expiresAtTick: integer,
});
const trail: Guard = (v) =>
  shape({
    x1: position,
    y1: position,
    x2: position,
    y2: position,
    createdTick: integer,
    expiresAtTick: integer,
    detached: optional(
      shape({ id: (v) => integer(v) && v !== 0, decayStartTick: integer }),
    ),
  })(v) &&
  record(v) &&
  (v.expiresAtTick as number) > (v.createdTick as number);
/** One entry per timed effect application; the ordering and per-kind bounds are checked with the game (`effectsAreCanonical`). */
const activeEffects: Guard = array(
  shape({
    kind: (v) =>
      typeof v === "string" && (EFFECT_KINDS as readonly string[]).includes(v),
    sinceTick: integer,
    untilTick: integer,
  } satisfies Record<keyof ActiveEffect, Guard>),
  EFFECT_KINDS.length * MAX_SPEED_EFFECT_STACK,
);
/** Each weapon at most once, in `WEAPON_KINDS` order, which is the order arming keeps. */
const armedWeapons: Guard = (v) =>
  Array.isArray(v) &&
  v.every(
    (kind, index) =>
      (WEAPON_KINDS as readonly unknown[]).includes(kind) &&
      (index === 0 ||
        WEAPON_KINDS.indexOf(v[index - 1]) < WEAPON_KINDS.indexOf(kind)),
  );
const playerFields = {
  id: text,
  name,
  slot: count(4),
  color: (v) => RIDER_COLORS.includes(v as (typeof RIDER_COLORS)[number]),
  avatarId: isAvatarId,
  connected: boolean,
  x: position,
  y: position,
  angle: range(-Math.PI * 2, Math.PI * 2),
  alive: boolean,
  roundWins: integer,
  bombReadyAtTick: integer,
  bombChargeStartedTick: optional(integer),
  gunAim: optional(range(-GUN_AIM_MAX, GUN_AIM_MAX)),
  armed: armedWeapons,
  extraBombs: count(MAX_EXTRA_BOMBS),
  fuseLevel: count(2),
  powerPickups: count(MAX_POWER_PICKUPS),
  reloadDurationTicks: (v) =>
    integer(v) &&
    range(POWER_TUNING.minReloadTicks, POWER_TUNING.baseReloadTicks)(v),
  aimSlowTicks: count(AIM_SLOW_RAMP_TICKS),
  aimSlowSpentTicks: count(AIM_SLOW_MAX_TICKS),
  effects: activeEffects,
  rangeLevel: count(MAX_RANGE_LEVEL),
  grip: boolean,
  drunkHeadingOffset: range(-Math.PI, Math.PI),
  shielded: boolean,
  trail: array(trail, MAX_CHECKPOINT_TRAILS),
} satisfies Record<keyof PlayerState, Guard>;
const player = shape(playerFields);
const bombFields = {
  id: integer,
  ownerId: text,
  launchX: position,
  launchY: position,
  x: position,
  y: position,
  launchedTick: integer,
  landsAtTick: integer,
  explodeAtTick: integer,
  blastRange: range(0, 1000),
  flightPath: array(shape({ x: position, y: position, angle: number }), 32),
  shot: optional((v) => integer(v) && v !== 0),
  portalCooldownUntilTick: optional(integer),
  shell: optional(
    shape({
      vx: range(-1000, 1000),
      vy: range(-1000, 1000),
      bounces: optional((v) => count(1_000_000)(v) && v !== 0),
    }),
  ),
} satisfies Record<keyof BombState, Guard>;
const bomb = shape(bombFields);
/** A bullet's direction is a unit vector; the bullet itself was resolved the tick it was fired. */
const tracer = shape({
  id: integer,
  ownerId: text,
  launchX: position,
  launchY: position,
  x: position,
  y: position,
  vx: range(-1, 1),
  vy: range(-1, 1),
  launchedTick: integer,
  expiresAtTick: integer,
  shot: optional((v) => integer(v) && v !== 0),
} satisfies Record<keyof TracerState, Guard>);
const blast = shape({
  bombId: integer,
  ownerId: text,
  circle: shape({ x: position, y: position, radius: range(0, 1000) }),
  expiresAtTick: integer,
} satisfies Record<keyof BlastState, Guard>);
const pickup = shape({
  id: integer,
  type: (v) =>
    typeof v === "string" && (PICKUP_TYPES as readonly string[]).includes(v),
  x: position,
  y: position,
} satisfies Record<keyof PickupState, Guard>);
const statsFields = {
  combat: optional((v) => parseCombat(v) !== undefined),
  playerId: text,
  name,
  slot: count(4),
  color: text,
  roundsPlayed: integer,
  roundWins: integer,
  matchScoreUnits: integer,
  roundsDrawn: integer,
  survivalTicks: integer,
  longestSurvivalTicks: integer,
  distanceUnits: range(0, Number.MAX_SAFE_INTEGER),
  bombsPlaced: integer,
  bombsExploded: integer,
  eliminations: integer,
  deathsByCause: shape({
    wall: integer,
    trail: integer,
    explosion: integer,
    rider: integer,
  }),
  pickupsCollected: integer,
  powerPickups: integer,
  starPickups: integer,
  beerPickups: integer,
  inkPickups: integer,
  triplePickups: integer,
  fivePickups: integer,
  targetPickups: integer,
  shieldPickups: integer,
  portalPickups: integer,
  portalTransits: integer,
  invulnerableTicks: integer,
  wallBounces: integer,
  earlyExits: integer,
  currentRoundSurvivalTicks: integer,
} satisfies Record<keyof MatchPlayerStatsState, Guard>;
const stats = shape(statsFields);
const momentFields = {
  kind: (v) => typeof v === "string" && MOMENT_KINDS.includes(v as MomentKind),
  round: (v) => integer(v) && (v as number) > 0,
  tick: integer,
  elapsed: integer,
  playerId: text,
  targetIds: array(text, 4),
  value: integer,
} satisfies Record<keyof Moment, Guard>;
const moment = shape(momentFields);
/** A rider dies once per round, so one pull can kill every other rider and no more. */
const shotRecord = shape({
  shot: (v) => integer(v) && v !== 0,
  shooterId: text,
  weapon: (v) =>
    typeof v === "string" && (WEAPONS as readonly string[]).includes(v),
  elapsed: integer,
  bombs: (v) => count(MAX_VOLLEY_BOMBS)(v) && v !== 0,
  power: count(MAX_POWER_PICKUPS),
  extraBombs: count(MAX_EXTRA_BOMBS),
  fuseLevel: count(2),
  rangeLevel: count(MAX_RANGE_LEVEL),
  grip: boolean,
  kills: array(shape({ victimId: text, elapsed: integer }), 4),
} satisfies Record<keyof RoundShot, Guard>);
/**
 * Required, and whole. Every game a peer on these rules can hold was created with settings and only ever replaced them
 * with a parsed or spread copy, so a state without them, or with a field missing, is not one of ours. The parser alone
 * is too kind for this boundary: it fills in flags a browser saved before they existed, and the simulation reads the
 * object that arrived, not the parser's copy.
 */
const settings: Guard = (v) => {
  const parsed = parseRoomSettings(v);
  return (
    parsed !== undefined &&
    record(v) &&
    Object.keys(v).length === Object.keys(parsed).length &&
    Object.keys(parsed).every((key) => v[key] !== undefined)
  );
};
const moverSpeed = range(-MAX_MOVER_SPEED, MAX_MOVER_SPEED);
const bounceMotion: Guard = shape({
  kind: (v) => v === "bounce",
  vx: moverSpeed,
  vy: moverSpeed,
});
const railMotion: Guard = shape({
  kind: (v) => v === "rail",
  track: count(TRAIN_TRACKS.length - 1),
  // Loose here; the walk over the decoded state below holds it to the loop's own length.
  along: range(0, ARENA_WIDTH * 4),
  speed: moverSpeed,
  train: count(MAX_TRAINS - 1),
});
const motion: Guard = (v) => bounceMotion(v) || railMotion(v);
const obstacleShape: Guard = shape({
  id: (v) => integer(v) && v !== 0,
  kind: (v) =>
    typeof v === "string" && (OBSTACLE_KINDS as readonly string[]).includes(v),
  x: position,
  y: position,
  halfWidth: range(1, ARENA_WIDTH / 2),
  halfHeight: range(1, ARENA_HEIGHT / 2),
  motion: optional(motion),
} satisfies Record<keyof Obstacle, Guard>);
/**
 * A wall of the drifting cross spans the board. Anything else is bounded well under it: scenery is something a
 * rider rides around, not a second wall.
 */
const obstacle: Guard = (v) =>
  obstacleShape(v) &&
  record(v) &&
  (v.kind === "wall" ||
    ((v.halfWidth as number) <= ARENA_WIDTH / 4 &&
      (v.halfHeight as number) <= ARENA_HEIGHT / 4));
const gravityField: Guard = shape({
  x: position,
  y: position,
  radius: range(GRAVITY_MIN_RADIUS, GRAVITY_MAX_RADIUS),
  expiresAtTick: integer,
});
const gameShape = shape({
  settings,
  matchId: text,
  round: (v) => integer(v) && (v as number) > 0,
  tick: integer,
  phase: (v) =>
    typeof v === "string" &&
    ["lobby", "countdown", "playing", "roundOver", "matchOver"].includes(v),
  phaseEndsAtTick: optional(integer),
  roundStartedTick: optional(integer),
  width: (v) => v === ARENA_WIDTH,
  height: (v) => v === ARENA_HEIGHT,
  boundaryInset: range(0, ARENA_HEIGHT / 2 - 1),
  map: (v) =>
    typeof v === "string" && (ARENA_MAPS as readonly string[]).includes(v),
  obstacles: array(obstacle, MAX_OBSTACLES),
  players: map(text, player, 5),
  bombs: map(integer, bomb, 256),
  tracers: array(tracer, 256),
  blasts: array(blast, 256),
  pickups: array(pickup, MAX_BOARD_PICKUPS),
  portalPairs: array(portalPair, MAX_PORTAL_PAIRS),
  gravityFields: array(gravityField, MAX_GRAVITY_FIELDS),
  nextTrailPieceId: (v) => integer(v) && v !== 0,
  nextBombId: integer,
  nextPickupId: integer,
  nextPickupSpawnTick: integer,
  seed: count(0xffffffff),
  randomState: count(0xffffffff),
  leaderboard: map(
    text,
    shape({
      id: text,
      name,
      totalScoreUnits: integer,
      roundsPlayed: integer,
      roundWins: integer,
      matchWins: integer,
    }),
    MAX_HISTORY,
  ),
  roundParticipants: map(
    text,
    shape({ id: text, name, eliminatedAtTick: optional(integer) }),
    5,
  ),
  roundPlacements: array(
    shape({
      playerId: text,
      name,
      place: (v) => count(5)(v) && v !== 0,
      scoreUnits: integer,
    }),
    5,
  ),
  roundScored: boolean,
  matchFinishers: array(text, 5),
  matchStats: map(text, stats, MAX_HISTORY),
  moments: array(moment, MAX_MOMENTS),
  shots: array(shotRecord, MAX_ROUND_SHOTS),
  decidedRound: optional(
    shape({
      matchId: text,
      round: (v) => integer(v) && v !== 0,
      tick: integer,
      shots: array(shotRecord, MAX_ROUND_SHOTS),
      rating: optional(
        shape({
          finishers: array(text, 5),
          standings: array(
            shape({
              playerId: text,
              name,
              slot: count(4),
              color: text,
              place: (v) => count(5)(v) && v !== 0,
              scoreUnits: integer,
            }),
            5,
          ),
        }),
      ),
    }),
  ),
  roundWinnerId: optional(text),
  matchWinnerId: optional(text),
} satisfies Record<keyof GameState, Guard>);

/** A bounded traversal precedes map construction and catches deep/large hostile storage. */
function decodeTree(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 150_000 || depth > 16)
    throw new Error("Checkpoint complexity limit");
  if (Array.isArray(value)) {
    if (value.length > MAX_CHECKPOINT_TRAILS)
      throw new Error("Checkpoint array limit");
    return value.map((item) => decodeTree(item, depth + 1, budget));
  }
  if (!record(value)) return value;
  if (Object.keys(value).length === 1 && value.$number === "-0") return -0;
  if (Object.hasOwn(value, "$map")) {
    if (
      Object.keys(value).length !== 1 ||
      !Array.isArray(value.$map) ||
      value.$map.length > 256
    )
      throw new Error("Invalid map");
    const result = new Map<unknown, unknown>();
    for (const entry of value.$map) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !(typeof entry[0] === "string" || typeof entry[0] === "number") ||
        result.has(entry[0])
      )
        throw new Error("Invalid map entry");
      result.set(entry[0], decodeTree(entry[1], depth + 1, budget));
    }
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid object key");
    result[key] = decodeTree(item, depth + 1, budget);
  }
  return result;
}

function gameInvariants(game: GameState): boolean {
  const slots = new Set<number>();
  // A colour is the rider's own rather than its seat's, and the fold keeps it unique: a restored room that seats two
  // riders in one colour never folded from a log this build would produce, so it is refused like any other bad state.
  // Heads are not checked here, because the rule that keeps them unique exempts the AI riders and a `GameState` alone
  // cannot tell an AI rider from a human; `decodeRoom` checks them where the room's bot list is in hand.
  const colors = new Set<string>();
  const pieceIds = new Set<number>();
  for (const [id, p] of game.players) {
    if (
      id !== p.id ||
      slots.has(p.slot) ||
      colors.has(p.color) ||
      !(RIDER_COLORS as readonly string[]).includes(p.color) ||
      !game.leaderboard.has(id)
    )
      return false;
    colors.add(p.color);
    slots.add(p.slot);
    if (
      p.alive &&
      (!game.roundParticipants.has(id) || !game.matchStats.has(id))
    )
      return false;
    if (
      p.bombChargeStartedTick !== undefined &&
      p.bombChargeStartedTick > game.tick
    )
      return false;
    // A raised Gun sight is a held charge on a living rider; the rules never leave one anywhere else.
    if (
      p.gunAim !== undefined &&
      (!p.alive || p.bombChargeStartedTick === undefined)
    )
      return false;
    if (
      !effectsAreCanonical(p.effects, game.tick) ||
      p.trail.some((t) => t.createdTick > game.tick)
    )
      return false;
    let active = false;
    for (let i = 0; i < p.trail.length; i++) {
      const segment = p.trail[i]!,
        previous = p.trail[i - 1];
      if (previous && previous.createdTick > segment.createdTick) return false;
      const piece = segment.detached;
      if (!piece) {
        if (!p.alive) return false;
        active = true;
        continue;
      }
      if (
        active ||
        piece.id >= game.nextTrailPieceId ||
        piece.decayStartTick > game.tick + TRAIL_DECAY_PAUSE_TICKS ||
        piece.decayStartTick < segment.createdTick + TRAIL_DECAY_PAUSE_TICKS
      )
        return false;
      if (previous?.detached?.id === piece.id) {
        if (
          previous.detached.decayStartTick !== piece.decayStartTick ||
          !trailSegmentsConnect(previous, segment)
        )
          return false;
      } else {
        if (pieceIds.has(piece.id)) return false;
        pieceIds.add(piece.id);
      }
    }
  }
  for (const [id, entry] of game.leaderboard) if (id !== entry.id) return false;
  for (const entry of game.matchStats.values())
    if (
      entry.combat &&
      Object.keys({ ...entry.combat.victims, ...entry.combat.killers }).some(
        (id) => !game.matchStats.has(id),
      )
    )
      return false;
  for (const [id, entry] of game.matchStats)
    if (
      id !== entry.playerId ||
      !game.leaderboard.has(id) ||
      entry.matchScoreUnits % POINT_UNIT !== 0 ||
      entry.matchScoreUnits > entry.roundsPlayed * 5 * POINT_UNIT
    )
      return false;
  for (const [id, entry] of game.roundParticipants)
    if (
      id !== entry.id ||
      !game.matchStats.has(id) ||
      (entry.eliminatedAtTick !== undefined &&
        entry.eliminatedAtTick > game.tick)
    )
      return false;
  if (game.roundStartedTick !== undefined && game.roundStartedTick > game.tick)
    return false;
  if (
    ["countdown", "roundOver", "matchOver"].includes(game.phase) &&
    game.phaseEndsAtTick === undefined
  )
    return false;
  if (game.phase !== "lobby" && game.roundParticipants.size < 2) return false;
  if (game.phase === "playing" && game.roundStartedTick === undefined)
    return false;
  if (
    new Set(game.matchFinishers).size !== game.matchFinishers.length ||
    game.matchFinishers.some((id) => !game.matchStats.has(id))
  )
    return false;
  if (game.phase !== "matchOver" && game.matchFinishers.length) return false;
  const placements = new Set<string>();
  for (const entry of game.roundPlacements) {
    if (
      !game.roundParticipants.has(entry.playerId) ||
      placements.has(entry.playerId)
    )
      return false;
    placements.add(entry.playerId);
  }
  if (
    game.roundWinnerId !== undefined &&
    !game.roundParticipants.has(game.roundWinnerId)
  )
    return false;
  if (
    game.matchWinnerId !== undefined &&
    !game.leaderboard.has(game.matchWinnerId)
  )
    return false;
  for (const [id, b] of game.bombs) {
    if (
      id !== b.id ||
      id >= game.nextBombId ||
      !game.matchStats.has(b.ownerId) ||
      b.launchedTick > game.tick ||
      b.landsAtTick < b.launchedTick ||
      b.explodeAtTick < b.launchedTick
    )
      return false;
    if (!b.shell && b.flightPath.length === 0) return false;
    // A pull's shot id is its first bomb's id, so no bomb names a shot issued after it.
    if (b.shot !== undefined && b.shot > id) return false;
  }
  // Tracers are held in id order (the order they were fired in), which also makes their ids distinct.
  let previousTracer = 0;
  for (const t of game.tracers) {
    if (
      game.bombs.has(t.id) ||
      t.id <= previousTracer ||
      t.id >= game.nextBombId ||
      !game.matchStats.has(t.ownerId) ||
      t.launchedTick > game.tick ||
      t.expiresAtTick < t.launchedTick ||
      (t.shot !== undefined && t.shot > t.id)
    )
      return false;
    previousTracer = t.id;
  }
  for (const b of game.blasts)
    if (b.bombId >= game.nextBombId || !game.matchStats.has(b.ownerId))
      return false;
  const pickupIds = new Set<number>();
  for (const p of game.pickups) {
    if (pickupIds.has(p.id) || p.id >= game.nextPickupId) return false;
    pickupIds.add(p.id);
  }
  // Transit exit safety exempts the pair in use by id, so duplicate ids would exempt a foreign wall.
  const portalIds = new Set<string>();
  for (const pair of game.portalPairs) {
    if (portalIds.has(pair.id) || pair.expiresAtTick <= game.tick) return false;
    portalIds.add(pair.id);
  }
  // Obstacles are addressed by id by nothing but the renderer's rubble diff, which a duplicate would confuse into
  // reporting a standing obstacle as destroyed; they are also never anywhere but inside the arena.
  const obstacleIds = new Set<number>();
  for (const piece of game.obstacles) {
    if (obstacleIds.has(piece.id)) return false;
    obstacleIds.add(piece.id);
    if (
      piece.x - piece.halfWidth < 0 ||
      piece.x + piece.halfWidth > game.width ||
      piece.y - piece.halfHeight < 0 ||
      piece.y + piece.halfHeight > game.height
    )
      return false;
    // Only the kinds that move carry a motion, and each mover belongs to the map that lays it: a rock on the
    // classic board never moves, and a blast-proof wall never stands anywhere but on the drifting cross.
    if (piece.motion && piece.kind !== "wall" && piece.kind !== "train")
      return false;
    if (piece.kind === "wall" && game.map !== "drift") return false;
    if (piece.kind === "train" && game.map !== "trains") return false;
    // A car is somewhere on a loop of the map it is on: the track index passed the shape, so the loop exists.
    if (
      piece.motion?.kind === "rail" &&
      (piece.kind !== "train" ||
        piece.motion.along > trackLength(TRAIN_TRACKS[piece.motion.track]!))
    )
      return false;
    // A bouncing piece's step fits inside the room it has to bounce in, so it cannot overshoot the far edge.
    if (
      piece.motion?.kind === "bounce" &&
      (piece.kind !== "wall" ||
        Math.abs(piece.motion.vx) > game.width - 2 * piece.halfWidth ||
        Math.abs(piece.motion.vy) > game.height - 2 * piece.halfHeight)
    )
      return false;
  }
  for (const field of game.gravityFields)
    if (
      field.expiresAtTick <= game.tick ||
      field.expiresAtTick > game.tick + GRAVITY_FIELD_TICKS
    )
      return false;
  // Moments name riders by match statistics, which outlive a seat; the lobby has cleared both.
  if (
    game.phase === "lobby" &&
    (game.moments.length > 0 || game.shots.length > 0)
  )
    return false;
  // The round in play names issued pulls and seated riders. The decided round may outlive both — a new round restarts
  // bomb ids and the lobby clears match statistics — so it is held only to its own consistency and to the clock.
  if (
    !consistentShots(game.shots) ||
    game.shots.some(
      (shot) =>
        shot.shot >= game.nextBombId ||
        !game.matchStats.has(shot.shooterId) ||
        shot.kills.some((kill) => !game.matchStats.has(kill.victimId)),
    )
  )
    return false;
  const decided = game.decidedRound;
  if (
    decided &&
    (!consistentShots(decided.shots) ||
      decided.tick > game.tick ||
      (decided.matchId === game.matchId && decided.round > game.round))
  )
    return false;
  if (decided?.rating) {
    const { standings, finishers } = decided.rating;
    const ids = new Set(standings.map((p) => p.playerId));
    if (
      standings.length < 2 ||
      ids.size !== standings.length ||
      new Set(finishers).size !== finishers.length ||
      finishers.some((id) => !ids.has(id) || id.startsWith("bot:")) ||
      standings.some(
        (p) =>
          p.place > standings.length ||
          !/^#[0-9a-fA-F]{6}$/.test(p.color) ||
          p.scoreUnits > 300,
      )
    )
      return false;
  }
  const perKind = new Map<string, number>();
  for (const m of game.moments) {
    if (
      m.round > game.round ||
      m.tick > game.tick ||
      m.elapsed > m.tick ||
      !game.matchStats.has(m.playerId)
    )
      return false;
    const targets = new Set(m.targetIds);
    if (
      targets.size !== m.targetIds.length ||
      targets.has(m.playerId) ||
      m.targetIds.some((id) => !game.matchStats.has(id))
    )
      return false;
    const kept = (perKind.get(m.kind) ?? 0) + 1;
    if (kept > MAX_MOMENTS_PER_KIND) return false;
    perKind.set(m.kind, kept);
  }
  return true;
}

/** One entry per pull; a rider is killed at most once per round, never by its own pull and never before the pull. */
function consistentShots(shots: readonly RoundShot[]): boolean {
  const shotIds = new Set<number>(),
    victims = new Set<string>();
  for (const shot of shots) {
    if (shotIds.has(shot.shot)) return false;
    shotIds.add(shot.shot);
    for (const kill of shot.kills) {
      if (
        kill.victimId === shot.shooterId ||
        victims.has(kill.victimId) ||
        kill.elapsed < shot.elapsed
      )
        return false;
      victims.add(kill.victimId);
    }
  }
  return true;
}

/** Replica state: connection flags and active gestures are preserved exactly, including negative zero. */
export function encodeGameState(game: GameState): string {
  return JSON.stringify(game, (_key, value: unknown) =>
    value instanceof Map
      ? { $map: [...value] }
      : Object.is(value, -0)
        ? { $number: "-0" }
        : value,
  );
}
export function decodeGameState(raw: unknown): GameState | undefined {
  if (typeof raw !== "string" || raw.length > MAX_CHECKPOINT_BYTES) return;
  try {
    const value: unknown = decodeTree(JSON.parse(raw));
    if (!gameShape(value)) return;
    const game = value as GameState;
    return gameInvariants(game) ? game : undefined;
  } catch {
    return;
  }
}
