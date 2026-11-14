import assert from "node:assert/strict";
import test from "node:test";
import {
  Firestore,
  Timestamp,
  type DocumentReference,
} from "@google-cloud/firestore";
import {
  FirestoreTelemetryDatabase,
  type TelemetryFirestore,
  type TelemetryFirestoreTransaction,
} from "../src/metrics-firestore.js";

/** SDK references need no network; every read/transaction is provided by this typed fake. */
class FakeFirestore implements TelemetryFirestore {
  private sdk = new Firestore({ projectId: "telemetry-test" });
  documents = new Map<string, Record<string, unknown>>();
  batches: number[] = [];
  attempts = 0;
  retryOnce = false;
  doc(path: string): DocumentReference {
    return this.sdk.doc(path);
  }
  async getAll(...refs: DocumentReference[]) {
    this.batches.push(refs.length);
    return refs.map((ref) => ({ data: () => this.documents.get(ref.path) }));
  }
  async runTransaction<T>(
    operation: (tx: TelemetryFirestoreTransaction) => Promise<T>,
    options: { maxAttempts: number },
  ): Promise<T> {
    assert.equal(options.maxAttempts, 5);
    const attempt = async () => {
      this.attempts++;
      const writes = new Map<string, Record<string, unknown>>();
      const result = await operation({
        getAll: (...refs) => this.getAll(...refs),
        set: (ref, data) => writes.set(ref.path, data),
      });
      return { result, writes };
    };
    if (this.retryOnce) {
      this.retryOnce = false;
      await attempt();
    }
    const { result, writes } = await attempt();
    for (const [key, value] of writes) this.documents.set(key, value);
    return result;
  }
}
test("Firestore adapter namespaces documents, preserves result order, adds timestamp TTL and supports retries", async () => {
  const firestore = new FakeFirestore(),
    db = new FirestoreTelemetryDatabase(firestore, "fuse-test");
  firestore.retryOnce = true;
  const result = await db.transact(async (tx) => {
    assert.deepEqual(await tx.getMany([]), []);
    assert.deepEqual(await tx.getMany(["telemetry-events/one"]), [undefined]);
    tx.set("telemetry-events/one", { expiresAt: 1000, value: 1 });
    tx.set("telemetry-events/two", { value: 2 });
    return "stored";
  });
  assert.equal(result, "stored");
  assert.equal(firestore.attempts, 2);
  const values = await db.readMany([
    "telemetry-events/two",
    "telemetry-events/one",
    "telemetry-events/missing",
  ]);
  assert.deepEqual(values[0], { value: 2 });
  const one = values[1];
  assert.ok(
    one &&
      typeof one === "object" &&
      "cleanupAt" in one &&
      one.cleanupAt instanceof Timestamp,
  );
  assert.equal(one.cleanupAt.toMillis(), 1000);
  assert.equal(values[2], undefined);
  assert.equal(firestore.documents.has("fuse-test-telemetry-events/one"), true);
  assert.deepEqual(await db.readMany([]), []);
  firestore.batches.length = 0;
  await db.readMany(
    Array.from({ length: 501 }, (_, i) => `telemetry-events/key-${i}`),
  );
  assert.deepEqual(firestore.batches, [250, 250, 1]);
});
test("Firestore adapter rejects namespace escape and discards failed transaction writes", async () => {
  const firestore = new FakeFirestore(),
    db = new FirestoreTelemetryDatabase(firestore, "fuse-test");
  assert.throws(() => new FirestoreTelemetryDatabase(firestore, "bad/prefix"));
  for (const key of [
    "users/victim",
    "telemetry-events/a/b",
    "telemetry-events/../users",
    "telemetry-events/",
  ]) {
    await assert.rejects(db.readMany([key]), /Invalid telemetry document key/);
    await assert.rejects(
      db.transact(async (tx) => {
        tx.set(key, {});
      }),
      /Invalid telemetry document key/,
    );
  }
  await assert.rejects(
    db.transact(async (tx) => {
      tx.set("telemetry-events/failed", { value: 1 });
      throw new Error("rejected");
    }),
  );
  assert.deepEqual(await db.readMany(["telemetry-events/failed"]), [undefined]);
});
