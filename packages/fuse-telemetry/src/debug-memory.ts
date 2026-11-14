import type {
  DebugDatabase,
  DebugMutation,
  DebugRecord,
  ReportRecord,
} from "./debug-store.js";

export class MemoryDebugDatabase implements DebugDatabase {
  protected records = new Map<string, DebugRecord>();
  private pending: Promise<unknown> = Promise.resolve();
  async transact<T>(
    keys: readonly string[],
    operation: (records: ReadonlyMap<string, DebugRecord>) => DebugMutation<T>,
  ): Promise<T> {
    const run = this.pending.then(async () => {
      const current = new Map<string, DebugRecord>();
      for (const key of keys) {
        const value = this.records.get(key);
        if (value) current.set(key, structuredClone(value));
      }
      const mutation = operation(current);
      const next = new Map(this.records);
      for (const [key, value] of mutation.writes ?? []) {
        if (!keys.includes(key)) throw new Error("Undeclared transaction key");
        next.set(key, structuredClone(value));
      }
      await this.persist(next);
      this.records = next;
      return mutation.result;
    });
    this.pending = run.catch(() => {
      /* A rejected write must not block subsequent transactions. */
    });
    return run;
  }
  protected async persist(
    _next: ReadonlyMap<string, DebugRecord>,
  ): Promise<void> {
    /* In-memory adapter intentionally has no disk side effect. */
  }
  async read(key: string): Promise<DebugRecord | undefined> {
    await this.pending;
    return structuredClone(this.records.get(key));
  }
  async list(
    kind: "recording" | "report" | "segment",
    prefix: string,
    after: string | undefined,
    limit: number,
    recordingId?: string,
  ) {
    await this.pending;
    return [...this.records]
      .filter(
        ([key, value]) =>
          value.kind === kind &&
          key.startsWith(prefix) &&
          (!after || key > after) &&
          (!recordingId ||
            (value.kind === "report" && value.recordingId === recordingId)),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, limit)
      .map(([key, value]) => ({ key, value: structuredClone(value) }));
  }
  async reportsInRange(
    recordingId: string,
    startMs: number,
    endMs: number,
    now: number,
    limit: number,
  ) {
    await this.pending;
    return [...this.records.values()]
      .filter(
        (value): value is ReportRecord =>
          value.kind === "report" &&
          value.recordingId === recordingId &&
          value.ready &&
          value.expiresAt > now &&
          value.offsetMs !== undefined &&
          value.offsetMs >= startMs &&
          value.offsetMs <= endMs,
      )
      .sort(
        (a, b) =>
          a.offsetMs! - b.offsetMs! ||
          a.expiresAt - b.expiresAt ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, limit)
      .map((value) => structuredClone(value));
  }
}
import type { PrivateObjectStorage, StoredObject } from "./storage.js";
import { createHash } from "node:crypto";
export class MemoryPrivateObjectStorage implements PrivateObjectStorage {
  private objects = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, mime: string) {
    const generation = BigInt(
      `0x${createHash("sha256").update(bytes).digest("hex")}`,
    ).toString();
    const current = this.objects.get(key);
    if (current && (current.generation !== generation || current.mime !== mime))
      throw new Error("Immutable object conflict");
    this.objects.set(key, { generation, bytes: new Uint8Array(bytes), mime });
    return { generation };
  }
  async get(key: string, generation?: string) {
    const value = this.objects.get(key);
    return value && (!generation || value.generation === generation)
      ? structuredClone(value)
      : undefined;
  }
}
