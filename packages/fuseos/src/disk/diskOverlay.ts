/**
 * Saves from Notepad++ never go to GitHub. They land here, keyed by the file's location
 * ("packages/fuseos/src/App.tsx", or "A:/porn/homework.txt"), and shadow the committed text
 * until File > Revert to original removes them. The browser is the only place they exist.
 */

export type OverlayChange = {
  path: string;
  /** The new text, or undefined when the entry was removed (reverted). */
  content: string | undefined;
};

export interface DiskOverlay {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Every path with a saved copy. */
  list(): Promise<string[]>;
  /** Fires after each write or remove made through this overlay, in any window. */
  subscribe(listener: (change: OverlayChange) => void): () => void;
}

/** Listener bookkeeping shared by both implementations. */
abstract class BaseOverlay implements DiskOverlay {
  private readonly listeners = new Set<(change: OverlayChange) => void>();

  abstract read(path: string): Promise<string | undefined>;
  abstract list(): Promise<string[]>;
  protected abstract put(path: string, content: string): Promise<void>;
  protected abstract drop(path: string): Promise<void>;

  async write(path: string, content: string): Promise<void> {
    await this.put(path, content);
    this.notify({ path, content });
  }

  async remove(path: string): Promise<void> {
    await this.drop(path);
    this.notify({ path, content: undefined });
  }

  subscribe(listener: (change: OverlayChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: OverlayChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export class MemoryDiskOverlay extends BaseOverlay {
  private readonly files = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    super();
    for (const [path, content] of Object.entries(initial))
      this.files.set(path, content);
  }

  read(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].sort());
  }

  protected put(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  protected drop(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
}

export const OVERLAY_DB_NAME = "fuseos-disk";
export const OVERLAY_STORE = "files";

type IdbRequest<T> = { result: T; error: DOMException | null } & EventTarget;

function settle<T>(request: IdbRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
  });
}

/** The real overlay: one object store of `{ path, content }` rows in IndexedDB. */
export class IndexedDbDiskOverlay extends BaseOverlay {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly factory: IDBFactory) {
    super();
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = this.factory.open(OVERLAY_DB_NAME, 1);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore(OVERLAY_STORE, { keyPath: "path" });
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => {
        this.db = undefined;
        reject(request.error ?? new Error("IndexedDB could not be opened"));
      });
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(OVERLAY_STORE, mode).objectStore(OVERLAY_STORE);
  }

  async read(path: string): Promise<string | undefined> {
    const store = await this.store("readonly");
    const row: unknown = await settle(store.get(path));
    return typeof row === "object" &&
      row !== null &&
      "content" in row &&
      typeof row.content === "string"
      ? row.content
      : undefined;
  }

  async list(): Promise<string[]> {
    const store = await this.store("readonly");
    const keys = await settle(store.getAllKeys());
    return keys.filter((key): key is string => typeof key === "string").sort();
  }

  protected async put(path: string, content: string): Promise<void> {
    const store = await this.store("readwrite");
    await settle(store.put({ path, content }));
  }

  protected async drop(path: string): Promise<void> {
    const store = await this.store("readwrite");
    await settle(store.delete(path));
  }
}
