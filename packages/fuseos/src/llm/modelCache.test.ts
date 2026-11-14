import type { CacheLike, CacheStorageLike } from "./modelCache";
import {
  CacheApiModelCache,
  MemoryModelCache,
  WEBLLM_CACHES,
} from "./modelCache";

const QWEN = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const LLAMA = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

function url(model: string, file: string): string {
  return `https://huggingface.co/mlc-ai/${model}/resolve/main/${file}`;
}

/** A Cache API with named caches holding URLs, as web-llm leaves it. */
function fakeCaches(initial: Record<string, string[]>): CacheStorageLike & {
  caches: Map<string, Set<string>>;
} {
  const caches = new Map(
    Object.entries(initial).map(([name, urls]) => [name, new Set(urls)]),
  );
  const open = async (name: string): Promise<CacheLike> => {
    const entries = caches.get(name) ?? new Set<string>();
    caches.set(name, entries);
    return {
      keys: async () => [...entries].map((entry) => ({ url: entry })),
      delete: async (request) => entries.delete(request),
    };
  };
  return { caches, open, delete: async (name) => caches.delete(name) };
}

describe(CacheApiModelCache.name, () => {
  it("sees a model whose weights are cached and not one that is absent", async () => {
    const storage = fakeCaches({
      [WEBLLM_CACHES.model]: [url(QWEN, "params_shard_0.bin")],
    });
    const cache = new CacheApiModelCache(() => storage);
    expect(await cache.has(QWEN)).toBe(true);
    expect(await cache.has(LLAMA)).toBe(false);
  });

  it("forgets one model's weights and config, every WebGPU library, and nothing of the other model", async () => {
    const storage = fakeCaches({
      [WEBLLM_CACHES.model]: [
        url(QWEN, "params_shard_0.bin"),
        url(QWEN, "tokenizer.json"),
        url(LLAMA, "params_shard_0.bin"),
      ],
      [WEBLLM_CACHES.config]: [
        url(QWEN, "mlc-chat-config.json"),
        url(LLAMA, "mlc-chat-config.json"),
      ],
      [WEBLLM_CACHES.wasm]: [
        "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_80/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
      ],
    });
    const cache = new CacheApiModelCache(() => storage);
    await cache.forget(QWEN);
    expect([...(storage.caches.get(WEBLLM_CACHES.model) ?? [])]).toEqual([
      url(LLAMA, "params_shard_0.bin"),
    ]);
    expect([...(storage.caches.get(WEBLLM_CACHES.config) ?? [])]).toEqual([
      url(LLAMA, "mlc-chat-config.json"),
    ]);
    expect(storage.caches.has(WEBLLM_CACHES.wasm)).toBe(false);
    expect(await cache.has(QWEN)).toBe(false);
    expect(await cache.has(LLAMA)).toBe(true);
  });

  it("reports nothing downloaded and forgets nothing when the Cache API is missing or broken", async () => {
    const missing = new CacheApiModelCache(() => undefined);
    expect(await missing.has(QWEN)).toBe(false);
    await expect(missing.forget(QWEN)).resolves.toBeUndefined();
    const broken = new CacheApiModelCache(() => ({
      open: async () => {
        throw new Error("SecurityError");
      },
      delete: async () => false,
    }));
    expect(await broken.has(QWEN)).toBe(false);
    await expect(broken.forget(QWEN)).rejects.toThrow("SecurityError");
  });
});

describe(MemoryModelCache.name, () => {
  it("remembers what was added and what was forgotten", async () => {
    const cache = new MemoryModelCache(new Set([QWEN]));
    expect(await cache.has(QWEN)).toBe(true);
    cache.add(LLAMA);
    expect(await cache.has(LLAMA)).toBe(true);
    await cache.forget(QWEN);
    expect(await cache.has(QWEN)).toBe(false);
    expect(cache.forgotten).toEqual([QWEN]);
  });
});
