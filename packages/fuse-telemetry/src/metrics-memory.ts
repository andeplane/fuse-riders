import type {
  TelemetryDatabase,
  TelemetryTransaction,
} from "./metrics-database.js";

/** Serialized, rollback-safe transactions; the same interface used by the production adapter. */
export class MemoryTelemetryDatabase implements TelemetryDatabase {
  private documents = new Map<string, object>();
  private pending: Promise<void> = Promise.resolve();
  async transact<T>(
    operation: (tx: TelemetryTransaction) => Promise<T>,
  ): Promise<T> {
    const before = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    const writes = new Map<string, object>();
    try {
      const result = await operation({
        getMany: async (keys) =>
          keys.map((key) => structuredClone(this.documents.get(key))),
        set: (key, value) => {
          writes.set(key, structuredClone(value));
        },
      });
      for (const [key, value] of writes) this.documents.set(key, value);
      return result;
    } finally {
      release();
    }
  }
  async readMany(keys: readonly string[]): Promise<unknown[]> {
    await this.pending;
    return keys.map((key) => structuredClone(this.documents.get(key)));
  }
}
