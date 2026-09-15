import type { RoomBus, RoutedMessage } from './room-bus.js';
import type { RoomDatabase, RoomRecord } from './room-store.js';

const HOUR_MS = 3_600_000;
const MAX_ALLOWANCE_KEYS = 10_000;

/** Single-process RoomDatabase for the local room service and tests; production uses Firestore with the same contract. */
export class MemoryRoomDatabase implements RoomDatabase {
  private rooms = new Map<string, RoomRecord>();
  private listeners = new Map<string, Set<(room: RoomRecord | undefined) => void>>();
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
        for (const listener of [...(this.listeners.get(code) ?? [])]) listener(structuredClone(next.room));
      }
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }

  watch(code: string, listener: (room: RoomRecord | undefined) => void): () => void {
    const listeners = this.listeners.get(code) ?? new Set();
    listeners.add(listener);
    this.listeners.set(code, listeners);
    return () => {
      listeners.delete(listener);
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

/** One gateway owns every connection in a single process, so RoomGateway never needs to route a frame elsewhere. */
export class LocalRoomBus implements RoomBus {
  async start(): Promise<void> {}
  async publish(message: RoutedMessage): Promise<void> {
    throw new Error(`Local room service has a single gateway; cannot route to ${message.destination}`);
  }
  async stop(): Promise<void> {}
}
