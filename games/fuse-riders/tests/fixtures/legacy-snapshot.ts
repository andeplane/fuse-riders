/**
 * `toSnapshot` exactly as it stood before issue #254 added the rules-as-data fields (#309, 14e1452), kept so
 * `games/fuse-riders/tests/view-contract.test.ts` can show that every field a screen read before is still published unchanged.
 * Compare with `git show 14e1452:games/fuse-riders/src/engine/view.ts`. Delete this file and that test the next time the shape of
 * the view changes on purpose (stage A4 of #253 keeps it; whatever follows may not).
 */
import {
  type GameState,
  sortedBombs,
  sortedPlayers,
} from "../../src/engine/state.js";
import { snapshotMatchStats } from "../../src/engine/match-stats.js";
import { sortedLeaderboard } from "../../src/engine/leaderboard.js";
import { effectDeadlines, effectUntil } from "../../src/engine/effects.ts";
import { isArmed } from "../../src/engine/weapons.ts";

export function legacySnapshot(state: GameState) {
  return {
    matchLength: state.settings.length,
    bombChargeTicks: state.settings.bombChargeTicks,
    aimBounce: state.settings.aimBounce,
    phase: state.phase,
    ...(state.phaseEndsAtTick === undefined
      ? {}
      : { phaseEndsAtTick: state.phaseEndsAtTick }),
    ...(state.roundStartedTick === undefined
      ? {}
      : { roundStartedTick: state.roundStartedTick }),
    width: state.width,
    height: state.height,
    boundaryInset: state.boundaryInset,
    map: state.map,
    obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
    players: sortedPlayers(state).map((player) => ({
      id: player.id,
      name: player.name,
      avatarId: player.avatarId,
      slot: player.slot,
      color: player.color,
      connected: player.connected,
      x: player.x,
      y: player.y,
      angle: player.angle,
      alive: player.alive,
      waitingForNextRound:
        state.phase !== "lobby" && !state.roundParticipants.has(player.id),
      roundWins: player.roundWins,
      matchScoreUnits: state.matchStats.get(player.id)?.matchScoreUnits ?? 0,
      roundScoreUnits:
        state.roundPlacements.find(
          (placement) => placement.playerId === player.id,
        )?.scoreUnits ?? 0,
      bombReadyAtTick: player.bombReadyAtTick,
      ...(player.bombChargeStartedTick === undefined
        ? {}
        : { bombChargeStartedTick: player.bombChargeStartedTick }),
      aimSlowTicks: player.aimSlowTicks,
      aimSlowSpentTicks: player.aimSlowSpentTicks,
      extraBombs: player.extraBombs,
      fuseLevel: player.fuseLevel,
      powerPickups: player.powerPickups,
      reloadDurationTicks: player.reloadDurationTicks,
      invulnerableUntilTick: effectUntil(player, "star"),
      nitroUntilTicks: [...effectDeadlines(player, "nitro")],
      snailUntilTicks: [...effectDeadlines(player, "snail")],
      rangeLevel: player.rangeLevel,
      grip: player.grip,
      drunkUntilTick: effectUntil(player, "drunk"),
      inkUntilTick: effectUntil(player, "ink"),
      gunArmed: isArmed(player, "gun"),
      ...(player.gunAim === undefined ? {} : { gunAim: player.gunAim }),
      shellArmed: isArmed(player, "shell"),
      tripleShotArmed: isArmed(player, "triple"),
      fiveShotArmed: isArmed(player, "five"),
      shielded: player.shielded,
      shieldGraceUntilTick: effectUntil(player, "shieldGrace"),
      portalCooldownUntilTick: effectUntil(player, "portalCooldown"),
      portalGraceUntilTick: effectUntil(player, "portalGrace"),
      trail: player.trail.map((segment) => ({ ...segment })),
    })),
    // Since #253 A4 a Gun's tracers are kept apart from the bombs; this snapshot publishes them among the bombs, in id
    // order, as it always did (scripts/engine-differential.ts compares the bytes against main).
    bombs: [
      ...sortedBombs(state).map((bomb) => ({
        id: bomb.id,
        ownerId: bomb.ownerId,
        launchX: bomb.launchX,
        launchY: bomb.launchY,
        x: bomb.x,
        y: bomb.y,
        launchedTick: bomb.launchedTick,
        landsAtTick: bomb.landsAtTick,
        flightPath: bomb.flightPath.map((point) => ({ ...point })),
        explodeAtTick: bomb.explodeAtTick,
        blastRange: bomb.blastRange,
        ...(bomb.shell ? { shell: { ...bomb.shell } } : {}),
      })),
      ...state.tracers.map((tracer) => ({
        id: tracer.id,
        ownerId: tracer.ownerId,
        launchX: tracer.launchX,
        launchY: tracer.launchY,
        x: tracer.x,
        y: tracer.y,
        launchedTick: tracer.launchedTick,
        landsAtTick: tracer.expiresAtTick,
        flightPath: [],
        explodeAtTick: tracer.expiresAtTick,
        blastRange: 0,
        shell: { vx: tracer.vx, vy: tracer.vy, gun: true },
      })),
    ].sort((a, b) => a.id - b.id),
    blasts: state.blasts.map((blast) => ({
      bombId: blast.bombId,
      circle: { ...blast.circle },
      expiresAtTick: blast.expiresAtTick,
    })),
    portalPairs: state.portalPairs.map((pair) => ({
      ...pair,
      gates: [{ ...pair.gates[0] }, { ...pair.gates[1] }] as const,
    })),
    gravityFields: state.gravityFields.map((field) => ({ ...field })),
    pickups: state.pickups.map((pickup) => ({
      ...pickup,
      expiresAtTick: Number.MAX_SAFE_INTEGER,
    })),
    leaderboard: sortedLeaderboard(state.leaderboard),
    roundPlacements: state.roundPlacements.map((placement) => ({
      ...placement,
    })),
    matchStats:
      state.phase === "matchOver" ? snapshotMatchStats(state.matchStats) : [],
    matchFinishers: [...state.matchFinishers],
    moments:
      state.phase === "matchOver"
        ? state.moments.map((moment) => ({
            ...moment,
            targetIds: [...moment.targetIds],
          }))
        : [],
    // Only a decided round is published: the round in play can still change.
    ...(state.decidedRound
      ? {
          decidedRound: {
            ...state.decidedRound,
            ...(state.decidedRound.rating
              ? { rating: structuredClone(state.decidedRound.rating) }
              : {}),
            shots: state.decidedRound.shots.map((shot) => ({
              ...shot,
              kills: shot.kills.map((kill) => ({ ...kill })),
            })),
          },
        }
      : {}),
    ...(state.roundWinnerId === undefined
      ? {}
      : { roundWinnerId: state.roundWinnerId }),
    ...(state.matchWinnerId === undefined
      ? {}
      : { matchWinnerId: state.matchWinnerId }),
  };
}
