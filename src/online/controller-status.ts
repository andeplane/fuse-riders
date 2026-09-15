import { isGameSnapshot } from './checkpoint.js';
import { parseRoomSettings, type RoomSettings } from '../shared/room-settings.js';
import type { GameSnapshot } from '../shared/protocol.js';
import type { ViewSnapshot } from '../client/snapshot-stream.js';
import type { HostSession } from './host-session.js';

/** Ticks between heartbeats to a controller phone; a status goes out the moment something the phone shows changes. */
export const STATUS_HEARTBEAT_TICKS = 5;
/** What a shared-TV phone shows: phase, roster, its own cooldown and powerups, the recap. No geometry, no projectiles. */
export interface ControllerStatus { type: 'status'; tick: number; matchId: string; round: number; state: GameSnapshot; settings: RoomSettings }
export function stripSnapshot(snapshot: GameSnapshot): GameSnapshot {
  const { portalPair: _portal, ...rest } = snapshot;
  return { ...rest, players: snapshot.players.map(player => ({ ...player, trail: [] })), bombs: [], blasts: [], pickups: [] };
}

/** Sends one phone the stripped snapshot only when something other than positions changed; the heartbeat carries those. */
export class ControllerSender {
  private lastKey = '';
  publish(session: HostSession, send: (status: ControllerStatus) => boolean): void {
    const game = session.game, state = stripSnapshot(session.snapshot()), settings = session.sim.state.pending;
    const key = JSON.stringify({ matchId: game.matchId, round: game.round, settings, state: { ...state, boundaryInset: 0, players: state.players.map(({ x: _x, y: _y, angle: _angle, ...rest }) => rest) } });
    if (key === this.lastKey) return;
    if (send({ type: 'status', tick: game.tick, matchId: game.matchId, round: game.round, state, settings })) this.lastKey = key;
  }
}

export interface ControllerFrame { snapshot: ViewSnapshot; settings: RoomSettings; matchId: string }
/**
 * The view a controller phone renders: the last full status, moved along by heartbeats. A message is validated in
 * full before any of it is kept, so a rejected one leaves the previous view untouched.
 */
export class ControllerView {
  private status?: { state: GameSnapshot; matchId: string; round: number; settings: RoomSettings };
  private tick = 0;
  get ready(): boolean { return this.status !== undefined; }
  reset(): void { this.status = undefined; this.tick = 0; }
  /** A full status from the ordered channel; it is never older than the last one, unlike a heartbeat that raced ahead. */
  receive(raw: unknown): ControllerFrame | undefined {
    if (!raw || typeof raw !== 'object') return;
    const v = raw as ControllerStatus;
    if (v.type !== 'status' || !Number.isSafeInteger(v.tick) || v.tick < 0 || typeof v.matchId !== 'string' || !v.matchId || v.matchId.length > 128 || !Number.isSafeInteger(v.round) || v.round < 0 || !isGameSnapshot(v.state)) return;
    const settings = parseRoomSettings(v.settings); if (!settings) return;
    this.status = { state: v.state, matchId: v.matchId, round: v.round, settings }; this.tick = v.tick;
    return this.frame();
  }
  /** A heartbeat older than the view is ignored; the phone's own rider takes the carried position. */
  heartbeat(tick: number, selfId: string, pos: readonly [number, number, number] | null): ControllerFrame | undefined {
    const status = this.status; if (!status || tick < this.tick) return;
    this.tick = tick;
    if (pos) status.state = { ...status.state, players: status.state.players.map(p => p.id === selfId ? { ...p, x: pos[0], y: pos[1], angle: pos[2] } : p) };
    return this.frame();
  }
  private frame(): ControllerFrame { const s = this.status!; return { snapshot: { ...s.state, tick: this.tick, round: s.round }, settings: s.settings, matchId: s.matchId }; }
}
