import type { ViewSnapshot } from '../snapshot-stream.js';

/** Cosmetic identity is bounded by the current frame, never retained for a whole match. */
export class EffectTransitions {
  private scope = '';
  private tick = -1;
  private blasts = new Set<number>();
  private living = new Set<string>();
  reset(): void { this.scope = ''; this.tick = -1; this.blasts.clear(); this.living.clear(); }
  accept(snapshot: ViewSnapshot, matchId: string): { explosions: ViewSnapshot['blasts']; deaths: ViewSnapshot['players'] } {
    const scope = `${matchId}:${snapshot.round}`;
    const reset = scope !== this.scope || snapshot.tick < this.tick;
    const explosions = reset ? [] : snapshot.blasts.filter(blast => !this.blasts.has(blast.bombId));
    const deaths = reset ? [] : snapshot.players.filter(player => !player.alive && this.living.has(player.id));
    this.scope = scope; this.tick = snapshot.tick;
    this.blasts = new Set(snapshot.blasts.map(blast => blast.bombId));
    this.living = new Set(snapshot.players.filter(player => player.alive).map(player => player.id));
    return { explosions, deaths };
  }
}

/** Samples the authoritative flight path; the blast circle stays at the landing site. */
export function bombPose(bomb: ViewSnapshot['bombs'][number], tick: number): { x: number; y: number; flight: number } {
  const flight = Math.max(0, Math.min(1, (tick - bomb.launchedTick) / Math.max(1, bomb.landsAtTick - bomb.launchedTick)));
  if (flight === 1 || bomb.shell) return { x: bomb.x, y: bomb.y, flight };
  if (bomb.flightPath.length < 2) return { x: bomb.launchX + (bomb.x - bomb.launchX) * flight, y: bomb.launchY + (bomb.y - bomb.launchY) * flight, flight };
  const position = flight * (bomb.flightPath.length - 1);
  const index = Math.min(bomb.flightPath.length - 2, Math.floor(position));
  const a = bomb.flightPath[index]!; const b = bomb.flightPath[index + 1]!; const mix = position - index;
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix, flight };
}
