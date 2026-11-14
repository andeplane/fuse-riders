import { createFriendsTimers } from "../__mocks__/renderWithProviders";

import { createDemoPresenceService } from "./demoPresenceService";
import type { PresenceService, PresenceSnapshot } from "./presenceService";
import { createNullPresenceService, SnapshotStore } from "./presenceService";
import { createSwitchablePresenceService } from "./switchablePresenceService";

/** A live stand-in that records what is forwarded to it. */
function recordingService(): PresenceService & {
  calls: string[];
  store: SnapshotStore;
} {
  const store = new SnapshotStore({
    ...createNullPresenceService().snapshot(),
    account: { kind: "signed-in", name: "Live" },
  });
  const calls: string[] = [];
  return {
    calls,
    store,
    capabilities: { away: false, demo: false },
    snapshot: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
    warmSignIn: () => void calls.push("warm"),
    signIn: async () => void calls.push("signIn"),
    signOut: async () => void calls.push("signOut"),
    refresh: () => void calls.push("refresh"),
    addFriend: async (id) => void calls.push(`add:${id}`),
    removeFriend: async (id) => void calls.push(`remove:${id}`),
    dismissInvite: async (id) => void calls.push(`dismiss:${id}`),
    setSuspended: (s) => void calls.push(`suspend:${s}`),
    setMode: () => undefined,
    dispose: () => void calls.push("dispose"),
  };
}

describe(createSwitchablePresenceService.name, () => {
  it("forwards everything to the live service until the demo is asked for", async () => {
    const live = recordingService();
    const timers = createFriendsTimers();
    let made = 0;
    const service = createSwitchablePresenceService(live, () => {
      made++;
      return createDemoPresenceService({ schedule: timers.schedule });
    });
    expect(service.capabilities).toEqual({ away: false, demo: true });
    expect(service.snapshot().account).toEqual({
      kind: "signed-in",
      name: "Live",
    });
    service.warmSignIn();
    await service.signIn();
    await service.signOut();
    service.refresh();
    await service.addFriend("a");
    await service.removeFriend("b");
    await service.dismissInvite("c");
    service.setSuspended(true);
    expect(live.calls).toEqual([
      "warm",
      "signIn",
      "signOut",
      "refresh",
      "add:a",
      "remove:b",
      "dismiss:c",
      "suspend:true",
    ]);
    expect(made).toBe(0);

    const seen: PresenceSnapshot[] = [];
    service.subscribe((s) => seen.push(s));
    service.setMode("demo");
    service.setMode("demo");
    expect(made).toBe(1);
    expect(service.capabilities.away).toBe(true);
    expect(service.snapshot().mode).toBe("demo");
    expect(service.snapshot().suspended).toBe(true);
    expect(seen.at(-1)?.account).toEqual({
      kind: "signed-in",
      name: "You (demo)",
    });
    // The demo's own changes come through; the live one's do not while it is at the back.
    timers.fire();
    expect(
      seen
        .at(-1)
        ?.buddies.some(
          (b) => b.status === "online" && b.name === "xXx_RocketMan_xXx",
        ),
    ).toBe(true);
    const count = seen.length;
    live.store.patch({ loading: true });
    expect(seen.length).toBe(count);

    service.setMode("live");
    expect(live.calls.slice(-2)).toEqual(["suspend:true", "suspend:true"]);
    expect(service.snapshot().mode).toBe("live");
    live.store.patch({ loading: false });
    expect(seen.at(-1)?.mode).toBe("live");
    service.dispose();
    expect(live.calls.at(-1)).toBe("dispose");
  });
});
