import { FieldPath, Timestamp, type Firestore } from "@google-cloud/firestore";
import {
  storedDebugRecord,
  type DebugDatabase,
  type DebugMutation,
  type DebugRecord,
} from "./debug-store.js";

/** Separate documents keep transcript growth outside Firestore's per-document size limit. */
export class FirestoreDebugDatabase implements DebugDatabase {
  constructor(
    private firestore: Firestore,
    private prefix: string,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(prefix))
      throw new Error("Invalid telemetry prefix");
  }
  private ref(key: string) {
    const colon = key.indexOf(":"),
      kind = key.slice(0, colon);
    if (
      !["recording", "report", "segment", "limit"].includes(kind) ||
      !/^[\w:-]+$/.test(key)
    )
      throw new Error("Invalid debug key");
    return this.firestore
      .collection(
        `${this.prefix}-telemetry-${kind === "segment" ? "recording-segments" : kind === "limit" ? "limits" : `${kind}s`}`,
      )
      .doc(key);
  }
  async transact<T>(
    keys: readonly string[],
    operation: (records: ReadonlyMap<string, DebugRecord>) => DebugMutation<T>,
  ): Promise<T> {
    return this.firestore.runTransaction(
      async (transaction) => {
        const docs = keys.length
            ? await transaction.getAll(...keys.map((key) => this.ref(key)))
            : [],
          records = new Map<string, DebugRecord>();
        docs.forEach((doc, index) => {
          const value = storedDebugRecord(doc.data());
          if (value) records.set(keys[index]!, value);
        });
        const mutation = operation(records);
        for (const [key, value] of mutation.writes ?? []) {
          if (!keys.includes(key))
            throw new Error("Undeclared transaction key");
          transaction.set(this.ref(key), {
            ...value,
            cleanupAt: Timestamp.fromMillis(value.expiresAt),
          });
        }
        return mutation.result;
      },
      { maxAttempts: 5 },
    );
  }
  async read(key: string) {
    return storedDebugRecord((await this.ref(key).get()).data());
  }
  async list(
    kind: "recording" | "report" | "segment",
    prefix: string,
    after: string | undefined,
    limit: number,
    recordingId?: string,
  ) {
    let query = this.ref(`${kind}:placeholder`)
      .parent.orderBy(FieldPath.documentId())
      .startAt(prefix)
      .endAt(`${prefix}\uf8ff`);
    if (after) query = query.startAfter(after);
    if (recordingId) query = query.where("recordingId", "==", recordingId);
    const rows = (await query.limit(limit).get()).docs;
    return rows.flatMap((doc) => {
      const value = storedDebugRecord(doc.data());
      return value ? [{ key: doc.id, value }] : [];
    });
  }
}
