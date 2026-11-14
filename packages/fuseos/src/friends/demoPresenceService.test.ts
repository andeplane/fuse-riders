import { createFriendsTimers } from "../__mocks__/renderWithProviders";

import {
  createDemoPresenceService,
  DEMO_BUDDIES,
  DEMO_ME,
  DEMO_SCRIPT,
} from "./demoPresenceService";

const rocket = DEMO_BUDDIES[4]!;

describe(createDemoPresenceService.name, () => {
  it("starts signed in with the fixed list and plays the script one beat at a time", () => {
    const timers = createFriendsTimers();
    const service = createDemoPresenceService({ schedule: timers.schedule });
    const snapshot = service.snapshot();
    expect(snapshot.mode).toBe("demo");
    expect(snapshot.account).toEqual({ kind: "signed-in", name: DEMO_ME.name });
    expect(snapshot.me).toEqual(DEMO_ME);
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.buddies).toEqual(DEMO_BUDDIES);
    expect(service.capabilities).toEqual({ away: true, demo: true });

    const seen: string[] = [];
    service.subscribe((s) =>
      seen.push(s.buddies.find((b) => b.publicId === rocket.publicId)!.status),
    );
    timers.fire();
    timers.fire();
    expect(seen).toEqual(["online", "playing"]);
    timers.fire();
    expect(service.snapshot().invites).toMatchObject([
      { from: rocket, code: "VB77", gameId: "fuse-volley" },
    ]);
    timers.fire();
    expect(service.snapshot().incoming.map((c) => c.name)).toEqual([
      "PigChampion",
    ]);
    timers.fire();
    expect(
      service.snapshot().buddies.find((b) => b.name === "sk8rgrl99")!.status,
    ).toBe("away");
    // The script is over: nothing more is scheduled.
    expect(timers.pending()).toBe(0);
    expect(DEMO_SCRIPT.map((s) => s.describe)).toHaveLength(5);
    service.dispose();
  });

  it("can start signed out, signs in on request and forgets everything on sign-out", async () => {
    const timers = createFriendsTimers();
    const service = createDemoPresenceService({
      schedule: timers.schedule,
      signedIn: false,
    });
    expect(service.snapshot().account).toEqual({ kind: "signed-out" });
    expect(service.snapshot().buddies).toEqual([]);
    expect(timers.pending()).toBe(0);
    await service.signIn();
    await service.signIn();
    expect(service.snapshot().buddies).toHaveLength(DEMO_BUDDIES.length);
    expect(timers.pending()).toBe(1);
    timers.fire();
    await service.signOut();
    expect(service.snapshot().account).toEqual({ kind: "signed-out" });
    expect(service.snapshot().buddies).toEqual([]);
    expect(timers.pending()).toBe(0);
    // Signing back in restarts the script from the top.
    await service.signIn();
    expect(
      service.snapshot().buddies.find((b) => b.publicId === rocket.publicId)!
        .status,
    ).toBe("offline");
  });

  it("adds a request, accepts an incoming one, removes and dismisses", async () => {
    const timers = createFriendsTimers();
    const service = createDemoPresenceService({ schedule: timers.schedule });
    const id = "f".repeat(20);
    await service.addFriend(id);
    await service.addFriend(id);
    expect(service.snapshot().outgoing).toEqual([
      { publicId: id, name: "Player ffffff" },
    ]);
    await service.addFriend(DEMO_BUDDIES[0]!.publicId);
    expect(service.snapshot().outgoing).toHaveLength(1);
    await service.removeFriend(id);
    expect(service.snapshot().outgoing).toEqual([]);

    for (let i = 0; i < 4; i++) timers.fire();
    const pig = service.snapshot().incoming[0]!;
    await service.addFriend(pig.publicId);
    expect(service.snapshot().incoming).toEqual([]);
    expect(service.snapshot().buddies.at(-1)).toEqual({
      ...pig,
      status: "online",
    });
    await service.removeFriend(pig.publicId);
    expect(
      service.snapshot().buddies.some((b) => b.publicId === pig.publicId),
    ).toBe(false);

    const invite = service.snapshot().invites[0]!;
    await service.dismissInvite(invite.id);
    expect(service.snapshot().invites).toEqual([]);
  });

  it("refuses to add while signed out and records suspension without a change loop", async () => {
    const timers = createFriendsTimers();
    const service = createDemoPresenceService({
      schedule: timers.schedule,
      signedIn: false,
    });
    await expect(service.addFriend("a".repeat(20))).rejects.toThrow(
      "Sign in first",
    );
    let changes = 0;
    service.subscribe(() => changes++);
    service.setSuspended(true);
    service.setSuspended(true);
    expect(service.snapshot().suspended).toBe(true);
    expect(changes).toBe(1);
    service.warmSignIn();
    service.refresh();
    service.setMode("live");
    await service.signIn();
    expect(service.snapshot().suspended).toBe(true);
  });
});
