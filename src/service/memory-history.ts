import { TOTAL_KEYS, emptyTotals, type Credit, type HistoryDatabase, type MatchRecord, type UserProfile } from './history.js';

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

