import { Timestamp, type DocumentReference } from "@google-cloud/firestore";
import type {
  TelemetryDatabase,
  TelemetryTransaction,
} from "./metrics-database.js";

/** Narrow SDK boundary lets tests model retries/rejections through the same public capability. */
export interface TelemetryFirestoreTransaction {
  getAll(...refs: DocumentReference[]): Promise<readonly { data(): unknown }[]>;
  set(ref: DocumentReference, data: Record<string, unknown>): unknown;
}
export interface TelemetryFirestore {
  doc(path: string): DocumentReference;
  getAll(...refs: DocumentReference[]): Promise<readonly { data(): unknown }[]>;
  runTransaction<T>(
    operation: (tx: TelemetryFirestoreTransaction) => Promise<T>,
    options: { maxAttempts: number },
  ): Promise<T>;
}

/** Only the service account reaches these collections; browser Firestore rules remain deny-all. */
export class FirestoreTelemetryDatabase implements TelemetryDatabase {
  constructor(
    private firestore: TelemetryFirestore,
    private prefix: string,
  ) {
    if (!/^[a-z][a-z0-9-]{1,50}$/.test(prefix))
      throw new Error("Invalid telemetry prefix");
  }
  private ref(key: string) {
    if (!/^telemetry-[a-z-]+\/[A-Za-z0-9_-]{1,200}$/.test(key))
      throw new Error("Invalid telemetry document key");
    return this.firestore.doc(`${this.prefix}-${key}`);
  }
  async transact<T>(
    operation: (tx: TelemetryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.firestore.runTransaction(
      async (transaction) =>
        operation({
          getMany: async (keys) =>
            keys.length
              ? (
                  await transaction.getAll(...keys.map((key) => this.ref(key)))
                ).map((snapshot) => snapshot.data())
              : [],
          set: (key, value) => {
            const data: Record<string, unknown> = { ...value };
            if (typeof data.expiresAt === "number")
              data.cleanupAt = Timestamp.fromMillis(data.expiresAt);
            transaction.set(this.ref(key), data);
          },
        }),
      { maxAttempts: 5 },
    );
  }
  async readMany(keys: readonly string[]): Promise<unknown[]> {
    const result: unknown[] = [];
    // Keep each getAll request and response comfortably bounded.
    for (let offset = 0; offset < keys.length; offset += 250)
      result.push(
        ...(
          await this.firestore.getAll(
            ...keys.slice(offset, offset + 250).map((key) => this.ref(key)),
          )
        ).map((snapshot) => snapshot.data()),
      );
    return result;
  }
}
