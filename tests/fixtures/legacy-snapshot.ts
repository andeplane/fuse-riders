/**
 * `toSnapshot` exactly as it stood before issue #254 added the rules-as-data fields (#309, 14e1452), kept so
 * `tests/view-contract.test.ts` can show that every field a screen read before is still published unchanged.
 * Compare with `git show 14e1452:src/engine/view.ts`. Delete this file and that test the next time the shape of
 * the view changes on purpose (stage A4 of #253 keeps it; whatever follows may not).
 */
import {
  type GameState,
  sortedBombs,
  sortedPlayers,
} from "../../src/engine/state.js";
import { snapshotMatchStats } from "../../src/engine/match-stats.js";
import { sortedLeaderboard } from "../../src/engine/leaderboard.js";

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
      invulnerableUntilTick: player.invulnerableUntilTick,
      nitroUntilTicks: [...player.nitroUntilTicks],
      snailUntilTicks: [...player.snailUntilTicks],
      rangeLevel: player.rangeLevel,
      grip: player.grip,
      drunkUntilTick: player.drunkUntilTick,
      inkUntilTick: player.inkUntilTick,
      gunArmed: player.gunArmed,
      shellArmed: player.shellArmed,
      targetBombArmed: player.targetBombArmed,
      ...(player.bombTarget ? { bombTarget: { ...player.bombTarget } } : {}),
      tripleShotArmed: player.tripleShotArmed,
      fiveShotArmed: player.fiveShotArmed,
      shielded: player.shielded,
      shieldGraceUntilTick: player.shieldGraceUntilTick,
      portalCooldownUntilTick: player.portalCooldownUntilTick,
      portalGraceUntilTick: player.portalGraceUntilTick,
      trail: player.trail.map((segment) => ({ ...segment })),
    })),
    bombs: sortedBombs(state).map((bomb) => ({
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
    pickups: state.pickups.map((pickup) => ({ ...pickup })),
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
