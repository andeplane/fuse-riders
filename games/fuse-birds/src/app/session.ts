export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
export function safeStore(open: () => Storage): Store {
  const cache = new Map<string, string>();
  return {
    get(key) {
      try {
        return open().getItem(key) ?? cache.get(key) ?? null;
      } catch {
        return cache.get(key) ?? null;
      }
    },
    set(key, value) {
      cache.set(key, value);
      try {
        open().setItem(key, value);
      } catch {
        /* Page-local fallback retains a newly created room's token. */
      }
    },
  };
}
export const storageKeys = {
  name: "fuse-birds-name",
  shared: "fuse-birds-shared",
  host: (code: string) => `fuse-birds-host-${code}`,
  peer: (code: string) => `fuse-birds-peer-${code}`,
};
export function roomToken(
  store: Store,
  code: string,
  display: boolean,
  secret: () => string,
): string {
  if (display) return secret();
  const host = store.get(storageKeys.host(code));
  if (host) return host;
  const prior = store.get(storageKeys.peer(code));
  if (prior) return prior;
  const token = secret();
  store.set(storageKeys.peer(code), token);
  return token;
}
export function roomFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/unknown game/i.test(text))
    return "Fuse Birds is not enabled on this room service yet.";
  if (/another game/i.test(text))
    return "That room code belongs to another game.";
  return text;
}
