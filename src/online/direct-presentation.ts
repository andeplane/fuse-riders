import type { ViewSnapshot } from '../client/snapshot-stream.js';
import { interpolateWorld } from './prediction.js';

/** Interpolate one coherent geometry tick, with explicit discontinuities and a real partial trail. */
export function interpolateDirect(older: ViewSnapshot, newer: ViewSnapshot, tick: number): ViewSnapshot {
  if (tick >= newer.tick) return newer;
  if (tick <= older.tick) return older;
  if (older.round !== newer.round || older.phase !== newer.phase) return { ...older, tick };
  const fraction = (tick - older.tick) / (newer.tick - older.tick);
  const view = interpolateWorld(older, newer, fraction);
  const seconds = (newer.tick - older.tick) / 20;
  return { ...view, bombs: view.bombs.map(bomb => {
    const before = older.bombs.find(b => b.id === bomb.id)!, after = newer.bombs.find(b => b.id === bomb.id);
    if (!before.shell || !after?.shell || !!before.shell.gun !== !!after.shell.gun ||
      Math.abs(after.x - before.x - before.shell.vx * seconds) > 1e-6 || Math.abs(after.y - before.y - before.shell.vy * seconds) > 1e-6) return before;
    return bomb;
  }), players: view.players.map(player => {
    const before = older.players.find(p => p.id === player.id)!, after = newer.players.find(p => p.id === player.id);
    if (!before.alive || !after?.alive || before.portalCooldownUntilTick !== after.portalCooldownUntilTick) return player;
    const segment = after.trail.find(s => s.createdTick === newer.tick && s.x1 === before.x && s.y1 === before.y && s.x2 === after.x && s.y2 === after.y);
    if (!segment) return player;
    return { ...player, trail: [...player.trail, { ...segment, x2: player.x, y2: player.y }] };
  }) };
}
function at(frames: readonly ViewSnapshot[], tick: number): ViewSnapshot {
  const upper = frames.findIndex(frame => frame.tick >= tick);
  if (upper === 0) return frames[0];
  if (upper < 0) return frames[frames.length - 1];
  return interpolateDirect(frames[upper - 1], frames[upper], tick);
}

/** Per-segment presentation state; idle packets cannot manufacture evidence of lower jitter. */
export class DirectPresentation {
  private samples = new Map<number, number[]>();
  private delay = 1.5;
  private updatedAt?: number;
  private shown?: ViewSnapshot;
  private correction = 0;
  observe(slot: number, actionTicks: readonly number[], fractionalTick: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot > 4 || !Number.isFinite(fractionalTick)) return;
    const samples = this.samples.get(slot) ?? [];
    for (const tick of actionTicks) if (Number.isFinite(tick)) samples.push(Math.max(0, fractionalTick - tick));
    if (!samples.length) return;
    this.samples.set(slot, samples.slice(-32));
  }
  render(frames: readonly ViewSnapshot[], fractionalTick: number, now: number): ViewSnapshot | undefined {
    if (!frames.length || !Number.isFinite(fractionalTick) || !Number.isFinite(now)) return;
    const p95 = [...this.samples.values()].map(samples => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1]);
    const target = p95.length ? Math.max(1, Math.min(2, Math.max(...p95) + .5)) : this.delay;
    const elapsed = this.updatedAt === undefined ? 0 : Math.max(0, Math.min(200, now - this.updatedAt)) / 1000;
    this.updatedAt = now;
    this.delay += Math.sign(target - this.delay) * Math.min(Math.abs(target - this.delay), elapsed * (target > this.delay ? 2 : .25));
    const tick = Math.max(frames[0].tick, Math.min(frames[frames.length - 1].tick, Math.max(this.shown?.tick ?? -Infinity, fractionalTick - this.delay)));
    this.correction = 0;
    if (this.shown && this.shown.tick >= frames[0].tick) {
      const revised = at(frames, this.shown.tick);
      for (const previous of this.shown.players) {
        const player = revised.players.find(p => p.id === previous.id);
        if (player) this.correction = Math.max(this.correction, Math.hypot(player.x - previous.x, player.y - previous.y));
      }
    }
    this.shown = at(frames, tick);
    return this.shown;
  }
  get diagnostics() { return { delayMs: this.delay * 50, tick: this.shown?.tick, correctionDistance: this.correction, samples: [...this.samples.values()].reduce((sum, samples) => sum + samples.length, 0) }; }
}
