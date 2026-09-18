import type { RoomState } from "../../src/engine/apply-tick.ts";
import {
  AIM_SLOW_MAX_TICKS,
  AIM_SLOW_RAMP_TICKS,
  BLAST_VISIBLE_TICKS,
  GRAVITY_FIELD_TICKS,
  INK_DURATION_TICKS,
  NITRO_DURATION_TICKS,
  OVERTIME_START_TICK,
  PICKUP_TYPES,
  RIDER_RADIUS,
  SHIELD_GRACE_TICKS,
  SNAIL_DURATION_TICKS,
  STAR_DURATION_TICKS,
  stepsPerTick,
  TICK_HZ,
  TRAIL_WIDTH,
  type EliminationCause,
  type PickupType,
} from "../../src/engine/game.js";
import {
  ARENA_MAP_RECIPES,
  edgesOpen,
  obstacleDistanceSquared,
  obstacleTouchesCircle,
  segmentObstacleDistanceSquared,
  type ArenaMapId,
} from "../../src/engine/arena-map.js";
import { DRUNK_DURATION_TICKS } from "../../src/engine/drunk.js";
import { GUN_RADIUS } from "../../src/engine/gun.js";
import { MOMENT_KINDS, type MomentKind } from "../../src/engine/moments.js";
import {
  PORTAL_COOLDOWN_TICKS,
  PORTAL_GRACE_TICKS,
} from "../../src/engine/portal.js";
import type { GameEvent } from "../../src/shared/protocol.js";
import { SHELL_RADIUS, SHELL_SPEED } from "../../src/engine/shell.js";
import { WEAPONS, type Weapon } from "../../src/engine/shot-log.js";
import { effectDeadlines, effectUntil } from "../../src/engine/effects.ts";

/** The timed effects a pickup starts, each with a real duration it can be held to. */
export const TIMED_EFFECTS = ["star", "nitro", "snail", "beer", "ink"] as const;
export type TimedEffect = (typeof TIMED_EFFECTS)[number];
export const EFFECT_DURATION_TICKS: Record<TimedEffect, number> = {
  star: STAR_DURATION_TICKS,
  nitro: NITRO_DURATION_TICKS,
  snail: SNAIL_DURATION_TICKS,
  beer: DRUNK_DURATION_TICKS,
  ink: INK_DURATION_TICKS,
};
const SURFACES = ["wall", "trail", "scenery"] as const;
type Surface = (typeof SURFACES)[number];
const zeroes = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

/**
 * Everything below is read from the replayed simulation — its state before and after a tick, and the tick's events —
 * and never from the fixture's own metadata: the recording is a list of inputs and says nothing about what they did.
 */
export interface ReplayCoverage {
  collected: PickupType[];
  portalTransits: number;
  shieldAbsorbs: number;
  /** Maps a round was actually played on, in first-seen order. */
  maps: ArenaMapId[];
  /** Obstacles a blast opened on the same tick cleared away; overtime rubble does not count. */
  obstaclesBlasted: number;
  /** Riders killed under `wall` standing against scenery, which keeps clear of the boundary by more than a rider. */
  sceneryCrashes: number;
  /** Of those, the ones standing against scenery that moves: a wandering wall or a train. */
  moverCrashes: number;
  /** Living riders carried through an open edge of the wrap map, without a portal. */
  edgeCrossings: number;
  /** Blasts opened over an open edge, which also stand on the far side of it. */
  edgeBlasts: number;

  /** Trigger pulls per weapon, as the round's shot log labels them. */
  pulls: Record<Weapon, number>;
  /** Kills the shot log credits to a pull of each weapon. */
  kills: Record<Weapon, number>;
  /** Pulls made while holding a round-long upgrade, which changes what the pull launches. */
  upgradedPulls: Record<"power" | "fuse" | "extraBomb" | "grip", number>;
  eliminations: Record<EliminationCause, number>;
  /** Gun tracers found in the stored state on the tick their bullet was fired, portal and open-edge legs included. */
  gunTracers: number;
  /** Tracers that end against scenery still standing after the tick, on an obstacle map. */
  gunSceneryStops: number;
  /**
   * Of those, the ones with a higher-numbered obstacle further along the bullet's line. Read far obstacle first, the
   * contact bisection lands on different low bits, so these are what let the permutation replay see an unsorted read.
   */
  gunScreenedStops: number;
  /** Ticks a launched shell spent in flight. */
  shellTicks: number;
  shellBounces: number;
  /** Bounces with only one kind of surface within a tick's reach of the shell, so what it bounced off is not in doubt. */
  shellBouncesOff: Record<Surface, number>;
  explosions: number;
  /** Lobbed bombs set off by another blast before their own fuse ran out. */
  chainReactions: number;
  /** Rider-ticks spent inside the radius of a black hole, where the heading bends. */
  gravityBentTicks: number;
  /** Black holes that stood for their whole duration in play and had a rider inside their radius on the way. */
  gravityFullTerms: number;
  /** Riders killed under `wall` inside a black hole's core. */
  gravityCoreDeaths: number;
  /** Rider-ticks a living rider spent under each timed effect. */
  effectTicks: Record<TimedEffect, number>;
  /** Times a living rider carried an effect to its last tick, so its expiry ran as well as its start. */
  effectFullTerms: Record<TimedEffect, number>;
  /** Rider-ticks a drunk rider's heading was actually pushed off its course. */
  drunkSwayTicks: number;
  /** Rider-ticks slowed by aiming, those at the slowest level, and those with the slowdown budget spent. */
  aimSlowedTicks: number;
  aimSlowestTicks: number;
  aimSpentTicks: number;
  /** Rider-ticks riding with GRIP, and with a shield up. */
  gripTicks: number;
  shieldedTicks: number;
  /** Hazard-immune riders turned back by the boundary, as the match statistics count them. */
  immuneBounces: number;

  roundsEnded: number;
  /** Simulation steps beyond the first that bots-only log ticks ran (#258 N2). */
  fastSteps: number;
  /** Rounds that ended inside a log tick decided to run several steps, which stops stepping there. */
  fastRoundEnds: number;
  /** Rounds that ended with no winner. */
  roundsDrawn: number;
  /** Rounds whose ranking shares a place between riders eliminated on the same tick. */
  tiedRounds: number;
  /** Rounds the clock drew with riders still alive, who share first place. */
  timedOutRounds: number;
  /** Rounds that started as the second or later round of a match, through the automatic round-over progression. */
  followOnRounds: number;
  matchesEnded: number;
  /** Matches that ended with one champion, and the fewest riders any final standings carried. */
  matchesWon: number;
  fewestFinishers: number;
  overtimeTicks: number;
  /** Ticks a wrap round was played with its walls standing: overtime closing the open edges. */
  wrapWalledTicks: number;
  /** Scenery the closing walls turned to rubble. */
  overtimeRubble: number;
  /** Riders the closing walls killed, and riders eliminated in overtime by anything at all. */
  overtimeWallDeaths: number;
  overtimeEliminations: number;
  moments: Record<MomentKind, number>;
  /** Ticks in play with a seated rider disconnected, still alive and riding on with neutral controls. */
  absentRiderTicks: number;
  /** Ticks in play in a round one rider short, after the round boundary pruned whoever left. */
  shortHandedTicks: number;
  /** Ticks in play with a fourth bot riding in the seat a human left. */
  botFillInTicks: number;
  /** Times a second human stream came back after the room had been down to one. */
  rejoins: number;
  /** Times a seated rider marked absent in play was marked present again in the same round. */
  reconnections: number;
  /** Rounds in play that a return to the lobby abandoned unscored. */
  abandonedRounds: number;
}

export function emptyCoverage(): ReplayCoverage {
  return {
    collected: [],
    portalTransits: 0,
    shieldAbsorbs: 0,
    maps: [],
    obstaclesBlasted: 0,
    sceneryCrashes: 0,
    moverCrashes: 0,
    edgeCrossings: 0,
    edgeBlasts: 0,
    pulls: zeroes(WEAPONS),
    kills: zeroes(WEAPONS),
    upgradedPulls: zeroes(["power", "fuse", "extraBomb", "grip"] as const),
    eliminations: zeroes(["wall", "trail", "explosion", "rider"] as const),
    gunTracers: 0,
    gunSceneryStops: 0,
    gunScreenedStops: 0,
    shellTicks: 0,
    shellBounces: 0,
    shellBouncesOff: zeroes(SURFACES),
    explosions: 0,
    chainReactions: 0,
    gravityBentTicks: 0,
    gravityFullTerms: 0,
    gravityCoreDeaths: 0,
    effectTicks: zeroes(TIMED_EFFECTS),
    effectFullTerms: zeroes(TIMED_EFFECTS),
    drunkSwayTicks: 0,
    aimSlowedTicks: 0,
    aimSlowestTicks: 0,
    aimSpentTicks: 0,
    gripTicks: 0,
    shieldedTicks: 0,
    immuneBounces: 0,
    roundsEnded: 0,
    fastSteps: 0,
    fastRoundEnds: 0,
    roundsDrawn: 0,
    tiedRounds: 0,
    timedOutRounds: 0,
    followOnRounds: 0,
    matchesEnded: 0,
    matchesWon: 0,
    fewestFinishers: Number.POSITIVE_INFINITY,
    overtimeTicks: 0,
    wrapWalledTicks: 0,
    overtimeRubble: 0,
    overtimeWallDeaths: 0,
    overtimeEliminations: 0,
    moments: zeroes(MOMENT_KINDS),
    absentRiderTicks: 0,
    shortHandedTicks: 0,
    botFillInTicks: 0,
    rejoins: 0,
    reconnections: 0,
    abandonedRounds: 0,
  };
}

export const isObstacleMap = (map: ArenaMapId): boolean =>
  ARENA_MAP_RECIPES[map].species.length > 0;

const square = (value: number): number => value * value;
function pointSegmentDistanceSquared(
  x: number,
  y: number,
  segment: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = segment.x2 - segment.x1,
    dy = segment.y2 - segment.y1,
    length = dx * dx + dy * dy;
  const along = length
    ? Math.max(
        0,
        Math.min(1, ((x - segment.x1) * dx + (y - segment.y1) * dy) / length),
      )
    : 0;
  return (
    square(x - segment.x1 - along * dx) + square(y - segment.y1 - along * dy)
  );
}
/** As far as anything a shell can bounce off this tick can be from where the shell starts it. */
const SHELL_REACH = SHELL_SPEED / TICK_HZ + SHELL_RADIUS + TRAIL_WIDTH / 2 + 1;
const untilOf = (
  player: RoomState["game"]["players"] extends Map<string, infer P> ? P : never,
  effect: TimedEffect,
): number =>
  effect === "star"
    ? effectUntil(player, "star")
    : effect === "beer"
      ? effectUntil(player, "drunk")
      : effect === "ink"
        ? effectUntil(player, "ink")
        : ((effect === "nitro"
            ? effectDeadlines(player, "nitro")
            : effectDeadlines(player, "snail"))[0] ?? 0);

export function coverageObserver(coverage: ReplayCoverage) {
  /** Black holes that have had a rider inside them, by the tick they close and their size. */
  const visitedFields = new Set<string>();
  return (state: Readonly<RoomState>) => {
    const before = state.game;
    const pickups = new Map(
      before.pickups.map((pickup) => [pickup.id, pickup.type]),
    );
    const players = new Map(
      [...before.players].map(([id, player]) => [
        id,
        {
          shielded: player.shielded,
          cooldown: effectUntil(player, "portalCooldown"),
          x: player.x,
          y: player.y,
          alive: player.alive,
          connected: player.connected,
          matchId: before.matchId,
        },
      ]),
    );
    const obstacles = [...before.obstacles];
    const matchId = before.matchId;
    const round = `${matchId}/${before.round}`;
    const wasOpen = before.phase === "playing" && edgesOpen(before);
    const wasPlaying = before.phase === "playing";
    const pulls = before.shots.length;
    const killsBefore = zeroes(WEAPONS);
    for (const shot of before.shots)
      killsBefore[shot.weapon] += shot.kills.length;
    const bombs = new Map(
      [...before.bombs].map(([id, bomb]) => [
        id,
        {
          x: bomb.x,
          y: bomb.y,
          lobbed: !bomb.shell,
          shell: bomb.shell !== undefined,
          bounces: bomb.shell?.bounces ?? 0,
          explodeAtTick: bomb.explodeAtTick,
        },
      ]),
    );
    const inset = before.boundaryInset;
    const bouncesBefore = [...before.matchStats.values()].reduce(
      (sum, entry) => sum + entry.wallBounces,
      0,
    );
    const humans = state.folds.size;
    const gameTick = before.tick,
      fast = stepsPerTick(before, state.bots) > 1;
    return (events: readonly GameEvent[]) => {
      const game = state.game;
      coverage.fastSteps += Math.max(0, game.tick - gameTick - 1);
      if (fast && events.some((event) => event.type === "roundEnded"))
        coverage.fastRoundEnds++;
      const sameRound = round === `${game.matchId}/${game.round}`;
      const playing = game.phase === "playing";
      const elapsed = game.tick - (game.roundStartedTick ?? game.tick);
      for (const event of events) {
        if (event.type === "pickupCollected") {
          const type = pickups.get(event.pickupId);
          if (type && !coverage.collected.includes(type))
            coverage.collected.push(type);
        } else if (event.type === "moment")
          coverage.moments[event.moment.kind]++;
        else if (event.type === "roundEnded") {
          coverage.roundsEnded++;
          if (event.winnerId === undefined) coverage.roundsDrawn++;
          const places = game.roundPlacements.map(({ place }) => place);
          if (new Set(places).size < places.length) coverage.tiedRounds++;
          if (
            event.winnerId === undefined &&
            [...game.players.values()].filter((player) => player.alive).length >
              1
          )
            coverage.timedOutRounds++;
        } else if (event.type === "matchEnded") {
          coverage.matchesEnded++;
          if (event.winnerId !== undefined) coverage.matchesWon++;
          coverage.fewestFinishers = Math.min(
            coverage.fewestFinishers,
            game.matchFinishers.length,
          );
        } else if (event.type === "playerEliminated") {
          coverage.eliminations[event.cause]++;
          if (elapsed > OVERTIME_START_TICK) coverage.overtimeEliminations++;
        }
      }
      if (playing && !coverage.maps.includes(game.map))
        coverage.maps.push(game.map);
      if (!wasPlaying && playing && game.round > 1) coverage.followOnRounds++;
      // A finished round keeps its state until the next one is prepared, so the tick that decides it is still read.
      if (sameRound && wasPlaying) {
        const opened = game.blasts.filter(
          (blast) => blast.expiresAtTick === game.tick + BLAST_VISIBLE_TICKS,
        );
        for (const obstacle of obstacles) {
          if (game.obstacles.some((left) => left.id === obstacle.id)) continue;
          if (
            opened.some(({ circle }) =>
              obstacleTouchesCircle(
                obstacle,
                circle.x,
                circle.y,
                circle.radius,
              ),
            )
          )
            coverage.obstaclesBlasted++;
          else if (elapsed > OVERTIME_START_TICK) coverage.overtimeRubble++;
        }
        for (const event of events) {
          if (event.type === "explosion") {
            coverage.explosions++;
            if (
              opened.filter((blast) => blast.bombId === event.bombId).length > 1
            )
              coverage.edgeBlasts++;
            const bomb = bombs.get(event.bombId);
            if (bomb?.lobbed && bomb.explodeAtTick > game.tick)
              coverage.chainReactions++;
            continue;
          }
          if (event.type !== "playerEliminated" || event.cause !== "wall")
            continue;
          const crashed = game.players.get(event.playerId);
          if (!crashed) continue;
          const from = players.get(event.playerId);
          const against = (
            obstacle: { motion?: unknown } & Parameters<
              typeof obstacleTouchesCircle
            >[0],
          ) =>
            obstacleTouchesCircle(
              obstacle,
              crashed.x,
              crashed.y,
              RIDER_RADIUS + 1,
            );
          if (obstacles.some(against)) {
            coverage.sceneryCrashes++;
            if (
              obstacles.some((obstacle) => obstacle.motion && against(obstacle))
            )
              coverage.moverCrashes++;
          } else if (
            from &&
            game.gravityFields.some(
              (field) =>
                pointSegmentDistanceSquared(field.x, field.y, {
                  x1: from.x,
                  y1: from.y,
                  x2: crashed.x,
                  y2: crashed.y,
                }) <= square(field.radius),
            ) &&
            Math.min(
              crashed.x - inset,
              game.width - inset - crashed.x,
              crashed.y - inset,
              game.height - inset - crashed.y,
            ) >
              2 * RIDER_RADIUS + 1
          )
            // Neither scenery nor the boundary is in reach of where it died, inside a hole: the core is what is left.
            coverage.gravityCoreDeaths++;
          else if (elapsed > OVERTIME_START_TICK) coverage.overtimeWallDeaths++;
        }
        for (const shot of game.shots.slice(pulls)) {
          coverage.pulls[shot.weapon]++;
          if (shot.power > 0) coverage.upgradedPulls.power++;
          if (shot.fuseLevel > 0) coverage.upgradedPulls.fuse++;
          if (shot.extraBombs > 0) coverage.upgradedPulls.extraBomb++;
          if (shot.grip) coverage.upgradedPulls.grip++;
        }
        const killsAfter = zeroes(WEAPONS);
        for (const shot of game.shots)
          killsAfter[shot.weapon] += shot.kills.length;
        for (const weapon of WEAPONS)
          coverage.kills[weapon] += killsAfter[weapon] - killsBefore[weapon];
        for (const bomb of game.tracers) {
          if (bomb.launchedTick !== game.tick) continue;
          coverage.gunTracers++;
          const stopped = isObstacleMap(game.map)
            ? game.obstacles.find(
                (obstacle) =>
                  obstacleDistanceSquared(obstacle, bomb.x, bomb.y) <=
                  square(GUN_RADIUS + 1e-3),
              )
            : undefined;
          if (!stopped) continue;
          coverage.gunSceneryStops++;
          const { vx, vy } = bomb;
          const reach = game.width + game.height;
          if (
            game.obstacles.some(
              (obstacle) =>
                obstacle.id > stopped.id &&
                segmentObstacleDistanceSquared(
                  obstacle,
                  bomb.launchX,
                  bomb.launchY,
                  bomb.launchX + vx * reach,
                  bomb.launchY + vy * reach,
                ) <= square(GUN_RADIUS),
            )
          )
            coverage.gunScreenedStops++;
        }
        for (const bomb of game.bombs.values()) {
          if (!bomb.shell) continue;
          coverage.shellTicks++;
          const earlier = bombs.get(bomb.id);
          const bounced = (bomb.shell.bounces ?? 0) - (earlier?.bounces ?? 0);
          if (!earlier?.shell || bounced <= 0) continue;
          coverage.shellBounces += bounced;
          const near: Surface[] = [];
          if (
            !wasOpen &&
            Math.min(
              earlier.x - inset,
              game.width - inset - earlier.x,
              earlier.y - inset,
              game.height - inset - earlier.y,
            ) <= SHELL_REACH
          )
            near.push("wall");
          // Read after the tick, and only on a bounce: a shell cuts nothing, so what it met is still standing.
          if (
            [...game.players.values()]
              .flatMap((player) => player.trail)
              .some(
                (trail) =>
                  pointSegmentDistanceSquared(earlier.x, earlier.y, trail) <=
                  square(SHELL_REACH),
              )
          )
            near.push("trail");
          if (
            obstacles.some(
              (obstacle) =>
                obstacleDistanceSquared(obstacle, earlier.x, earlier.y) <=
                square(SHELL_REACH),
            )
          )
            near.push("scenery");
          if (near.length === 1) coverage.shellBouncesOff[near[0]!] += bounced;
        }
        coverage.immuneBounces +=
          [...game.matchStats.values()].reduce(
            (sum, entry) => sum + entry.wallBounces,
            0,
          ) - bouncesBefore;
      }
      if (playing) {
        if (elapsed > OVERTIME_START_TICK) coverage.overtimeTicks++;
        if (game.map === "wrap" && !edgesOpen(game)) coverage.wrapWalledTicks++;
        const riding = [...game.players.values()].filter(
          (player) => player.alive,
        );
        for (const field of game.gravityFields) {
          const key = `${round}/${field.expiresAtTick}/${field.radius}`;
          const inside = riding.filter(
            (player) =>
              square(player.x - field.x) + square(player.y - field.y) <
              square(field.radius),
          ).length;
          coverage.gravityBentTicks += inside;
          if (inside) visitedFields.add(key);
          // Opened by a pickup GRAVITY_FIELD_TICKS before it closes, and rounds start empty: this one ran its course.
          if (
            field.expiresAtTick === game.tick + 1 &&
            visitedFields.has(key) &&
            elapsed >= GRAVITY_FIELD_TICKS - 1
          )
            coverage.gravityFullTerms++;
        }
        for (const player of riding) {
          for (const effect of TIMED_EFFECTS) {
            const until = untilOf(player, effect);
            if (until > game.tick) coverage.effectTicks[effect]++;
            if (until === game.tick + 1) coverage.effectFullTerms[effect]++;
          }
          if (
            effectUntil(player, "drunk") > game.tick &&
            player.drunkHeadingOffset !== 0
          )
            coverage.drunkSwayTicks++;
          if (player.aimSlowTicks > 0) coverage.aimSlowedTicks++;
          if (player.aimSlowTicks === AIM_SLOW_RAMP_TICKS)
            coverage.aimSlowestTicks++;
          if (player.aimSlowSpentTicks === AIM_SLOW_MAX_TICKS)
            coverage.aimSpentTicks++;
          if (player.grip) coverage.gripTicks++;
          if (player.shielded) coverage.shieldedTicks++;
          if (!player.connected) coverage.absentRiderTicks++;
        }
        if (game.roundParticipants.size === 4) coverage.shortHandedTicks++;
        if (
          state.bots.size === 4 &&
          [...state.bots].every((id) => game.roundParticipants.has(id))
        )
          coverage.botFillInTicks++;
      }
      if (humans === 1 && state.folds.size === 2) coverage.rejoins++;
      // Only a return to the lobby gives a room in play a new match id; a rematch needs the match to be over.
      if (wasPlaying && game.matchId !== matchId) coverage.abandonedRounds++;
      for (const [id, player] of state.game.players) {
        const before = players.get(id);
        if (!before || before.matchId !== state.game.matchId) continue;
        if (sameRound && wasPlaying && !before.connected && player.connected)
          coverage.reconnections++;
        // A step is a few units; half a board in one tick with no gate used is an open edge carrying the rider through.
        if (
          wasOpen &&
          game.phase === "playing" &&
          before.alive &&
          player.alive &&
          effectUntil(player, "portalCooldown") === before.cooldown &&
          (Math.abs(player.x - before.x) > game.width / 2 ||
            Math.abs(player.y - before.y) > game.height / 2)
        )
          coverage.edgeCrossings++;
        if (
          before.shielded &&
          !player.shielded &&
          player.alive &&
          effectUntil(player, "shieldGrace") ===
            state.game.tick + SHIELD_GRACE_TICKS
        )
          coverage.shieldAbsorbs++;
        if (
          effectUntil(player, "portalCooldown") > before.cooldown &&
          effectUntil(player, "portalCooldown") ===
            state.game.tick + PORTAL_COOLDOWN_TICKS &&
          effectUntil(player, "portalGrace") ===
            state.game.tick + PORTAL_GRACE_TICKS &&
          Math.abs(player.x - before.x) > 100
        )
          coverage.portalTransits++;
      }
    };
  };
}

/** How the recorder goes about a requirement; the test reads only `claim` and `met`. */
export type Stage = "play" | "roster" | "duel" | "joust";

/**
 * What the recording has to exercise. The recorder plays until every one of these holds and the golden test asserts
 * every one of them from its own replay, so a fresh `--record` cannot produce a fixture that fails its own test.
 * The order is the order the recorder works in: what takes luck comes first, so the rest happens along the way.
 */
export interface Requirement {
  key: string;
  claim: string;
  met: (coverage: ReplayCoverage) => boolean;
  /** The pickups the room is asked to drop while this is still to be reached. */
  pickups: readonly PickupType[];
  /** The ground it has to happen on. */
  map?: ArenaMapId;
  stage: Stage;
}
const requirement = (
  key: string,
  claim: string,
  met: Requirement["met"],
  pickups: readonly PickupType[] = [],
  map?: ArenaMapId,
  stage: Stage = "play",
): Requirement => ({
  key,
  claim,
  met,
  pickups,
  ...(map ? { map } : {}),
  stage,
});

const any = (counts: Record<string, number>): boolean =>
  Object.values(counts).some((count) => count > 0);
const PICKUP_OF_WEAPON: Record<Weapon, readonly PickupType[]> = {
  bomb: [],
  triple: ["triple"],
  five: ["five"],
  // Target Bomb is gone (rules 40): no pickup arms it, so nothing can be asked for.
  target: [],
  gun: ["gun"],
  shell: ["shell"],
};
const PLAYED_MAPS: readonly ArenaMapId[] = [
  "desert",
  "forest",
  "city",
  "wrap",
  "classic",
  "cross",
  "drift",
  "trains",
];

export const REQUIREMENTS: readonly Requirement[] = [
  requirement(
    "gun:scenery",
    "a bullet fired on an obstacle map is stopped by scenery, with more scenery of a higher id behind it in its line",
    (coverage) => coverage.gunSceneryStops > 0 && coverage.gunScreenedStops > 0,
    ["gun"],
    "forest",
  ),
  requirement(
    "shell:scenery",
    "a shell bounces off scenery with nothing else in reach",
    (coverage) => coverage.shellBouncesOff.scenery > 0,
    ["shell"],
    "forest",
  ),
  requirement(
    "gun",
    "guns are fired and their tracers are stored",
    (coverage) => coverage.pulls.gun >= 4 && coverage.gunTracers >= 4,
    ["gun"],
  ),
  ...(["gun", "shell", "bomb"] as const).map((weapon) =>
    requirement(
      `kill:${weapon}`,
      `a kill is credited to a ${weapon} pull`,
      (coverage) => coverage.kills[weapon] > 0,
      PICKUP_OF_WEAPON[weapon],
    ),
  ),
  // Triple and Five are one family: the same lobbed bombs, fanned out, under a label of their own.
  requirement(
    "kill:volley",
    "a kill is credited to a triple or five volley",
    (coverage) => coverage.kills.triple + coverage.kills.five > 0,
    ["triple", "five"],
  ),
  requirement(
    "shell",
    "shells are launched, fly and bounce",
    (coverage) =>
      coverage.pulls.shell >= 3 &&
      coverage.shellTicks >= 60 &&
      coverage.shellBounces >= 3,
    ["shell"],
  ),
  requirement(
    "shell:trail",
    "a shell bounces off a trail with nothing else in reach",
    (coverage) => coverage.shellBouncesOff.trail > 0,
    ["shell"],
  ),
  requirement(
    "shell:wall",
    "a shell bounces off the boundary with nothing else in reach",
    (coverage) => coverage.shellBouncesOff.wall > 0,
    ["shell"],
    "classic",
  ),
  requirement(
    "chain",
    "a lobbed bomb is set off by another blast before its own fuse",
    (coverage) => coverage.chainReactions > 0,
    ["extraBomb", "triple", "five"],
  ),
  requirement(
    "gravity",
    "a black hole stands for its whole duration and bends a rider inside its radius",
    (coverage) =>
      coverage.gravityFullTerms > 0 &&
      coverage.gravityBentTicks >= GRAVITY_FIELD_TICKS / 4,
    ["gravity"],
  ),
  ...TIMED_EFFECTS.map((effect) =>
    requirement(
      `effect:${effect}`,
      `${effect} holds a living rider for at least one whole duration and is carried to its last tick`,
      (coverage) =>
        coverage.effectTicks[effect] >= EFFECT_DURATION_TICKS[effect] &&
        coverage.effectFullTerms[effect] > 0,
      [effect],
    ),
  ),
  requirement(
    "beer:sway",
    "a drunk rider's heading is pushed off course for most of the effect",
    (coverage) => coverage.drunkSwayTicks >= DRUNK_DURATION_TICKS / 2,
    ["beer"],
  ),
  requirement(
    "star:bounce",
    "a hazard-immune rider is turned back by the boundary",
    (coverage) => coverage.immuneBounces > 0,
    ["star"],
  ),
  requirement(
    "grip",
    "a rider rides on with GRIP and pulls the trigger with it",
    (coverage) =>
      coverage.gripTicks >= STAR_DURATION_TICKS &&
      coverage.upgradedPulls.grip > 0,
    ["grip"],
  ),
  requirement(
    "portal",
    "a rider crosses a portal with exit grace",
    (coverage) => coverage.portalTransits > 0,
    ["portal"],
  ),
  requirement(
    "shield",
    "a shield is carried, then absorbs a hazard while its rider survives",
    (coverage) => coverage.shieldAbsorbs > 0 && coverage.shieldedTicks > 0,
    ["orbitShield"],
  ),
  requirement(
    "triple",
    "triple volleys are thrown",
    (coverage) => coverage.pulls.triple >= 2,
    ["triple"],
  ),
  requirement(
    "five",
    "five volleys are thrown",
    (coverage) => coverage.pulls.five >= 2,
    ["five"],
  ),
  requirement(
    "upgrades",
    "pulls are made with Power, a shorter fuse and an extra bomb",
    (coverage) =>
      coverage.upgradedPulls.power > 0 &&
      coverage.upgradedPulls.fuse > 0 &&
      coverage.upgradedPulls.extraBomb > 0,
    ["power", "stopwatch", "extraBomb"],
  ),
  ...PICKUP_TYPES.map((type) =>
    requirement(
      `collect:${type}`,
      `a rider collects ${type}`,
      (coverage) => coverage.collected.includes(type),
      [type],
    ),
  ),
  requirement(
    "aim:slow",
    "holding the bomb button eases riders down to the slowest level, and a long hold spends the whole budget",
    (coverage) =>
      coverage.aimSlowedTicks >= AIM_SLOW_MAX_TICKS &&
      coverage.aimSlowestTicks > 0 &&
      coverage.aimSpentTicks > 0,
  ),
  requirement(
    "bomb",
    "bombs are lobbed and explode",
    (coverage) => coverage.pulls.bomb > 0 && coverage.explosions > 0,
  ),
  ...(["wall", "trail", "explosion"] as const).map((cause) =>
    requirement(
      `death:${cause}`,
      `a rider is eliminated by ${cause}`,
      (coverage) => coverage.eliminations[cause] > 0,
    ),
  ),
  requirement(
    "obstacle:blast",
    "a blast clears an obstacle away on the tick it opens",
    (coverage) => coverage.obstaclesBlasted > 0,
    [],
    "forest",
  ),
  requirement(
    "obstacle:crash",
    "a rider crashes into scenery and dies against it",
    (coverage) => coverage.sceneryCrashes > 0,
    [],
    "forest",
  ),
  requirement(
    "mover:crash",
    "a rider dies against scenery that moves: a train or the drifting cross",
    (coverage) => coverage.moverCrashes > 0,
    [],
    "trains",
  ),
  requirement(
    "wrap:crossing",
    "a living rider is carried through an open edge without a portal",
    (coverage) => coverage.edgeCrossings > 0,
    [],
    "wrap",
  ),
  requirement(
    "wrap:blast",
    "a blast opens over an open edge and stands on both sides of it",
    (coverage) => coverage.edgeBlasts > 0,
    [],
    "wrap",
  ),
  ...PLAYED_MAPS.map((map) =>
    requirement(
      `map:${map}`,
      `a round is played on ${map}`,
      (coverage) => coverage.maps.includes(map),
      [],
      map,
    ),
  ),
  requirement(
    "rounds",
    "at least five rounds are decided, one of them a follow-on round of its match",
    (coverage) => coverage.roundsEnded >= 5 && coverage.followOnRounds > 0,
  ),
  requirement(
    "matches",
    "at least two matches end, with a champion and final standings of at least two riders",
    (coverage) =>
      coverage.matchesEnded >= 2 &&
      coverage.matchesWon > 0 &&
      coverage.fewestFinishers >= 2,
  ),
  requirement(
    "fast:steps",
    "only bots survive a round in play: log ticks run extra simulation steps, and a round ends inside such a tick",
    (coverage) => coverage.fastSteps >= 60 && coverage.fastRoundEnds > 0,
  ),
  requirement("moment", "a highlight moment is recorded", (coverage) =>
    any(coverage.moments),
  ),
  requirement(
    "roster:presence",
    "a rider marked absent in play is marked present again in the same round",
    (coverage) => coverage.reconnections > 0,
  ),
  requirement(
    "abandon",
    "a return to the lobby abandons a round in play",
    (coverage) => coverage.abandonedRounds > 0,
  ),
  requirement(
    "roster:absent",
    "a rider leaves mid-round and rides on absent",
    (coverage) => coverage.absentRiderTicks > 0,
    [],
    undefined,
    "roster",
  ),
  requirement(
    "roster:short",
    "the round boundary prunes the rider that left and the next round is one short",
    (coverage) => coverage.shortHandedTicks > 0,
    [],
    undefined,
    "roster",
  ),
  requirement(
    "roster:bot",
    "a fourth bot rides in the seat the human left",
    (coverage) => coverage.botFillInTicks > 0,
    [],
    undefined,
    "roster",
  ),
  requirement(
    "roster:rejoin",
    "the human takes its seat back from the bot",
    (coverage) => coverage.rejoins > 0,
    [],
    undefined,
    "roster",
  ),
  requirement(
    "overtime:wrap",
    "overtime stands walls around a wrap round and a rider dies against them",
    (coverage) =>
      coverage.wrapWalledTicks >= 40 && coverage.overtimeWallDeaths > 0,
    [],
    "wrap",
    "duel",
  ),
  requirement(
    "overtime:rubble",
    "overtime walls crush scenery on an obstacle map",
    (coverage) => coverage.overtimeTicks > 0 && coverage.overtimeRubble > 0,
    [],
    "forest",
    "duel",
  ),
  requirement(
    "death:rider",
    "two riders meet head on and one is eliminated by rider",
    (coverage) => coverage.eliminations.rider > 0,
    [],
    "classic",
    "joust",
  ),
  requirement(
    "tie",
    "riders eliminated on one tick share a place, the round is drawn and so is its match",
    (coverage) =>
      coverage.tiedRounds > 0 &&
      coverage.roundsDrawn > 0 &&
      coverage.matchesEnded > coverage.matchesWon,
    [],
    "classic",
    "joust",
  ),
];

export const unmet = (coverage: ReplayCoverage): Requirement[] =>
  REQUIREMENTS.filter((entry) => !entry.met(coverage));
