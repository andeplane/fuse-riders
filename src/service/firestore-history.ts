import { FieldValue, Firestore, Timestamp } from "@google-cloud/firestore";
import {
  settleHistory,
  settlementUsers,
  type HistoryMutation,
} from "./history-settlement.js";
import type { LeaderboardEntry, Rival, Rivalries } from "../shared/rating.js";
import {
  parseProfile,
  parseMatchRecord,
  type HistoryDatabase,
  type MatchRecord,
  type UserProfile,
} from "./history.js";
import { validRiderName } from "../engine/rider-name.js";
/**
 * Match history and account totals. Only this service reaches these collections: firestore.rules denies every browser.
 * A match that still has an `expiresAt` carries `cleanupAt` for the TTL policy; a match an account owns has neither.
 */
export class FirestoreHistoryDatabase implements HistoryDatabase {
  constructor(
    private firestore: Firestore,
    private prefix: string,
  ) {}
  private matches() {
    return this.firestore.collection(`${this.prefix}-matches`);
  }
  private users() {
    return this.firestore.collection(`${this.prefix}-users`);
  }
  private parse(value: unknown): MatchRecord | undefined {
    if (value === undefined) return;
    const match = parseMatchRecord(value);
    if (!match) throw new Error("Stored match schema is incompatible");
    return match;
  }
  async transactMatch<T>(
    id: string,
    operation: (current: MatchRecord | undefined) => HistoryMutation<T>,
  ): Promise<T> {
    const ref = this.matches().doc(id);
    return this.firestore.runTransaction(
      async (transaction) => {
        const next = operation(this.parse((await transaction.get(ref)).data()));
        const users = settlementUsers(next),
          profiles = new Map<string, UserProfile>();
        const snapshots = users.length
          ? await transaction.getAll(
              ...users.map((uid) => this.users().doc(uid)),
            )
          : [];
        for (let i = 0; i < users.length; i++) {
          const profile = parseProfile(snapshots[i]!.data());
          if (profile) profiles.set(users[i]!, profile);
        }
        const claim = next.match?.ratingScope
          ? this.firestore
              .collection(`${this.prefix}-rating-claims`)
              .doc(next.match.ratingScope)
          : undefined;
        const claimed = claim ? (await transaction.get(claim)).exists : false;
        const settled = settleHistory(next, profiles, Date.now(), claimed);
        if (next.match)
          transaction.set(ref, {
            ...next.match,
            ...(next.match.expiresAt === undefined
              ? {}
              : { cleanupAt: Timestamp.fromMillis(next.match.expiresAt) }),
          });
        for (const [uid, profile] of settled.profiles)
          transaction.set(this.users().doc(uid), {
            ...profile,
            ...(profile.rating
              ? {
                  ranked: profile.rating.games > 0,
                  elo: Math.round(profile.rating.value),
                }
              : {}),
          });
        if (settled.claimed && claim) transaction.set(claim, { match: id });
        for (const credit of settled.rivals)
          transaction.set(
            this.users()
              .doc(credit.uid)
              .collection("rivals")
              .doc(credit.opponent),
            {
              name: credit.name,
              kills: FieldValue.increment(credit.kills),
              deaths: FieldValue.increment(credit.deaths),
              matches: FieldValue.increment(credit.matches),
            },
            { merge: true },
          );
        return next.result;
      },
      { maxAttempts: 5 },
    );
  }
  async matchesFor(
    uid: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]> {
    let query = this.matches().where("participantUids", "array-contains", uid);
    // Strictly older, exactly as MemoryHistoryDatabase pages.
    if (before !== undefined) query = query.where("endedAt", "<", before);
    query = query.orderBy("endedAt", "desc");
    // One unreadable record must not hide the rest of an account's history.
    return (await query.limit(limit).get()).docs.flatMap((doc) => {
      const match = parseMatchRecord(doc.data());
      return match ? [match] : [];
    });
  }
  async profile(uid: string): Promise<UserProfile | undefined> {
    return parseProfile((await this.users().doc(uid).get()).data());
  }
  async rank(elo: number): Promise<number> {
    return (
      1 +
      (
        await this.users()
          .where("ranked", "==", true)
          .where("elo", ">", elo)
          .count()
          .get()
      ).data().count
    );
  }
  async leaderboard(uid?: string): Promise<LeaderboardEntry[]> {
    const docs = (
      await this.users()
        .where("ranked", "==", true)
        .orderBy("elo", "desc")
        .limit(50)
        .get()
    ).docs;
    let rank = 0,
      previous: number | undefined;
    return docs.flatMap((doc, index) => {
      const profile = parseProfile(doc.data());
      if (!profile?.rating?.games) return [];
      const elo = Math.round(profile.rating.value);
      if (elo !== previous) rank = index + 1;
      previous = elo;
      return [
        {
          rank,
          name: profile.username ?? profile.name ?? "Rider",
          ...(profile.avatarId ? { avatarId: profile.avatarId } : {}),
          elo,
          games: profile.rating.games,
          rounds: profile.rating.rounds ?? 0,
          ...(doc.id === uid ? { you: true } : {}),
        },
      ];
    });
  }
  async rivals(uid: string): Promise<Rivalries> {
    const top = async (key: "kills" | "deaths"): Promise<Rival[]> =>
      (
        await this.users()
          .doc(uid)
          .collection("rivals")
          .where(key, ">", 0)
          .orderBy(key, "desc")
          .limit(3)
          .get()
      ).docs.map((doc) => {
        const data = doc.data();
        if (
          !validRiderName(data.name) ||
          !["kills", "deaths", "matches"].every(
            (k) => Number.isSafeInteger(data[k]) && data[k] >= 0,
          )
        )
          throw new Error("Stored rivalry is incompatible");
        return {
          name: data.name,
          kills: data.kills as number,
          deaths: data.deaths as number,
          matches: data.matches as number,
        };
      });
    const [nemeses, prey] = await Promise.all([top("deaths"), top("kills")]);
    return { nemeses, prey };
  }
  async setUsername(uid: string, username: string, at: number): Promise<void> {
    await this.users()
      .doc(uid)
      .set({ username, updatedAt: at }, { merge: true });
  }
}
