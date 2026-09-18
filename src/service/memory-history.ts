import {
  settleHistory,
  settlementUsers,
  type HistoryMutation,
  type RivalCredit,
} from "./history-settlement.js";
import type { LeaderboardEntry, Rivalries } from "../shared/rating.js";
import {
  emptyTotals,
  type HistoryDatabase,
  type MatchRecord,
  type UserProfile,
} from "./history.js";
/** Single-process HistoryDatabase with FirestoreHistoryDatabase's contract; history disappears when the process exits. */
export class MemoryHistoryDatabase implements HistoryDatabase {
  constructor(private now: () => number = Date.now) {}
  private matches = new Map<string, MatchRecord>();
  private profiles = new Map<string, UserProfile>();
  private ratingClaims = new Set<string>();
  private rivalCredits = new Map<string, Map<string, RivalCredit>>();
  private chain: Promise<unknown> = Promise.resolve();

  transactMatch<T>(
    id: string,
    operation: (current: MatchRecord | undefined) => HistoryMutation<T>,
  ): Promise<T> {
    const work = this.chain.then(() => {
      const current = this.matches.get(id),
        next = operation(current && structuredClone(current));
      const profiles = new Map(
        settlementUsers(next).flatMap((uid) => {
          const p = this.profiles.get(uid);
          return p ? [[uid, structuredClone(p)] as const] : [];
        }),
      );
      const scope = next.match?.ratingScope;
      const settled = settleHistory(
        next,
        profiles,
        this.now(),
        !!scope && this.ratingClaims.has(scope),
      );
      if (next.match) this.matches.set(id, structuredClone(next.match));
      for (const [uid, profile] of settled.profiles)
        this.profiles.set(uid, profile);
      if (settled.claimed && scope) this.ratingClaims.add(scope);
      for (const credit of settled.rivals) {
        const rivals =
          this.rivalCredits.get(credit.uid) ?? new Map<string, RivalCredit>();
        const old = rivals.get(credit.opponent);
        rivals.set(credit.opponent, {
          ...credit,
          kills: (old?.kills ?? 0) + credit.kills,
          deaths: (old?.deaths ?? 0) + credit.deaths,
          matches: (old?.matches ?? 0) + 1,
        });
        this.rivalCredits.set(credit.uid, rivals);
      }
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }

  async recentMatches(
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]> {
    return [...this.matches.values()]
      .filter(
        (match) =>
          match.feedAt !== undefined &&
          (before === undefined || match.feedAt < before),
      )
      .sort((a, b) => b.feedAt! - a.feedAt!)
      .slice(0, limit)
      .map((match) => structuredClone(match));
  }

  async matchesFor(
    uid: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]> {
    return [...this.matches.values()]
      .filter(
        (match) =>
          match.endedAt !== undefined &&
          match.participantUids.includes(uid) &&
          (before === undefined || match.endedAt < before),
      )
      .sort((a, b) => b.endedAt! - a.endedAt!)
      .slice(0, limit)
      .map((match) => structuredClone(match));
  }

  async profile(uid: string): Promise<UserProfile | undefined> {
    const profile = this.profiles.get(uid);
    return profile && structuredClone(profile);
  }

  async rank(elo: number): Promise<number> {
    return (
      1 +
      [...this.profiles.values()].filter(
        (p) =>
          p.rating && p.rating.games > 0 && Math.round(p.rating.value) > elo,
      ).length
    );
  }
  async leaderboard(uid?: string): Promise<LeaderboardEntry[]> {
    const entries = [...this.profiles]
      .filter(([, p]) => p.rating && p.rating.games > 0)
      .sort(
        ([a, p], [b, q]) =>
          Math.round(q.rating!.value) - Math.round(p.rating!.value) ||
          a.localeCompare(b),
      )
      .slice(0, 50);
    return Promise.all(
      entries.map(async ([id, p]) => ({
        rank: await this.rank(Math.round(p.rating!.value)),
        name: p.username ?? p.name ?? "Rider",
        ...(p.avatarId ? { avatarId: p.avatarId } : {}),
        elo: Math.round(p.rating!.value),
        games: p.rating!.games,
        rounds: p.rating!.rounds ?? 0,
        ...(id === uid ? { you: true } : {}),
      })),
    );
  }
  async rivals(uid: string): Promise<Rivalries> {
    const list = [...(this.rivalCredits.get(uid)?.values() ?? [])];
    const top = (key: "kills" | "deaths") =>
      list
        .filter((r) => r[key] > 0)
        .sort((a, b) => b[key] - a[key] || a.opponent.localeCompare(b.opponent))
        .slice(0, 3)
        .map(({ name, kills, deaths, matches }) => ({
          name,
          kills,
          deaths,
          matches,
        }));
    return { nemeses: top("deaths"), prey: top("kills") };
  }

  async setUsername(uid: string, username: string, at: number): Promise<void> {
    this.profiles.set(uid, {
      ...(this.profiles.get(uid) ?? { totals: emptyTotals() }),
      username,
      updatedAt: at,
    });
  }
}
