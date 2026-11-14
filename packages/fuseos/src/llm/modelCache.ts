/**
 * Where a downloaded model lives: web-llm stores the weights, the chat config and the WebGPU library in the
 * browser's Cache API under its own cache names, keyed by their download URLs, which carry the model id. Reading
 * and clearing them here, without `@mlc-ai/web-llm`, keeps the Control Panel from loading the library.
 */
export interface ModelCache {
  /** The model's weights are in this browser. */
  has(modelId: string): Promise<boolean>;
  /** Removes the model's weights and config, and the WebGPU libraries, so the next question downloads again. */
  forget(modelId: string): Promise<void>;
}

/** The web-llm cache names (cache_util.ts in the library). */
export const WEBLLM_CACHES = {
  model: "webllm/model",
  config: "webllm/config",
  wasm: "webllm/wasm",
} as const;

/** The slice of `CacheStorage` the cache needs, so tests can hand in a fake. */
export type CacheStorageLike = {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
};

export type CacheLike = {
  keys(): Promise<readonly { url: string }[]>;
  delete(request: string): Promise<boolean>;
};

function belongsTo(url: string, modelId: string): boolean {
  return url.includes(`/${modelId}/`);
}

export class CacheApiModelCache implements ModelCache {
  constructor(private readonly storage: () => CacheStorageLike | undefined) {}

  async has(modelId: string): Promise<boolean> {
    const storage = this.storage();
    if (!storage) return false;
    try {
      const cache = await storage.open(WEBLLM_CACHES.model);
      const keys = await cache.keys();
      return keys.some((request) => belongsTo(request.url, modelId));
    } catch {
      // A blocked or absent Cache API: nothing is downloaded as far as we can tell.
      return false;
    }
  }

  async forget(modelId: string): Promise<void> {
    const storage = this.storage();
    if (!storage) return;
    for (const name of [WEBLLM_CACHES.model, WEBLLM_CACHES.config]) {
      const cache = await storage.open(name);
      const keys = await cache.keys();
      for (const request of keys)
        if (belongsTo(request.url, modelId)) await cache.delete(request.url);
    }
    // The WebGPU libraries are named after the model family, not the id, and are small: drop them all.
    await storage.delete(WEBLLM_CACHES.wasm);
  }
}

function browserCaches(): CacheStorageLike | undefined {
  try {
    return typeof caches === "undefined" ? undefined : caches;
  } catch {
    return undefined;
  }
}

export const browserModelCache: ModelCache = new CacheApiModelCache(
  browserCaches,
);

export class MemoryModelCache implements ModelCache {
  readonly forgotten: string[] = [];
  constructor(private readonly downloaded = new Set<string>()) {}

  async has(modelId: string): Promise<boolean> {
    return this.downloaded.has(modelId);
  }

  async forget(modelId: string): Promise<void> {
    this.downloaded.delete(modelId);
    this.forgotten.push(modelId);
  }

  /** What a finished download leaves behind. */
  add(modelId: string): void {
    this.downloaded.add(modelId);
  }
}
