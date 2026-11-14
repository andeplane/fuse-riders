import type { WavSegment } from "./playtest-audio.js";

export const MAX_OUTBOX_BYTES = 32 * 1024 * 1024;
export interface StoredRecording {
  kind: "recording";
  key: string;
  id: string;
  gameId: string;
  startedAt: number;
  savedMs: number;
  finished: boolean;
}
export interface StoredSegment extends WavSegment {
  kind: "segment";
  key: string;
  recordingId: string;
  /** Attribution is frozen before upload so retries cannot move audio to a different game. */
  gameId?: string;
}
export type OutboxItem = StoredRecording | StoredSegment;
export interface PlaytestOutbox {
  list(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  updateRecording(
    key: string,
    change: (recording: StoredRecording) => StoredRecording,
  ): Promise<StoredRecording>;
  remove(key: string): Promise<void>;
}

/** All changes commit before resolving. No token or microphone permission is written to disk. */
export function indexedDbPlaytestOutbox(factory: IDBFactory): PlaytestOutbox {
  let opened: Promise<IDBDatabase> | undefined;
  const database = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("fuse-playtest-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("outbox", { keyPath: "key" });
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          opened = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        opened = undefined;
        reject(request.error ?? new Error("Recording storage is unavailable."));
      };
      request.onblocked = () => {
        opened = undefined;
        reject(new Error("Close older game tabs to enable recording storage."));
      };
    }));
  return {
    async list() {
      const db = await database();
      return new Promise<OutboxItem[]>((resolve, reject) => {
        const tx = db.transaction("outbox", "readonly");
        const request = tx.objectStore("outbox").getAll();
        tx.oncomplete = () => resolve(request.result as OutboxItem[]);
        tx.onerror = tx.onabort = () =>
          reject(tx.error ?? new Error("Could not read recording storage."));
      });
    },
    async put(item) {
      const db = await database();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("outbox", "readwrite");
        const store = tx.objectStore("outbox");
        let failure: Error | undefined;
        const request = store.getAll();
        request.onsuccess = () => {
          const items = request.result as OutboxItem[];
          const bytes = items.reduce(
            (sum, value) =>
              sum +
              (value.kind === "segment" && value.key !== item.key
                ? value.blob.size
                : 0),
            0,
          );
          if (
            item.kind === "segment" &&
            bytes + item.blob.size > MAX_OUTBOX_BYTES
          ) {
            failure = new Error(
              "Recording storage is full. Recording stopped; retry pending uploads.",
            );
            tx.abort();
            return;
          }
          if (
            items.length > 1500 &&
            !items.some((value) => value.key === item.key)
          ) {
            failure = new Error(
              "Too many pending recordings. Retry uploads before starting another.",
            );
            tx.abort();
            return;
          }
          store.put(item);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () =>
          reject(
            failure ??
              tx.error ??
              new Error(
                "Could not save microphone audio locally. Recording stopped.",
              ),
          );
      });
    },
    async remove(key) {
      const db = await database();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("outbox", "readwrite");
        tx.objectStore("outbox").delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () =>
          reject(tx.error ?? new Error("Could not update recording storage."));
      });
    },
    async updateRecording(key, change) {
      const db = await database();
      return new Promise<StoredRecording>((resolve, reject) => {
        const tx = db.transaction("outbox", "readwrite"),
          store = tx.objectStore("outbox");
        const request = store.get(key);
        let updated: StoredRecording | undefined;
        request.onsuccess = () => {
          const current = request.result as OutboxItem | undefined;
          if (current?.kind !== "recording") {
            tx.abort();
            return;
          }
          updated = change(current);
          store.put(updated);
        };
        tx.oncomplete = () =>
          updated
            ? resolve(updated)
            : reject(new Error("Recording no longer exists."));
        tx.onerror = tx.onabort = () =>
          reject(tx.error ?? new Error("Could not update recording storage."));
      });
    },
  };
}

export interface RecordingUpload {
  segment(recording: StoredRecording, segment: StoredSegment): Promise<void>;
  finish(recording: StoredRecording): Promise<void>;
}
export interface UploadState {
  pending: number;
  savedMs: number;
  error?: string;
}
export interface UploadDependencies {
  store: PlaytestOutbox;
  upload: RecordingUpload;
  schedule(run: () => void, ms: number): () => void;
  changed(state: UploadState): void;
}

/** Serial, retry-safe uploads. A failed first segment blocks later ones, preserving one gap-free saved-through time. */
export function createRecordingUploader(deps: UploadDependencies) {
  let running: Promise<void> | undefined;
  let cancelled = false;
  let retry = 0;
  let cancelRetry: (() => void) | undefined;
  let again = false;
  async function drain() {
    let items = await deps.store.list();
    let pending = items.filter((item) => item.kind === "segment").length;
    let savedMs = items.reduce(
      (saved, item) =>
        item.kind === "recording" ? Math.max(saved, item.savedMs) : saved,
      0,
    );
    deps.changed({ pending, savedMs });
    for (const item of items) {
      if (item.kind !== "recording") continue;
      let recording = item;
      const segments = items
        .filter(
          (value): value is StoredSegment =>
            value.kind === "segment" && value.recordingId === item.id,
        )
        .sort((a, b) => a.sequence - b.sequence);
      for (const segment of segments) {
        if (cancelled) return;
        await deps.upload.segment(recording, segment);
        // First persist acknowledgement; a crash before removal simply retries an immutable upload.
        recording = await deps.store.updateRecording(
          recording.key,
          (current) => ({
            ...current,
            savedMs: Math.max(current.savedMs, segment.endMs),
          }),
        );
        await deps.store.remove(segment.key);
        pending--;
        savedMs = recording.savedMs;
        deps.changed({ pending, savedMs });
      }
      if (recording.finished && !cancelled) {
        await deps.upload.finish(recording);
        await deps.store.remove(recording.key);
      }
    }
    // New segments may have arrived while a request was pending.
    items = await deps.store.list();
    if (items.some((item) => item.kind === "segment")) await drain();
    retry = 0;
  }
  function kick(): Promise<void> {
    if (cancelled) return Promise.resolve();
    cancelRetry?.();
    cancelRetry = undefined;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await drain();
      } while (again && !cancelled);
    })()
      .catch(async (error: unknown) => {
        const items = await deps.store.list().catch(() => []);
        const pending = items.filter((item) => item.kind === "segment").length;
        deps.changed({
          pending,
          savedMs: 0,
          error:
            error instanceof Error
              ? error.message
              : "Upload failed. Retry uploads.",
        });
        if (!cancelled)
          cancelRetry = deps.schedule(
            () => {
              void kick();
            },
            Math.min(60000, 1000 * 2 ** Math.min(retry++, 6)),
          );
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  return {
    kick,
    dispose() {
      cancelled = true;
      cancelRetry?.();
    },
  };
}
