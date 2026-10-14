import type { MatchResult } from "fuse-platform";
import { players, type FuseDriversRoom } from "./rules.js";
import type { FuseDriversStats } from "../platform.js";

/**
 * A race's receipt, computed identically on every peer from the finished race alone.
 *
 * Nothing a player can still change afterwards may enter it, so the numbers come from the race state at
 * the tick it finished, not from the lobby a player may since have left or renamed themselves in.
 */
export function matchResult(
  room: FuseDriversRoom,
): MatchResult<FuseDriversStats> | undefined {
  const race = room.race;
  if (!race || room.stage !== "over") return;

  const seats = players(room);
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const stats: FuseDriversStats[] = [];

  for (const [truck, id] of room.grid.entries()) {
    const seat = byId.get(id);
    const car = race.trucks[truck];
    if (!seat || !car) continue;
    const placement = race.placements.indexOf(truck) + 1;
    stats.push({
      playerId: id,
      name: seat.name,
      slot: seat.slot,
      roundsPlayed: 1,
      // One race, so a win is first place across the line.
      roundWins: placement === 1 ? 1 : 0,
      matchScoreUnits: Math.max(0, Math.round(car.progress * 100)),
      matchPlacement: placement > 0 ? placement : room.grid.length,
      earlyExits: seat.connected ? 0 : 1,
      laps: car.laps,
      kills: car.kills,
      deaths: car.deaths,
      lapsLed: car.lapsLed,
      nitrosUsed: car.nitrosUsed,
    });
  }
  if (stats.length === 0) return;

  // One order for every peer, so equal results serialize to equal bytes.
  stats.sort((a, b) => a.slot - b.slot || (a.playerId < b.playerId ? -1 : 1));
  const finishers = [...stats]
    .sort((a, b) => a.matchPlacement - b.matchPlacement)
    .map((player) => player.playerId);
  const winner = stats.find((player) => player.matchPlacement === 1);

  return {
    matchId: room.matchId,
    length: 1,
    ...(winner ? { winnerId: winner.playerId } : {}),
    finishers,
    players: stats,
  };
}

/**
 * A rating receipt for one race of a series. A race is the whole match today, so the round receipt is the
 * match result carrying its round number; it rates without crediting career totals twice.
 */
export function roundResult(
  room: FuseDriversRoom,
  round: number,
): MatchResult<FuseDriversStats> | undefined {
  if (round !== room.round) return;
  const result = matchResult(room);
  return result ? { ...result, round } : undefined;
}
