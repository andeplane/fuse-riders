import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { FieldPath, Timestamp, type Firestore } from "@google-cloud/firestore";
import {
  validateActionState,
  validateActionToken,
  type ActionAgentToken,
  type ActionDatabase,
  type ActionState,
} from "./action-store.js";

export class MemoryActionDatabase implements ActionDatabase {
  protected states = new Map<string, ActionState>();
  protected tokens = new Map<string, ActionAgentToken>();
  private pending: Promise<unknown> = Promise.resolve();
  protected async persist(
    _states: Map<string, ActionState>,
    _tokens: Map<string, ActionAgentToken>,
  ): Promise<void> {
    /* Memory adapter deliberately has no persistence side effect. */
  }
  protected exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.pending.then(operation);
    this.pending = job.catch(() => {
      /* Failed mutations must not poison the transaction queue. */
    });
    return job;
  }
  transact<T>(
    id: string,
    update: (current: ActionState | undefined) => {
      state?: ActionState;
      result: T;
    },
  ): Promise<T> {
    return this.exclusive(async () => {
      const result = update(validateActionState(this.states.get(id)));
      if (result.state) {
        const states = new Map(this.states);
        states.set(id, validateActionState(result.state)!);
        await this.persist(states, this.tokens);
        this.states = states;
      }
      return result.result;
    });
  }
  read(id: string) {
    return this.exclusive(async () => validateActionState(this.states.get(id)));
  }
  list(after: string | undefined, limit: number) {
    return this.exclusive(async () =>
      [...this.states]
        .filter(([id]) => !after || id > after)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, limit)
        .map(([, state]) => validateActionState(state)!),
    );
  }
  putToken(token: ActionAgentToken) {
    return this.exclusive(async () => {
      const tokens = new Map(this.tokens);
      if (tokens.has(token.id)) throw new Error("Agent token collision");
      tokens.set(token.id, validateActionToken(token)!);
      await this.persist(this.states, tokens);
      this.tokens = tokens;
    });
  }
  readToken(id: string) {
    return this.exclusive(async () => validateActionToken(this.tokens.get(id)));
  }
  revokeToken(id: string, ownerId: string) {
    return this.exclusive(async () => {
      const token = this.tokens.get(id);
      if (!token || token.ownerId !== ownerId) return false;
      const tokens = new Map(this.tokens);
      tokens.set(id, { ...token, revoked: true });
      await this.persist(this.states, tokens);
      this.tokens = tokens;
      return true;
    });
  }
}
/** Local development: one service process owns this file; atomic rename acknowledges durable writes. */
export class FileActionDatabase extends MemoryActionDatabase {
  private constructor(private path: string) {
    super();
  }
  static async open(path: string): Promise<FileActionDatabase> {
    const database = new FileActionDatabase(path);
    try {
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        !data ||
        typeof data !== "object" ||
        !("states" in data) ||
        !("tokens" in data) ||
        !Array.isArray(data.states) ||
        !Array.isArray(data.tokens)
      )
        throw new Error("Invalid action database file");
      for (const raw of data.states) {
        const state = validateActionState(raw)!;
        database.states.set(state.recordingId, state);
      }
      for (const raw of data.tokens) {
        const token = validateActionToken(raw)!;
        database.tokens.set(token.id, token);
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    return database;
  }
  protected override async persist(
    states: Map<string, ActionState>,
    tokens: Map<string, ActionAgentToken>,
  ) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        states: [...states.values()],
        tokens: [...tokens.values()],
      }),
      { mode: 0o600, flush: true },
    );
    await rename(temporary, this.path);
  }
}
export class FirestoreActionDatabase implements ActionDatabase {
  constructor(
    private db: Firestore,
    private prefix = "",
  ) {
    if (!/^[A-Za-z0-9_-]{0,80}$/.test(prefix))
      throw new Error("Invalid action collection prefix");
  }
  private states() {
    return this.db.collection(
      `${this.prefix ? `${this.prefix}-` : ""}telemetry-actions`,
    );
  }
  private tokens() {
    return this.db.collection(
      `${this.prefix ? `${this.prefix}-` : ""}telemetry-action-tokens`,
    );
  }
  transact<T>(
    id: string,
    update: (current: ActionState | undefined) => {
      state?: ActionState;
      result: T;
    },
  ): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.states().doc(id);
      const current = await transaction.get(ref);
      const result = update(
        current.exists ? validateActionState(current.data()) : undefined,
      );
      if (result.state)
        transaction.set(ref, {
          ...validateActionState(result.state)!,
          cleanupAt: Timestamp.fromMillis(result.state.expiresAt),
        });
      return result.result;
    });
  }
  async read(id: string) {
    const record = await this.states().doc(id).get();
    return record.exists ? validateActionState(record.data()) : undefined;
  }
  async list(after: string | undefined, limit: number) {
    let query = this.states().orderBy(FieldPath.documentId()).limit(limit);
    if (after) query = query.startAfter(after);
    return (await query.get()).docs.map((record) =>
      validateActionState(record.data())!,
    );
  }
  async putToken(token: ActionAgentToken) {
    await this.tokens()
      .doc(token.id)
      .create({
        ...validateActionToken(token)!,
        cleanupAt: Timestamp.fromMillis(token.expiresAt),
      });
  }
  async readToken(id: string) {
    const record = await this.tokens().doc(id).get();
    return record.exists ? validateActionToken(record.data()) : undefined;
  }
  async revokeToken(id: string, ownerId: string) {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.tokens().doc(id);
      const record = await transaction.get(ref);
      const token = record.exists
        ? validateActionToken(record.data())
        : undefined;
      if (!token || token.ownerId !== ownerId) return false;
      transaction.update(ref, { revoked: true });
      return true;
    });
  }
}
