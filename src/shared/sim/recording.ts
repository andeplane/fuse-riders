import {
  type EliminationCause,
  type GameState,
  type PlayerId,
  type PlayerState,
} from "../state.js";
import { type Weapon, recordShot, recordShotKill } from "../shot-log.js";
import { detachTrail } from "../trail-lifecycle.js";
/** Scaffolding while step() is being split: the statistics and elimination helpers both death paths still call directly. */

export const roundElapsed = (state: GameState): number =>
  state.tick - (state.roundStartedTick ?? state.tick);

export function logShot(
  state: GameState,
  shooter: PlayerState,
  shot: number,
  weapon: Weapon,
  bombs: number,
): void {
  const combat = state.matchStats.get(shooter.id)?.combat;
  if (combat) combat.uses[weapon] += 1;
  recordShot(state.shots, {
    shot,
    shooterId: shooter.id,
    weapon,
    elapsed: roundElapsed(state),
    bombs,
    power: shooter.powerPickups,
    extraBombs: shooter.extraBombs,
    fuseLevel: shooter.fuseLevel,
    grip: shooter.grip,
    kills: [],
  });
}

/**
 * Log a kill against a shot on exactly the deaths `recordDeath` credits as eliminations: one owner behind the
 * explosion, and not the victim itself, so blowing yourself up stays a death with no kill anywhere. The credited
 * owner is necessarily the shot's shooter — every explosion mark on the victim came from that one owner's bombs.
 */
export function logShotKill(
  state: GameState,
  victimId: PlayerId,
  creditedId: PlayerId | undefined,
  shot: number | undefined,
): void {
  if (creditedId === undefined || creditedId === victimId || shot === undefined)
    return;
  recordShotKill(state.shots, shot, { victimId, elapsed: roundElapsed(state) });
}

export function recordElimination(state: GameState, playerId: PlayerId): void {
  const player = state.players.get(playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  player.trail = detachTrail(
    player.trail,
    state.tick,
    () => state.nextTrailPieceId++,
  );
  const participant = state.roundParticipants.get(playerId);
  if (participant && participant.eliminatedAtTick === undefined)
    participant.eliminatedAtTick = state.tick;
}

export function soleCreditedOwner(
  causeOwners: ReadonlyMap<
    PlayerId,
    ReadonlyMap<EliminationCause, ReadonlySet<PlayerId>>
  >,
  victimId: PlayerId,
  cause: EliminationCause,
): PlayerId | undefined {
  const owners = causeOwners.get(victimId)?.get(cause);
  if (!owners || owners.size !== 1) return undefined;
  const ownerId = owners.values().next().value as PlayerId | undefined;
  return ownerId === victimId ? undefined : ownerId;
}
