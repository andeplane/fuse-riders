import type { WorldView } from "../../engine/view.js";

/** Cosmetic identity is bounded by the current frame, never retained for a whole match. */
export class EffectTransitions {
  private scope = "";
  private tick = -1;
  private blasts = new Set<number>();
  private living = new Set<string>();
  private obstacles = new Map<number, WorldView["obstacles"][number]>();
  reset(): void {
    this.scope = "";
    this.tick = -1;
    this.blasts.clear();
    this.living.clear();
    this.obstacles.clear();
  }
  accept(
    snapshot: WorldView,
    matchId: string,
  ): {
    explosions: WorldView["blasts"];
    deaths: WorldView["players"];
    rubble: WorldView["obstacles"];
  } {
    const scope = `${matchId}:${snapshot.round}`;
    const reset = scope !== this.scope || snapshot.tick < this.tick;
    const explosions = reset
      ? []
      : snapshot.blasts.filter((blast) => !this.blasts.has(blast.bombId));
    const deaths = reset
      ? []
      : snapshot.players.filter(
          (player) => !player.alive && this.living.has(player.id),
        );
    // An obstacle that has left the board was blown away or crushed by the closing walls; either way it puffs.
    const standing = new Set(snapshot.obstacles.map((obstacle) => obstacle.id));
    const rubble = reset
      ? []
      : [...this.obstacles.values()].filter(
          (obstacle) => !standing.has(obstacle.id),
        );
    this.scope = scope;
    this.tick = snapshot.tick;
    this.blasts = new Set(snapshot.blasts.map((blast) => blast.bombId));
    this.living = new Set(
      snapshot.players
        .filter((player) => player.alive)
        .map((player) => player.id),
    );
    this.obstacles = new Map(
      snapshot.obstacles.map((obstacle) => [obstacle.id, obstacle]),
    );
    return { explosions, deaths, rubble };
  }
}

/** Samples the authoritative flight path; the blast circle stays at the landing site. */
export function bombPose(
  bomb: WorldView["bombs"][number],
  tick: number,
): { x: number; y: number; flight: number } {
  const flight = Math.max(
    0,
    Math.min(
      1,
      (tick - bomb.launchedTick) /
        Math.max(1, bomb.landsAtTick - bomb.launchedTick),
    ),
  );
  if (flight === 1 || bomb.shell) return { x: bomb.x, y: bomb.y, flight };
  if (bomb.flightPath.length < 2)
    return {
      x: bomb.launchX + (bomb.x - bomb.launchX) * flight,
      y: bomb.launchY + (bomb.y - bomb.launchY) * flight,
      flight,
    };
  const position = flight * (bomb.flightPath.length - 1);
  const index = Math.min(bomb.flightPath.length - 2, Math.floor(position));
  const a = bomb.flightPath[index]!;
  const b = bomb.flightPath[index + 1]!;
  const mix = position - index;
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix, flight };
}
