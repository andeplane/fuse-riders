import { BLAST_VISIBLE_TICKS, TRAIL_WIDTH } from '../shared/game.js';
import { advanceTrail } from '../shared/trail-lifecycle.js';
import { segmentIntersectsDisk } from '../shared/blast-geometry.js';
import type { TrailSegment } from '../shared/protocol.js';
import type { ViewSnapshot } from './snapshot-stream.js';

export interface DebrisStroke { x1: number; y1: number; x2: number; y2: number; color: string; alpha: number; width: number }
interface Fragment {
  x: number; y: number; length: number; angle: number; vx: number; vy: number;
  spin: number; born: number; life: number; color: string;
}
interface TrailHistory { id: string; color: string; trail: readonly TrailSegment[] }
const HISTORY_PER_RIDER = 2048;
const clamp = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Client-only fragments inferred from newly blasted, missing trail segments. One bounded prior
 * trail frame is enough; expiry, boundary trimming and speculative tips must never emit debris.
 * Randomness and the analytic drag/spin motion belong only to this renderer, not the shared world.
 */
export class TrailDebris {
  private scope = '';
  private tick = -1;
  private now = -1;
  private trails: TrailHistory[] = [];
  private fragments: Fragment[] = [];
  private blasts = new Set<number>();
  constructor(private readonly limit = 240, private readonly random: () => number = Math.random) {}

  reset(): void {
    this.scope = ''; this.tick = -1; this.now = -1;
    this.trails = []; this.fragments = []; this.blasts.clear();
  }

  update(snapshot: ViewSnapshot, now: number, match: string): DebrisStroke[] {
    const scope = `${match}:${snapshot.round}`;
    const reset = scope !== this.scope || snapshot.tick < this.tick || now < this.now ||
      snapshot.phase === 'lobby' || snapshot.phase === 'countdown';
    if (reset) this.reset();
    this.fragments = this.fragments.filter(piece => now - piece.born < piece.life);
    const fresh = reset ? [] : snapshot.blasts.filter(blast => !this.blasts.has(blast.bombId) &&
      blast.expiresAtTick > snapshot.tick && blast.expiresAtTick - BLAST_VISIBLE_TICKS > Math.floor(this.tick));
    if (fresh.length) {
      const incoming: Fragment[] = [];
      let candidates = 0;
      for (const previous of this.trails) {
        const rider = snapshot.players.find(player => player.id === previous.id);
        if (!rider) continue;
        // A partially clipped/corrected segment is not a fully removed piece of trail.
        const retained = new Set(rider.trail.map(segment => segment.createdTick));
        for (const segment of advanceTrail(previous.trail, Math.floor(snapshot.tick), Math.floor(this.tick))) {
          if (retained.has(segment.createdTick)) continue;
          const b = snapshot.boundaryInset;
          if ([segment.x1, segment.x2].some(x => x < b || x > snapshot.width - b) ||
              [segment.y1, segment.y2].some(y => y < b || y > snapshot.height - b)) continue;
          const x = (segment.x1 + segment.x2) / 2, y = (segment.y1 + segment.y2) / 2;
          // An overlap launches each piece once, using the strongest local blast.
          let strongest: ViewSnapshot['blasts'][number] | undefined;
          let pressure = -Infinity;
          for (const blast of fresh) {
            if (!segmentIntersectsDisk(segment.x1, segment.y1, segment.x2, segment.y2, blast.circle, TRAIL_WIDTH / 2)) continue;
            const force = 1 - Math.hypot(x - blast.circle.x, y - blast.circle.y) / Math.max(1, blast.circle.radius);
            if (force > pressure) { strongest = blast; pressure = force; }
          }
          if (!strongest) continue;
          const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
          if (length < .1) continue;
          const pieces = Math.min(12, Math.ceil(length / 14));
          for (let i = 0; i < pieces; i++) {
            const t = (i + .5) / pieces;
            const px = segment.x1 + (segment.x2 - segment.x1) * t, py = segment.y1 + (segment.y2 - segment.y1) * t;
            const dx = px - strongest.circle.x, dy = py - strongest.circle.y;
            const direction = (Math.hypot(dx, dy) < 1 ? this.random() * Math.PI * 2 : Math.atan2(dy, dx)) + (this.random() - .5) * .65;
            const speed = (200 + 360 * clamp(pressure)) * (.75 + this.random() * .5);
            const piece: Fragment = { x: px, y: py, length: length / pieces,
              angle: Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1),
              vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed,
              spin: (this.random() - .5) * 22, born: now, life: 520 + this.random() * 300, color: previous.color };
            // Reservoir sampling shares the budget across every rider in a dense chain reaction.
            const slot = candidates < this.limit ? candidates : Math.floor(this.random() * (candidates + 1));
            if (slot < this.limit) incoming[slot] = piece;
            candidates++;
          }
        }
      }
      this.fragments = [...this.fragments, ...incoming].slice(-this.limit);
    }
    if (reset || Math.floor(snapshot.tick) !== Math.floor(this.tick) || fresh.length) {
      this.trails = snapshot.players.map(player => ({ id: player.id, color: player.color,
        trail: player.trail.filter(segment => segment.createdTick <= Math.floor(snapshot.tick))
          .slice(-HISTORY_PER_RIDER).map(segment => ({ ...segment })) }));
      this.blasts = new Set(snapshot.blasts.map(blast => blast.bombId));
    }
    this.scope = scope; this.tick = snapshot.tick; this.now = now;
    return this.fragments.map(piece => {
      const age = clamp((now - piece.born) / piece.life), seconds = Math.max(0, now - piece.born) / 1000;
      const travel = (1 - Math.exp(-3.4 * seconds)) / 3.4;
      const x = piece.x + piece.vx * travel, y = piece.y + piece.vy * travel;
      const angle = piece.angle + piece.spin * (1 - Math.exp(-1.8 * seconds)) / 1.8;
      const half = piece.length * (1 - .65 * age ** 2) / 2;
      return { x1: x - Math.cos(angle) * half, y1: y - Math.sin(angle) * half,
        x2: x + Math.cos(angle) * half, y2: y + Math.sin(angle) * half,
        color: piece.color, alpha: 1 - clamp((age - .35) / .65) ** 2, width: 4 * (1 - .6 * age) };
    });
  }
}
