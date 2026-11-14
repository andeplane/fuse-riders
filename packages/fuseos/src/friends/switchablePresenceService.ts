import type {
  PresenceMode,
  PresenceService,
  PresenceSnapshot,
} from "./presenceService";

/**
 * One service in front of two: the live one, and a demo made on first use. File > Demo buddies flips between
 * them; the tray and the window both read this one, so they always agree on which is showing. Suspension is
 * forwarded to whichever is active (and remembered for the other).
 */
export function createSwitchablePresenceService(
  live: PresenceService,
  makeDemo: () => PresenceService,
): PresenceService {
  let demo: PresenceService | undefined,
    mode: PresenceMode = "live",
    suspended = false,
    unsubscribe: (() => void) | undefined;
  const listeners = new Set<(snapshot: PresenceSnapshot) => void>();
  const active = (): PresenceService =>
    mode === "demo" ? (demo ??= makeDemo()) : live;
  const stamp = (snapshot: PresenceSnapshot): PresenceSnapshot =>
    snapshot.mode === mode ? snapshot : { ...snapshot, mode };
  const emit = () => {
    const snapshot = stamp(active().snapshot());
    for (const listener of listeners) listener(snapshot);
  };
  const follow = () => {
    unsubscribe?.();
    unsubscribe = active().subscribe(() => emit());
  };
  follow();
  return {
    get capabilities() {
      return { ...active().capabilities, demo: true };
    },
    snapshot: () => stamp(active().snapshot()),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    warmSignIn: () => active().warmSignIn(),
    signIn: () => active().signIn(),
    signOut: () => active().signOut(),
    refresh: () => active().refresh(),
    addFriend: (publicId) => active().addFriend(publicId),
    removeFriend: (publicId) => active().removeFriend(publicId),
    dismissInvite: (id) => active().dismissInvite(id),
    setSuspended(next) {
      suspended = next;
      active().setSuspended(next);
    },
    setMode(next) {
      if (next === mode) return;
      // The one going to the back stops polling; nobody is looking at it.
      active().setSuspended(true);
      mode = next;
      active().setSuspended(suspended);
      follow();
      emit();
    },
    dispose() {
      unsubscribe?.();
      listeners.clear();
      live.dispose();
      demo?.dispose();
    },
  };
}
