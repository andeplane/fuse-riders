import { mkdir, readFile, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { MemoryDebugDatabase } from "./debug-memory.js";
import { storedDebugRecord, type DebugRecord } from "./debug-store.js";
import type { PrivateObjectStorage, StoredObject } from "./storage.js";

/** Single-process durable local adapter. Never use this in multi-instance production. */
export class FileDebugDatabase extends MemoryDebugDatabase {
  private constructor(private directory: string) {
    super();
  }
  static async open(directory: string): Promise<FileDebugDatabase> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const db = new FileDebugDatabase(directory);
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(directory, "metadata.json"), "utf8"),
      );
      if (!Array.isArray(raw)) throw new Error("Invalid debug file");
      for (const pair of raw) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string")
          throw new Error("Invalid debug file");
        const value = storedDebugRecord(pair[1]);
        if (value) db.records.set(pair[0], value);
      }
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    return db;
  }
  protected override async persist(next: ReadonlyMap<string, DebugRecord>) {
    const temporary = join(this.directory, `${randomUUID()}.tmp`),
      handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify([...next]));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, join(this.directory, "metadata.json"));
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
export class FilePrivateObjectStorage implements PrivateObjectStorage {
  constructor(private directory: string) {}
  private path(key: string) {
    return join(
      this.directory,
      createHash("sha256").update(key).digest("hex") + ".json",
    );
  }
  async put(key: string, bytes: Uint8Array, mime: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const hash = createHash("sha256").update(bytes).digest("hex"),
      generation = BigInt(`0x${hash}`).toString();
    const current = await this.get(key);
    if (current) {
      if (current.generation !== generation || current.mime !== mime)
        throw new Error("Immutable object conflict");
      return { generation };
    }
    const temporary = join(this.directory, `${randomUUID()}.tmp`),
      handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          generation,
          mime,
          bytes: Buffer.from(bytes).toString("base64"),
        }),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    // The local service owns this directory; writes are serialized by the request's immutable metadata reservation.
    await rename(temporary, this.path(key));
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return { generation };
  }
  async get(
    key: string,
    generation?: string,
  ): Promise<StoredObject | undefined> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.path(key), "utf8"));
      if (
        !raw ||
        typeof raw !== "object" ||
        !("generation" in raw) ||
        typeof raw.generation !== "string" ||
        !("mime" in raw) ||
        typeof raw.mime !== "string" ||
        !("bytes" in raw) ||
        typeof raw.bytes !== "string"
      )
        throw new Error("Invalid private object");
      return !generation || generation === raw.generation
        ? {
            generation: raw.generation,
            mime: raw.mime,
            bytes: Buffer.from(raw.bytes, "base64"),
          }
        : undefined;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return;
      throw error;
    }
  }
}
