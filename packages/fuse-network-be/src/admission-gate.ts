import {
  RoomError,
  RoomFullError,
  digest,
  type RoomDatabase,
} from "./room-store.js";

const HOUR_MS = 3_600_000;
const FAILURE_LIMIT = 30;
const MAX_PENDING = 128;
const MAX_PENDING_PER_IP = 4;
const MAX_KEYS = 10_000;
interface Entry {
  hour: number;
  pending: number;
  blocked: boolean;
}

/** Shared hourly failure budget, with bounded local work before any database call. */
export class AdmissionGate {
  private entries = new Map<string, Entry>();
  private pending = 0;
  constructor(
    private database: Pick<RoomDatabase, "allowance">,
    private now: () => number,
  ) {}

  async run<T>(address: string, admit: () => Promise<T>): Promise<T> {
    const key = digest(`admission:${address}`),
      hour = Math.floor(this.now() / HOUR_MS);
    let entry = this.entries.get(key);
    if (entry && entry.hour !== hour && entry.pending === 0) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      if (this.entries.size >= MAX_KEYS) {
        for (const [key, value] of this.entries)
          if (value.pending === 0 && value.hour !== hour)
            this.entries.delete(key);
        if (this.entries.size >= MAX_KEYS)
          throw new RoomError(429, "Admission limit; try later");
      }
      entry = { hour, pending: 0, blocked: false };
      this.entries.set(key, entry);
    }
    if (
      entry.blocked ||
      entry.pending >= MAX_PENDING_PER_IP ||
      this.pending >= MAX_PENDING
    ) {
      if (!entry.blocked && entry.pending === 0) this.entries.delete(key);
      throw new RoomError(429, "Admission limit; try later");
    }
    entry.pending++;
    this.pending++;
    try {
      if (
        !(await this.database.allowance(key, this.now(), FAILURE_LIMIT, false))
      ) {
        entry.blocked = true;
        throw new RoomError(429, "Admission limit; try later");
      }
      try {
        return await admit();
      } catch (error) {
        // Operational failures are not the caller's fault and do not spend their budget. Neither does a full
        // room: the budget prices wrong guesses (a wrong code is a 404), and a full room is a right one. Finding
        // a live code is never charged — an admission that succeeds confirms it just as well.
        if (
          error instanceof RoomError &&
          !(error instanceof RoomFullError) &&
          error.status >= 400 &&
          error.status < 500
        ) {
          if (!(await this.database.allowance(key, this.now(), FAILURE_LIMIT)))
            entry.blocked = true;
        }
        throw error;
      }
    } finally {
      entry.pending--;
      this.pending--;
      if (entry.pending === 0 && !entry.blocked) this.entries.delete(key);
    }
  }
}
