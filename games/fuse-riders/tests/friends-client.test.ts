import test from "node:test";
import assert from "node:assert/strict";
import type { FriendsView } from "fuse-platform/friends-api";
import {
  createFriendsClient,
  type FriendsClient,
  type FriendsState,
} from "../src/online/friends-client.js";

/** A clock whose timers run only when told to, and a fetch that records every request. */
function harness(options: { token?: string | undefined } = {}) {
  let now = 1_000_000;
  const timers = new Map<number, { run: () => void; at: number }>();
  let next = 1;
  const clock = {
    now: () => now,
    schedule: (callback: () => void, delayMs: number) => {
      const id = next++;
      timers.set(id, { run: callback, at: now + delayMs });
      return () => {
        timers.delete(id);
      };
    },
  };
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    await settle();
  };
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const requests: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
    keepalive?: boolean;
  }[] = [];
  let view: FriendsView = {
    me: { publicId: "me", name: "Me" },
    friends: [],
    incoming: [],
    outgoing: [],
    invites: [],
    roomPlayers: [],
  };
  let failWith: { status: number; body?: unknown } | undefined;
  // A gate the test can close, so a poll stays in flight until it is opened.
  let gate: Promise<void> | undefined, openGate: (() => void) | undefined;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      ...(init?.keepalive === undefined ? {} : { keepalive: init.keepalive }),
    });
    if (gate) await gate;
    if (failWith)
      return new Response(
        failWith.body === undefined ? "" : JSON.stringify(failWith.body),
        { status: failWith.status },
      );
    const url = String(input);
    if (url.endsWith("/api/friends/sync"))
      return Response.json(structuredClone(view));
    if (url.includes("/invites") && init?.method === "POST")
      return Response.json({ sent: 2 });
    return Response.json({ ok: true });
  }) as typeof globalThis.fetch;
  const token = "token" in options ? options.token : "id-token";
  const states: FriendsState[] = [];
  const client: FriendsClient = createFriendsClient({
    fetch,
    token: async () => token,
    apiUrl: (path) => `https://api${path}`,
    identity: () => ({ name: "Me", avatarId: "cat" }),
    clock,
    pollMs: 20_000,
  });
  client.watch((state) => states.push(state));
  return {
    client,
    requests,
    states,
    advance,
    settle,
    timers: () => timers.size,
    setView: (next: Partial<FriendsView>) => {
      view = { ...view, ...next };
    },
    fail: (status: number, body?: unknown) => {
      failWith = { status, ...(body === undefined ? {} : { body }) };
    },
    recover: () => {
      failWith = undefined;
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        openGate = () => {
          gate = undefined;
          resolve();
        };
      });
    },
    release: () => openGate?.(),
  };
}

test("a signed-in client polls, reports where it is, and stops when signed out", async () => {
  const h = harness();
  assert.equal(h.requests.length, 0);
  h.client.setSignedIn(true);
  await h.advance(0);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0], {
    url: "https://api/api/friends/sync",
    method: "POST",
    headers: {
      Authorization: "Bearer id-token",
      "Content-Type": "application/json",
    },
    body: { name: "Me", avatarId: "cat" },
  });
  assert.equal(h.client.state().view?.me.name, "Me");
  assert.equal(h.client.state().loading, false);
  // The next poll is one interval away; a room change brings it forward and puts the room in it.
  h.client.setRoom({
    code: "AB12",
    memberId: "m1",
    gameId: "fuse-riders",
    token: "t",
  });
  await h.advance(1500);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1]!.body, {
    name: "Me",
    avatarId: "cat",
    room: { code: "AB12", memberId: "m1", gameId: "fuse-riders" },
  });
  await h.advance(20_000);
  assert.equal(h.requests.length, 3);
  // Setting the same room again polls nothing; signing out stops the timer and forgets the view.
  h.client.setRoom({
    code: "AB12",
    memberId: "m1",
    gameId: "fuse-riders",
    token: "t",
  });
  await h.advance(1500);
  assert.equal(h.requests.length, 3);
  h.client.setSignedIn(false);
  assert.equal(h.client.state().view, undefined);
  await h.advance(60_000);
  assert.equal(h.requests.length, 3);
  assert.equal(h.timers(), 0);
});

test("refresh coalesces: many callers, one request, never sooner than the minimum gap", async () => {
  const h = harness();
  h.client.setSignedIn(true);
  await h.advance(0);
  h.client.refresh();
  h.client.refresh();
  h.client.refresh();
  await h.advance(1000);
  assert.equal(h.requests.length, 1);
  await h.advance(500);
  assert.equal(h.requests.length, 2);
  // A refresh asked for while a poll is in flight starts no second request, but brings the next poll forward.
  h.hold();
  await h.advance(20_000);
  assert.equal(h.requests.length, 3);
  h.client.refresh();
  h.client.refresh();
  await h.settle();
  assert.equal(h.requests.length, 3);
  h.release();
  await h.settle();
  assert.equal(h.requests.length, 3);
  await h.advance(1500);
  assert.equal(h.requests.length, 4);
  // And without one the interval is the full one.
  await h.advance(1500);
  assert.equal(h.requests.length, 4);
  await h.advance(18_500);
  assert.equal(h.requests.length, 5);
});

test("a failed poll keeps the last view and says why; the next poll clears it", async () => {
  const h = harness();
  h.client.setSignedIn(true);
  await h.advance(0);
  h.setView({ friends: [{ publicId: "f", name: "Fay", online: true }] });
  await h.advance(20_000);
  assert.equal(h.client.state().view?.friends.length, 1);
  h.fail(500);
  await h.advance(20_000);
  assert.equal(h.client.state().error, "Friends unavailable (500)");
  assert.equal(h.client.state().view?.friends.length, 1);
  h.fail(429, { error: "Too many requests; try later" });
  await h.advance(20_000);
  assert.equal(h.client.state().error, "Too many requests; try later");
  h.fail(401, "not json");
  await h.advance(20_000);
  assert.equal(h.client.state().error, "Sign in first");
  h.recover();
  await h.advance(20_000);
  assert.equal(h.client.state().error, undefined);
});

test("a room the service refuses is dropped from the claim, and the next poll comes soon", async () => {
  const h = harness();
  h.client.setSignedIn(true);
  h.client.setRoom({
    code: "AB12",
    memberId: "m1",
    gameId: "fuse-riders",
    token: "t",
  });
  await h.advance(0);
  assert.equal(
    (h.requests.at(-1)!.body as { room: { code: string } }).room.code,
    "AB12",
  );
  h.fail(403, { error: "Join the room first" });
  await h.advance(20_000);
  assert.equal(h.client.state().error, "Join the room first");
  assert.equal(h.client.room(), undefined);
  h.recover();
  await h.advance(1500);
  assert.deepEqual(h.requests.at(-1)!.body, { name: "Me", avatarId: "cat" });
  assert.equal(h.client.state().error, undefined);
  // Any other failure keeps the room.
  h.client.setRoom({
    code: "AB12",
    memberId: "m1",
    gameId: "fuse-riders",
    token: "t",
  });
  await h.advance(1500);
  h.fail(500);
  await h.advance(20_000);
  assert.equal(h.client.room()?.code, "AB12");
});

test("a guest's poll is a sign-in error, not a request", async () => {
  const h = harness({ token: undefined });
  h.client.setSignedIn(true);
  await h.advance(0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.client.state().error, "Sign in first");
  await assert.rejects(h.client.add("abc"), /Sign in first/);
});

test("new invites are announced once each, refreshed ones again, and never on the first poll", async () => {
  const h = harness();
  const heard: string[] = [];
  h.client.onInvite((invite) => heard.push(`${invite.id}@${invite.at}`));
  const invite = (id: string, at: number) => ({
    id,
    from: { publicId: "f", name: "Fay" },
    code: "AB12",
    gameId: "fuse-riders",
    at,
  });
  h.setView({ invites: [invite("i1", 1)] });
  h.client.setSignedIn(true);
  await h.advance(0);
  assert.deepEqual(heard, []);
  h.setView({ invites: [invite("i1", 1), invite("i2", 2)] });
  await h.advance(20_000);
  assert.deepEqual(heard, ["i2@2"]);
  await h.advance(20_000);
  assert.deepEqual(heard, ["i2@2"]);
  h.setView({ invites: [invite("i1", 3)] });
  await h.advance(20_000);
  assert.deepEqual(heard, ["i2@2", "i1@3"]);
});

test("actions send their request, then poll to show the result", async () => {
  const h = harness();
  h.client.setSignedIn(true);
  h.client.setRoom({
    code: "AB12",
    memberId: "m1",
    gameId: "fuse-riders",
    token: "room-token",
  });
  await h.advance(0);
  const before = h.requests.length;
  await h.client.add("abc");
  assert.deepEqual(h.requests[before], {
    url: "https://api/api/friends",
    method: "POST",
    headers: {
      Authorization: "Bearer id-token",
      "Content-Type": "application/json",
    },
    body: { publicId: "abc" },
  });
  assert.equal(h.requests[before + 1]!.url, "https://api/api/friends/sync");
  await h.client.remove("abc");
  assert.equal(h.requests.at(-2)!.method, "DELETE");
  assert.equal(h.requests.at(-2)!.url, "https://api/api/friends/abc");
  await h.client.dismissInvite("i1");
  assert.equal(h.requests.at(-2)!.url, "https://api/api/friends/invites/i1");
  // An invite is proven by the room token, with the account in the identity header.
  assert.equal(await h.client.invite(["abc", "def"]), 2);
  assert.deepEqual(h.requests.at(-2), {
    url: "https://api/api/rooms/AB12/invites",
    method: "POST",
    headers: {
      Authorization: "Bearer room-token",
      "X-Fuse-Identity": "id-token",
      "Content-Type": "application/json",
    },
    body: { to: ["abc", "def"] },
  });
  h.fail(403, { error: "Join the room first" });
  await assert.rejects(h.client.invite(["abc"]), /Join the room first/);
  assert.equal(h.client.state().error, "Join the room first");
  h.recover();
  h.client.setRoom(undefined);
  await assert.rejects(h.client.invite(["abc"]), /Join a room first/);
});

test("leaving a room on the way out is one keepalive request, then nothing", async () => {
  const h = harness();
  h.client.setSignedIn(true);
  h.client.setRoom({
    code: "AB12",
    memberId: "m1",
    gameId: "fuse-riders",
    token: "t",
  });
  await h.advance(0);
  const before = h.requests.length;
  h.client.leave();
  await h.settle();
  assert.equal(h.requests.length, before + 1);
  assert.equal(h.requests.at(-1)!.keepalive, true);
  assert.deepEqual(h.requests.at(-1)!.body, { name: "Me", avatarId: "cat" });
  assert.equal(h.client.room(), undefined);
  // Without a room, or signed out, there is nothing to leave.
  h.client.leave();
  h.client.setSignedIn(false);
  h.client.leave();
  await h.settle();
  assert.equal(h.requests.length, before + 1);
  h.client.dispose();
  h.client.refresh();
  await h.advance(60_000);
  assert.equal(h.requests.length, before + 1);
});
