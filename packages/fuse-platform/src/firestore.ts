import {
  FieldValue,
  Firestore,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
} from "@google-cloud/firestore";
import { userDocumentGame, type Platform } from "./game.js";
import type { HistoryDatabase } from "./history.js";
import { validUid } from "./identity.js";
import {
  parseProfile,
  rankFields,
  ratingDocumentId,
  splitProfile,
} from "./profile.js";
import type { LeaderboardEntry, Rival, Rivalries } from "./rating.js";
import { parseMatchRecord, type MatchRecord } from "./result.js";
import {
  ACCOUNT_KEYS,
  settleHistory,
  settlementUsers,
  type HistoryMutation,
  type Profile,
} from "./settlement.js";

/**
 * Match history, accounts and ratings of every game. Only this service reaches these collections: firestore.rules
 * denies every browser.
 *
 * - `${prefix}-matches`: every game's match records, each with its `gameId`, which history queries filter on. A
 *   record without one (written before games) still parses as the legacy game's, but no query finds it: production's
 *   were backfilled (scripts/backfill-match-game-id.ts). A match that still has an `expiresAt` carries `cleanupAt`
 *   for the TTL policy; a match an account owns has neither.
 * - `${prefix}-users`: one document per account, shared by every game (username, name, avatar), plus the legacy
 *   game's rating and totals exactly as before games existed, and its `rivals` subcollection.
 * - `${prefix}-ratings`: every other game's rating and totals, one document per `gameId:uid`, with its own `rivals`.
 */
export class FirestoreHistoryDatabase implements HistoryDatabase {
  constructor(
    private platform: Platform,
    private firestore: Firestore,
    private prefix: string,
  ) {}
  private matches() {
    return this.firestore.collection(`${this.prefix}-matches`);
  }
  private users() {
    return this.firestore.collection(`${this.prefix}-users`);
  }
  private ratings() {
    return this.firestore.collection(`${this.prefix}-ratings`);
  }
  /** Where `uid`'s rating, totals and rivals in `gameId` live. */
  private standing(gameId: string, uid: string): DocumentReference {
    return userDocumentGame(gameId)
      ? this.users().doc(uid)
      : this.ratings().doc(ratingDocumentId(gameId, uid));
  }
  private parse(value: unknown): MatchRecord | undefined {
    if (value === undefined) return;
    const match = parseMatchRecord(this.platform, value);
    if (!match) throw new Error("Stored match schema is incompatible");
    return match;
  }
  async transactMatch<T>(
    gameId: string,
    id: string,
    operation: (current: MatchRecord | undefined) => HistoryMutation<T>,
  ): Promise<T> {
    const game = this.platform.game(gameId),
      inline = userDocumentGame(gameId);
    const ref = this.matches().doc(id);
    return this.firestore.runTransaction(
      async (transaction) => {
        const next = operation(this.parse((await transaction.get(ref)).data()));
        const users = settlementUsers(next),
          profiles = new Map<string, Profile>();
        const accounts = users.length
          ? await transaction.getAll(
              ...users.map((uid) => this.users().doc(uid)),
            )
          : [];
        const standings: DocumentSnapshot[] =
          users.length && !inline
            ? await transaction.getAll(
                ...users.map((uid) => this.standing(gameId, uid)),
              )
            : [];
        for (let i = 0; i < users.length; i++) {
          const profile = parseProfile(
            this.platform,
            gameId,
            accounts[i]!.data(),
            standings[i]?.data(),
          );
          if (profile) profiles.set(users[i]!, profile);
        }
        const claim = next.match?.ratingScope
          ? this.firestore
              .collection(`${this.prefix}-rating-claims`)
              .doc(next.match.ratingScope)
          : undefined;
        const claimed = claim ? (await transaction.get(claim)).exists : false;
        const settled = settleHistory(
          game,
          next,
          profiles,
          Date.now(),
          claimed,
        );
        if (next.match)
          transaction.set(ref, {
            ...next.match,
            ...(next.match.expiresAt === undefined
              ? {}
              : { cleanupAt: Timestamp.fromMillis(next.match.expiresAt) }),
          });
        for (const [uid, profile] of settled.profiles) {
          const { account, standing } = splitProfile(profile);
          if (inline)
            // The legacy game's standing is the user document, written whole as it always was.
            transaction.set(this.users().doc(uid), {
              ...account,
              ...standing,
              ...rankFields(profile),
            });
          else {
            const before = profiles.get(uid);
            // Merged, never replaced: the user document also holds the legacy game's standing.
            if (
              !before ||
              ACCOUNT_KEYS.some((key) => before[key] !== account[key])
            )
              transaction.set(this.users().doc(uid), account, { merge: true });
            transaction.set(this.standing(gameId, uid), {
              gameId,
              uid,
              ...standing,
              ...rankFields(profile),
            });
          }
        }
        if (settled.claimed && claim) transaction.set(claim, { match: id });
        for (const credit of settled.rivals)
          transaction.set(
            this.standing(gameId, credit.uid)
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
  async recentMatches(
    gameId: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]> {
    // `(gameId, feedAt desc)` on the matches collection; firestore.indexes.json carries it.
    let query = this.matches().where("gameId", "==", gameId);
    // Strictly older, exactly as MemoryHistoryDatabase pages: two games stamped in the same millisecond on a page
    // boundary can cost one of them its listing (docs/design/PLAYER-STATS.md).
    if (before !== undefined) query = query.where("feedAt", "<", before);
    const docs = (await query.orderBy("feedAt", "desc").limit(limit).get())
      .docs;
    // One unreadable record must not hide the rest of the page.
    return docs.flatMap((doc) => {
      const match = parseMatchRecord(this.platform, doc.data());
      return match?.gameId === gameId ? [match] : [];
    });
  }
  async matchesFor(
    gameId: string,
    uid: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]> {
    // Every game's records carry their gameId: records from before games were backfilled (docs/online/GCP-DEPLOY.md).
    let query = this.matches()
      .where("gameId", "==", gameId)
      .where("participantUids", "array-contains", uid);
    // Strictly older, exactly as MemoryHistoryDatabase pages.
    if (before !== undefined) query = query.where("endedAt", "<", before);
    const docs = (await query.orderBy("endedAt", "desc").limit(limit).get())
      .docs;
    // One unreadable record must not hide the rest of the page.
    return docs.flatMap((doc) => {
      const match = parseMatchRecord(this.platform, doc.data());
      return match?.gameId === gameId ? [match] : [];
    });
  }
  async profile(gameId: string, uid: string): Promise<Profile | undefined> {
    const [user, standing] = await Promise.all([
      this.users().doc(uid).get(),
      userDocumentGame(gameId) ? undefined : this.standing(gameId, uid).get(),
    ]);
    return parseProfile(this.platform, gameId, user.data(), standing?.data());
  }
  private ranked(gameId: string) {
    return userDocumentGame(gameId)
      ? this.users().where("ranked", "==", true)
      : this.ratings()
          .where("gameId", "==", gameId)
          .where("ranked", "==", true);
  }
  async rank(gameId: string, elo: number): Promise<number> {
    return (
      1 +
      (await this.ranked(gameId).where("elo", ">", elo).count().get()).data()
        .count
    );
  }
  async leaderboard(gameId: string, uid?: string): Promise<LeaderboardEntry[]> {
    const docs = (
      await this.ranked(gameId).orderBy("elo", "desc").limit(50).get()
    ).docs;
    let rows: [string, Profile | undefined][];
    if (userDocumentGame(gameId))
      rows = docs.map((doc) => [
        doc.id,
        parseProfile(this.platform, gameId, doc.data()),
      ]);
    else {
      const owners = docs.map((doc) => doc.id.slice(gameId.length + 1));
      const valid = owners.filter(validUid);
      // The name and avatar are the shared account's, read in one batch.
      const accounts = valid.length
        ? await this.firestore.getAll(
            ...valid.map((owner) => this.users().doc(owner)),
          )
        : [];
      const account = new Map(
        accounts.map((snapshot) => [snapshot.id, snapshot.data()]),
      );
      rows = docs.flatMap((doc, index) => {
        const owner = owners[index]!;
        return validUid(owner)
          ? [
              [
                owner,
                parseProfile(
                  this.platform,
                  gameId,
                  account.get(owner),
                  doc.data(),
                ),
              ] as [string, Profile | undefined],
            ]
          : [];
      });
    }
    let rank = 0,
      previous: number | undefined;
    return rows.flatMap(([owner, profile], index) => {
      if (!profile?.rating?.games) return [];
      const elo = Math.round(profile.rating.value);
      if (elo !== previous) rank = index + 1;
      previous = elo;
      return [
        {
          rank,
          name:
            profile.username ??
            profile.name ??
            this.platform.account.fallbackName,
          ...(profile.avatarId ? { avatarId: profile.avatarId } : {}),
          elo,
          games: profile.rating.games,
          rounds: profile.rating.rounds ?? 0,
          ...(owner === uid ? { you: true } : {}),
        },
      ];
    });
  }
  async rivals(gameId: string, uid: string): Promise<Rivalries> {
    const top = async (key: "kills" | "deaths"): Promise<Rival[]> =>
      (
        await this.standing(gameId, uid)
          .collection("rivals")
          .where(key, ">", 0)
          .orderBy(key, "desc")
          .limit(3)
          .get()
      ).docs.map((doc) => {
        const data = doc.data();
        if (
          !this.platform.account.validName(data.name) ||
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
