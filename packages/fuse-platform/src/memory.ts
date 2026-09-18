import type { Platform } from "./game.js";
import type { HistoryDatabase } from "./history.js";
import type { LeaderboardEntry, Rivalries } from "./rating.js";
import type { MatchRecord } from "./result.js";
import {
  settleHistory,
  settlementUsers,
  type Account,
  type HistoryMutation,
  type Profile,
  type RivalCredit,
} from "./settlement.js";
import { ratingDocumentId, splitProfile } from "./profile.js";

/**
 * Single-process HistoryDatabase with FirestoreHistoryDatabase's contract; history disappears when the process exits.
 * Like Firestore, the account is one record for every game and each game's standing another, keyed `gameId:uid`.
 */
export class MemoryHistoryDatabase implements HistoryDatabase {
  constructor(
    private platform: Platform,
    private now: () => number = Date.now,
  ) {}
  private matches = new Map<string, MatchRecord>();
  private accounts = new Map<string, Account>();
  private standings = new Map<string, Record<string, unknown>>();
  private ratingClaims = new Set<string>();
  private rivalCredits = new Map<string, Map<string, RivalCredit>>();
  private chain: Promise<unknown> = Promise.resolve();

  private read(gameId: string, uid: string): Profile | undefined {
    const account = this.accounts.get(uid),
      standing = this.standings.get(ratingDocumentId(gameId, uid));
    if (!account && !standing) return;
    return structuredClone({
      ...(account ?? { updatedAt: 0 }),
      ...(standing ?? this.platform.game(gameId).emptyTotals()),
    }) as Profile;
  }

  transactMatch<T>(
    gameId: string,
    id: string,
    operation: (current: MatchRecord | undefined) => HistoryMutation<T>,
  ): Promise<T> {
    const work = this.chain.then(() => {
      const game = this.platform.game(gameId);
      const current = this.matches.get(id),
        next = operation(current && structuredClone(current));
      const profiles = new Map(
        settlementUsers(next).flatMap((uid) => {
          const p = this.read(gameId, uid);
          return p ? [[uid, p] as const] : [];
        }),
      );
      const scope = next.match?.ratingScope;
      const settled = settleHistory(
        game,
        next,
        profiles,
        this.now(),
        !!scope && this.ratingClaims.has(scope),
      );
      if (next.match) this.matches.set(id, structuredClone(next.match));
      for (const [uid, profile] of settled.profiles) {
        const { account, standing } = splitProfile(profile);
        this.accounts.set(uid, account);
        this.standings.set(ratingDocumentId(gameId, uid), standing);
      }
      if (settled.claimed && scope) this.ratingClaims.add(scope);
      for (const credit of settled.rivals) {
        const key = ratingDocumentId(gameId, credit.uid);
        const rivals =
          this.rivalCredits.get(key) ?? new Map<string, RivalCredit>();
        const old = rivals.get(credit.opponent);
        rivals.set(credit.opponent, {
          ...credit,
          kills: (old?.kills ?? 0) + credit.kills,
          deaths: (old?.deaths ?? 0) + credit.deaths,
          matches: (old?.matches ?? 0) + 1,
        });
        this.rivalCredits.set(key, rivals);
      }
      return next.result;
    });
    this.chain = work.catch(() => undefined);
    return work;
  }

  async matchesFor(
    gameId: string,
    uid: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]> {
    return [...this.matches.values()]
      .filter(
        (match) =>
          match.gameId === gameId &&
          match.endedAt !== undefined &&
          match.participantUids.includes(uid) &&
          (before === undefined || match.endedAt < before),
      )
      .sort((a, b) => b.endedAt! - a.endedAt!)
      .slice(0, limit)
      .map((match) => structuredClone(match));
  }

  async profile(gameId: string, uid: string): Promise<Profile | undefined> {
    return this.read(gameId, uid);
  }

  /** Every ranked account of one game, as `[uid, rating value]`. */
  private ranked(gameId: string): [string, Profile][] {
    return [...this.standings.keys()].flatMap((key) => {
      const [game, uid] = [
        key.slice(0, key.indexOf(":")),
        key.slice(key.indexOf(":") + 1),
      ];
      if (game !== gameId) return [];
      const profile = this.read(gameId, uid)!;
      return profile.rating && profile.rating.games > 0
        ? [[uid, profile] as [string, Profile]]
        : [];
    });
  }
  async rank(gameId: string, elo: number): Promise<number> {
    return (
      1 +
      this.ranked(gameId).filter(([, p]) => Math.round(p.rating!.value) > elo)
        .length
    );
  }
  async leaderboard(gameId: string, uid?: string): Promise<LeaderboardEntry[]> {
    const entries = this.ranked(gameId)
      .sort(
        ([a, p], [b, q]) =>
          Math.round(q.rating!.value) - Math.round(p.rating!.value) ||
          a.localeCompare(b),
      )
      .slice(0, 50);
    return Promise.all(
      entries.map(async ([id, p]) => ({
        rank: await this.rank(gameId, Math.round(p.rating!.value)),
        name: p.username ?? p.name ?? this.platform.account.fallbackName,
        ...(p.avatarId ? { avatarId: p.avatarId } : {}),
        elo: Math.round(p.rating!.value),
        games: p.rating!.games,
        rounds: p.rating!.rounds ?? 0,
        ...(id === uid ? { you: true } : {}),
      })),
    );
  }
  async rivals(gameId: string, uid: string): Promise<Rivalries> {
    const list = [
      ...(this.rivalCredits.get(ratingDocumentId(gameId, uid))?.values() ?? []),
    ];
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
    this.accounts.set(uid, {
      ...(this.accounts.get(uid) ?? {}),
      username,
      updatedAt: at,
    });
  }
}
