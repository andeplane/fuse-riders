import type { Buddy } from "./presenceService";
import {
  createNullPresenceService,
  EMPTY_SNAPSHOT,
  groupBuddies,
  isPublicId,
  SnapshotStore,
  STATUS_ORDER,
} from "./presenceService";

const buddy = (name: string, status: Buddy["status"]): Buddy => ({
  publicId: name.padEnd(20, "0").slice(0, 20),
  name,
  status,
});

describe(groupBuddies.name, () => {
  it("groups playing, online, away then offline, each sorted by name", () => {
    const groups = groupBuddies([
      buddy("zed", "offline"),
      buddy("bob", "online"),
      buddy("amy", "playing"),
      buddy("cat", "away"),
      buddy("ann", "online"),
    ]);
    expect(groups.map((g) => g.status)).toEqual(STATUS_ORDER);
    expect(groups.map((g) => g.buddies.map((b) => b.name))).toEqual([
      ["amy"],
      ["ann", "bob"],
      ["cat"],
      ["zed"],
    ]);
  });

  it("breaks a name tie by public id so the order is stable", () => {
    const a = { ...buddy("same", "online"), publicId: "a".repeat(20) };
    const b = { ...buddy("same", "online"), publicId: "b".repeat(20) };
    expect(groupBuddies([b, a])[1]!.buddies).toEqual([a, b]);
  });
});

describe(isPublicId.name, () => {
  it("accepts 20 lowercase hex characters and nothing else", () => {
    expect(isPublicId("0123456789abcdef0123")).toBe(true);
    expect(isPublicId("0123456789ABCDEF0123")).toBe(false);
    expect(isPublicId("0123456789abcdef012")).toBe(false);
    expect(isPublicId("0123456789abcdef0123z")).toBe(false);
  });
});

describe(SnapshotStore.name, () => {
  it("tells every listener about a set or a patch until it unsubscribes", () => {
    const store = new SnapshotStore(EMPTY_SNAPSHOT);
    const seen: boolean[] = [];
    const stop = store.subscribe((s) => seen.push(s.loading));
    store.patch({ loading: true });
    expect(store.get().loading).toBe(true);
    stop();
    store.set({ ...EMPTY_SNAPSHOT, loading: false });
    expect(seen).toEqual([true]);
  });
});

describe(createNullPresenceService.name, () => {
  it("is signed out, refuses sign-in and still records suspension", async () => {
    const service = createNullPresenceService();
    expect(service.snapshot()).toEqual(EMPTY_SNAPSHOT);
    expect(service.capabilities).toEqual({ away: false, demo: false });
    await expect(service.signIn()).rejects.toThrow("not available");
    await expect(service.signOut()).resolves.toBeUndefined();
    await expect(service.addFriend("x")).resolves.toBeUndefined();
    await expect(service.removeFriend("x")).resolves.toBeUndefined();
    await expect(service.dismissInvite("x")).resolves.toBeUndefined();
    service.warmSignIn();
    service.refresh();
    service.setMode("demo");
    service.setSuspended(true);
    expect(service.snapshot().suspended).toBe(true);
    service.dispose();
  });
});
