import type { RoomBus, RoutedMessage } from './room-bus.js';
import type { RoomDatabase, RoomRecord } from './room-store.js';
import { TOTAL_KEYS, emptyTotals, type Credit, type HistoryDatabase, type MatchRecord, type UserProfile } from './history.js';

const HOUR_MS = 3_600_000;
const MAX_ALLOWANCE_KEYS = 10_000;
interface Watcher { listener: (room: RoomRecord | undefined) => void; failed?: (error: Error) => void }

/** Single-process RoomDatabase for the local room service and tests; production uses Firestore with the same contract. */
export class MemoryRoomDatabase implements RoomDatabase {
  private rooms = new Map<string, RoomRecord>();
  private listeners = new Map<string, Set<Watcher>>();
  private allowances = new Map<string, { hour: number; count: number }>();
  private chain: Promise<unknown> = Promise.resolve();

  async read(code: string): Promise<RoomRecord | undefined> {
    const room = this.rooms.get(code);
    return room && structuredClone(room);
  }

  /** Operations run one at a time, like a serializable transaction, and see a private copy of the record. */
  transact<T>(code: string, operation: (current: RoomRecord | undefined) => { room?: RoomRecord; result: T }): Promise<T> {
    const work = this.chain.then(() => {
      const current = this.rooms.get(code);
      const next = operation(current && structuredClone(current));
      if (next.room) {
        this.rooms.set(code, structuredClone(next.room));
        // Like Firestore, a failing watcher reports through its own callback and never fails the committed write.
        for (const watcher of [...(this.listeners.get(code) ?? [])]) {
          try { watcher.listener(structuredClone(next.room)); } catch (error) { watcher.failed?.(error instanceof Error ? error : new Error('Room watcher failure')); }
        }
      }
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }

  watch(code: string, listener: (room: RoomRecord | undefined) => void, failed?: (error: Error) => void): () => void {
    const listeners = this.listeners.get(code) ?? new Set(), watcher: Watcher = { listener, ...(failed ? { failed } : {}) };
    listeners.add(watcher);
    this.listeners.set(code, listeners);
    return () => {
      listeners.delete(watcher);
      if (listeners.size === 0 && this.listeners.get(code) === listeners) this.listeners.delete(code);
    };
  }

  /** Same hourly window as FirestoreRoomDatabase.allowance. */
  async allowance(key: string, now: number, limit: number): Promise<boolean> {
    const hour = Math.floor(now / HOUR_MS), previous = this.allowances.get(key);
    const count = previous?.hour === hour ? previous.count + 1 : 1;
    if (count > limit) return false;
    if (!previous && this.allowances.size >= MAX_ALLOWANCE_KEYS) {
      for (const [stale, window] of this.allowances) if (window.hour !== hour) this.allowances.delete(stale);
      if (this.allowances.size >= MAX_ALLOWANCE_KEYS) return false;
    }
    this.allowances.set(key, { hour, count });
    return true;
  }
}

/** Single-process HistoryDatabase with FirestoreHistoryDatabase's contract; history disappears when the process exits. */
export class MemoryHistoryDatabase implements HistoryDatabase {
  private matches = new Map<string, MatchRecord>();
  private profiles = new Map<string, UserProfile>();
  private chain: Promise<unknown> = Promise.resolve();

  transactMatch<T>(id: string, operation: (current: MatchRecord | undefined) => { match?: MatchRecord; credits?: Credit[]; result: T }): Promise<T> {
    const work = this.chain.then(() => {
      const current = this.matches.get(id), next = operation(current && structuredClone(current));
      if (next.match) this.matches.set(id, structuredClone(next.match));
      for (const credit of next.credits ?? []) {
        const profile = this.profiles.get(credit.uid) ?? { updatedAt: credit.at, totals: emptyTotals() };
        for (const key of TOTAL_KEYS) profile.totals[key] += credit.totals[key];
        profile.name = credit.name; profile.updatedAt = credit.at;
        if (credit.avatarId !== undefined) profile.avatarId = credit.avatarId;
        this.profiles.set(credit.uid, profile);
      }
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }

  async matchesFor(uid: string, before: number | undefined, limit: number): Promise<MatchRecord[]> {
    return [...this.matches.values()]
      .filter(match => match.endedAt !== undefined && match.participantUids.includes(uid) && (before === undefined || match.endedAt < before))
      .sort((a, b) => b.endedAt! - a.endedAt!).slice(0, limit).map(match => structuredClone(match));
  }

  async profile(uid: string): Promise<UserProfile | undefined> {
    const profile = this.profiles.get(uid);
    return profile && structuredClone(profile);
  }

  async setUsername(uid: string, username: string, at: number): Promise<void> {
    this.profiles.set(uid, { ...(this.profiles.get(uid) ?? { totals: emptyTotals() }), username, updatedAt: at });
  }
}

/** One gateway owns every connection in a single process, so RoomGateway never needs to route a frame elsewhere. */
export class LocalRoomBus implements RoomBus {
  async start(): Promise<void> {}
  async publish(message: RoutedMessage): Promise<void> {
    throw new Error(`Local room service has a single gateway; cannot route to ${message.destination}`);
  }
  async stop(): Promise<void> {}
}
