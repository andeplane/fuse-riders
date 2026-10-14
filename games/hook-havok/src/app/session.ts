export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function sessionStore(open: () => Store): Store {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        return open().getItem(key) ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        open().setItem(key, value);
      } catch {
        /* current-page fallback */
      }
    },
  };
}
const key = (code: string) => `hook-havok-member-${code}`;
export function saveCreator(store: Store, code: string, token: string): void {
  store.setItem(key(code), token);
}
export function sessionToken(
  store: Store,
  code: string,
  display: boolean,
  fresh: () => string,
): string {
  if (display) return fresh();
  const old = store.getItem(key(code));
  if (old) return old;
  const token = fresh();
  store.setItem(key(code), token);
  return token;
}
export function inviteUrl(
  current: string,
  code: string,
  display = false,
): string {
  const url = new URL(current),
    muted = url.searchParams.has("mute");
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  if (display) url.searchParams.set("display", "1");
  if (muted) url.searchParams.set("mute", "");
  return url.href;
}
