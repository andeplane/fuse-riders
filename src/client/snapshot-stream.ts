import type { GameSnapshot } from '../shared/protocol.js';

/** Per-rider presentation time is local rendering metadata, never authoritative state. */
export type ViewPlayer = GameSnapshot['players'][number] & { presentationTick?: number };
export type ViewSnapshot = Omit<GameSnapshot, 'players'> & { tick: number; round: number; players: readonly ViewPlayer[] };
export interface SnapshotEnvelope { matchId: string; round: number; tick: number; state: GameSnapshot }

/** Accepts only forward progress while allowing opaque, randomly generated match IDs. */
export class SnapshotStream {
  private current?: { matchId: string; round: number; tick: number };
  private readonly retiredMatchIds = new Set<string>();

  accept(message: SnapshotEnvelope): ViewSnapshot | undefined {
    if (this.current) {
      if (message.matchId === this.current.matchId) {
        if (message.round < this.current.round) return undefined;
        // Equal-tick snapshots are authoritative membership/auth resyncs sent
        // immediately after a join or connection change on the ordered socket.
        if (message.round === this.current.round && message.tick < this.current.tick) return undefined;
      } else {
        if (this.retiredMatchIds.has(message.matchId)) return undefined;
        this.retiredMatchIds.add(this.current.matchId);
      }
    }
    this.current = { matchId: message.matchId, round: message.round, tick: message.tick };
    return { ...message.state, tick: message.tick, round: message.round };
  }

  get scope(): Readonly<{ matchId: string; round: number; tick: number }> | undefined { return this.current; }
}
