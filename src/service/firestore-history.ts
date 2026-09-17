import { FieldValue, Firestore, Timestamp } from "@google-cloud/firestore";
import {
  TOTAL_KEYS,
  parseTotals,
  parseMatchRecord,
  type Credit,
  type HistoryDatabase,
  type MatchRecord,
  type UserProfile,
} from "./history.js";
import { isAvatarId } from "../shared/avatars.js";
import { validRiderName } from "../shared/rider-name.js";

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
    operation: (current: MatchRecord | undefined) => {
      match?: MatchRecord;
      credits?: Credit[];
      result: T;
    },
  ): Promise<T> {
    const ref = this.matches().doc(id);
    return this.firestore.runTransaction(
      async (transaction) => {
        const next = operation(this.parse((await transaction.get(ref)).data()));
        // A whole-document set, so a confirmed account match drops the cleanupAt its pending self carried.
        if (next.match)
          transaction.set(ref, {
            ...next.match,
            ...(next.match.expiresAt === undefined
              ? {}
              : { cleanupAt: Timestamp.fromMillis(next.match.expiresAt) }),
          });
        // Increments need no read, so crediting five riders costs five writes and cannot conflict with another match.
        for (const credit of next.credits ?? [])
          transaction.set(
            this.users().doc(credit.uid),
            {
              name: credit.name,
              ...(credit.avatarId === undefined
                ? {}
                : { avatarId: credit.avatarId }),
              updatedAt: credit.at,
              totals: Object.fromEntries(
                TOTAL_KEYS.map((key) => [
                  key,
                  FieldValue.increment(credit.totals[key]),
                ]),
              ),
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
    const data = (await this.users().doc(uid).get()).data();
    if (!data) return;
    const totals = parseTotals(data.totals);
    return {
      ...(validRiderName(data.username) ? { username: data.username } : {}),
      ...(validRiderName(data.name) ? { name: data.name } : {}),
      ...(isAvatarId(data.avatarId) ? { avatarId: data.avatarId } : {}),
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
      totals,
    };
  }
  async setUsername(uid: string, username: string, at: number): Promise<void> {
    await this.users()
      .doc(uid)
      .set({ username, updatedAt: at }, { merge: true });
  }
}
