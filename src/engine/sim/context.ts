/**
 * What one tick's phases share. `step` used to hold these as locals of one long function; here every one has a name
 * and says which phase writes it. A context lives for exactly one tick and is never stored: everything a later tick
 * or another replica needs is in `GameState`.
 */
import type { ObstacleHitbox } from "../arena-map.js";
import type { PickupType } from "../pickup-types.js";
import type { RoundShot } from "../shot-log.js";
import type { TickObservations } from "../moments.js";
import type { PortalBounds, PortalTransit } from "../portal.js";
import type { ShellPoint } from "../shell.js";
import type {
  BlastState,
  EliminationCause,
  GameEvent,
  GameState,
  InputIntent,
  PlayerId,
  PlayerState,
} from "../state.js";

/** One rider's step this tick, from where it stood to where it is about to stand. Phases shorten and turn it in place. */
export interface Movement {
  player: PlayerState;
  oldX: number;
  oldY: number;
  x: number;
  y: number;
  angle: number;
}

/**
 * A blast opened this tick, carrying the shot of the bomb that made it. The stored `state.blasts` entry is a plain
 * `BlastState`: the shot is only needed while this tick's kills are being attributed, and a bomb is deleted the
 * moment it explodes, so the shot has to travel with the blast rather than be looked up afterwards.
 */
export type NewBlast = BlastState & { shot?: number };

/** A bullet that reached a rider's head this tick. */
export interface GunHit {
  bombId: number;
  ownerId: PlayerId;
  shot?: number;
}

/**
 * One rider's death this tick, as the detector that found it states it. `commitDeaths` is the only code that turns a
 * fact into a dead rider, whichever detector wrote it.
 */
export interface DeathFact {
  victim: PlayerState;
  cause: EliminationCause;
  /** Everyone whose hazard marked the victim under the winning cause, in the order the marks were made. */
  owners: PlayerId[];
  /** The trigger pull behind an explosion, when the detector could name one. */
  shot?: number;
  /** Where the rider was stopped, for the highlight observations. */
  x: number;
  y: number;
  /** Age in ticks of the trail segment that was hit, when the cause is `trail`. */
  trailAge?: number;
  /** Whose landing bomb, or whose shell, reached the rider in the sweep — whatever cause won in the end. */
  landingHit?: PlayerId;
  shellHit?: { ownerId: PlayerId; bounces: number; age: number };
}

/**
 * Something that happened this tick which the statistics care about and the physics does not. Phases only state
 * facts, in the order they happen; `recordFacts` is the one phase that writes match statistics, the shot log and the
 * highlight moments from them. A fact carries values, not references, so it says what was true when it was stated;
 * a death names its rider, whose id is all the statistics read.
 */
export type TickFact =
  | { kind: "pickupCollected"; playerId: PlayerId; pickup: PickupType }
  | { kind: "bombExploded"; ownerId: PlayerId }
  | {
      kind: "survived";
      playerId: PlayerId;
      distance: number;
      invulnerable: boolean;
      bounced: boolean;
    }
  | { kind: "portalCrossed"; playerId: PlayerId }
  | { kind: "shotFired"; shot: RoundShot }
  | { kind: "bombPlaced"; playerId: PlayerId }
  | { kind: "died"; death: DeathFact };

export interface TickContext {
  readonly state: GameState;
  readonly inputs: ReadonlyMap<PlayerId, InputIntent>;
  /** Everything the tick reports, in the order it happened. */
  readonly events: GameEvent[];

  /** Pickup spawn interval and board cap for the riders alive as the tick began. Written by `startPlay`. */
  pickupSchedule: { interval: number; cap: number };
  /** Ticks since the round started. Written by `fitField`, like the three below. */
  elapsed: number;
  /** Open edges carry riders, shells, bullets, bombs and blasts through to the far side. Decided once per tick. */
  open: boolean;
  /** The field inside the walls as they stand this tick. */
  trailBounds: PortalBounds;

  /** Every living rider's step, in seat order. Written by `moveRiders`; later phases shorten and turn the steps. */
  readonly movements: Map<PlayerId, Movement>;
  /** Riders turned back by a wall or by scenery this tick, for the statistics. */
  readonly bounced: Set<PlayerId>;
  /** Each shell's swept path, one run per portal hop. Written by `moveShells`, read by the projectile hit test. */
  readonly shellPaths: Map<number, ShellPoint[][]>;
  /** Blasts opened by fuses and chains before anyone moved. Written by `explodeFuses`. */
  fuseBlasts: NewBlast[];
  /** Blasts opened by this tick's launches (Target Bombs and what they chain). Written by `explodeInstant`. */
  instantBlasts: NewBlast[];
  /** Heads reached by this tick's bullets. Written by `fireGuns`. */
  gunHits: Map<PlayerId, GunHit[]>;

  /** The winning cause per marked rider (see CAUSE_PRIORITY), and every owner behind each cause, in mark order. */
  readonly causes: Map<PlayerId, EliminationCause>;
  readonly causeOwners: Map<PlayerId, Map<EliminationCause, Set<PlayerId>>>;
  /**
   * Which shot reached each rider that an explosion marked, for the shot log. The lowest bomb id wins rather than
   * whichever source happens to be visited first, so every replica logs the same shot however its maps are ordered —
   * the log is part of the state peers compare.
   */
  readonly shotSources: Map<PlayerId, { bombId: number; shot: number }>;
  /** When in the step, 0 to 1, each rider first touched a trail, another rider, and scenery. */
  readonly trailContactTimes: Map<PlayerId, number>;
  readonly riderContactTimes: Map<PlayerId, number>;
  /** Crashing into scenery is `wall`, and only these riders stop against what they hit rather than at the boundary. */
  readonly obstacleContactTimes: Map<PlayerId, number>;
  /** The scenery each of those contacts is with, which is what an absorbed crash turns the rider away from. */
  readonly obstaclesReached: Map<PlayerId, ObstacleHitbox>;
  /** Every scenery contact of the tick, whichever cause ended up winning it: what a shield bounces off. */
  sceneryReached: Map<PlayerId, number>;
  /** Portal crossings of the riders that survived the sweep. Written by `portalTransit`. */
  readonly transits: Map<PlayerId, PortalTransit>;

  /** Highlight observations (ADR 043): what the sweep learns about each death, and every dodge. */
  readonly observations: TickObservations;
  readonly landingHits: Map<PlayerId, PlayerId>;
  readonly shellHits: Map<
    PlayerId,
    { ownerId: PlayerId; bounces: number; age: number }
  >;
  readonly trailHits: Map<PlayerId, { ownerId: PlayerId; age: number }>;
  /** Where each rider stood DODGE_LOOKBACK_TICKS ago, captured before the tick's first blast burns that trail away. */
  origins?: Map<PlayerId, { x: number; y: number }>;

  /** Deaths found and not yet committed. Detectors push; `commitDeaths` drains. */
  readonly deaths: DeathFact[];
  /** What the statistics will be told, in the order it happened. Read only by `recordFacts`. */
  readonly facts: TickFact[];
}

export function createTickContext(
  state: GameState,
  inputs: ReadonlyMap<PlayerId, InputIntent>,
): TickContext {
  return {
    state,
    inputs,
    events: [],
    pickupSchedule: { interval: 0, cap: 0 },
    elapsed: 0,
    open: false,
    trailBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    movements: new Map(),
    bounced: new Set(),
    shellPaths: new Map(),
    fuseBlasts: [],
    instantBlasts: [],
    gunHits: new Map(),
    causes: new Map(),
    causeOwners: new Map(),
    shotSources: new Map(),
    trailContactTimes: new Map(),
    riderContactTimes: new Map(),
    obstacleContactTimes: new Map(),
    obstaclesReached: new Map(),
    sceneryReached: new Map(),
    transits: new Map(),
    observations: { deaths: [], dodges: [] },
    landingHits: new Map(),
    shellHits: new Map(),
    trailHits: new Map(),
    deaths: [],
    facts: [],
  };
}
