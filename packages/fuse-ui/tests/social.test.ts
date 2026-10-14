import test from "node:test";
import assert from "node:assert/strict";
import { createGameSocial, friendRoomUrl } from "../src/social.js";
import type { AccountAuth } from "../src/account.js";
import { createMemoryStorage } from "../src/safe-storage.js";
import type { RoomTransport, TransportEvents } from "fuse-network-fe";
import { page } from "./dom-fixture.js";

const games = ["fuse-riders", "fuse-craft", "fuse-lane"].map((id) => ({
  id,
  path: id + "/",
  name: id,
  tagline: id,
  mark: "F",
  accent: "#16e7ff",
  order: 0,
}));
const settle = async () => {
  for (let n = 0; n < 8; n++)
    await new Promise((resolve) => setImmediate(resolve));
};

function fixture(gameId = "fuse-craft", holdHydration = false) {
  const { document } = page();
  const events = new EventTarget();
  let reloads = 0;
  const listeners = new Set<(value: { name: string } | undefined) => void>();
  let signedIn = false,
    token: string | undefined;
  const auth: AccountAuth<{ name: string }> = {
    watch(listener) {
      listeners.add(listener);
      listener(signedIn ? { name: "Ada" } : undefined);
      return () => {
        listeners.delete(listener);
      };
    },
    token: async () => token,
    ready: async () => {},
    warm() {},
    signIn: async () => change(true),
    signOut: async () => change(false),
    remember() {},
    failure: () => "Unavailable",
  };
  function change(value: boolean) {
    signedIn = value;
    token = value ? "account-token" : undefined;
    for (const listener of listeners)
      listener(value ? { name: "Ada" } : undefined);
  }
  const calls: { url: string; headers: Headers; body?: string }[] = [];
  let profileReads = 0,
    releaseHydration: (() => void) | undefined;
  const request: typeof fetch = async (url, init) => {
    if (
      String(url).endsWith("/me") &&
      (!init?.method || init.method === "GET") &&
      ++profileReads === 2 &&
      holdHydration
    )
      await new Promise<void>((resolve) => {
        releaseHydration = resolve;
      });
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (String(url).endsWith("/sync"))
      return Response.json({
        me: { publicId: "a".repeat(20), name: "Ada" },
        friends: [],
        incoming: [],
        outgoing: [],
        invites: [],
        roomPlayers: [],
      });
    return Response.json({
      profile: { username: "Ada" },
      matches: [],
      players: [],
    });
  };
  const timers = new Set<() => void>();
  const social = createGameSocial({
    gameId,
    document,
    base: "/arcade/",
    apiOrigin: "https://api.example",
    window: {
      location: {
        href: `https://games.example/arcade/${gameId}/?mute`,
        origin: "https://games.example",
        assign() {},
        reload() {
          reloads++;
        },
      },
      localStorage: createMemoryStorage(),
      focus() {},
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
    fetch: request,
    auth,
    storage: createMemoryStorage(),
    notifications: undefined,
    games,
    track() {},
    clock: {
      now: () => 100_000,
      schedule(run) {
        timers.add(run);
        return () => {
          timers.delete(run);
        };
      },
    },
  });
  return {
    releaseHydration: () => releaseHydration?.(),
    events,
    reloads: () => reloads,
    social,
    calls,
    change,
    noToken: () => {
      token = undefined;
    },
    document,
    timers,
  };
}

test("cross-game joins use the target game and site base, preserving mute only", () => {
  const options = {
    base: "/arcade/",
    pageUrl:
      "https://games.example/arcade/fuse-riders/?mute&display=1&token=secret",
    games,
  };
  const url = new URL(friendRoomUrl(options, "AB12", "fuse-craft"));
  assert.equal(url.pathname, "/arcade/fuse-craft/");
  assert.equal(url.searchParams.get("room"), "AB12");
  assert.deepEqual([...url.searchParams.keys()], ["room", "mute"]);
  assert.equal(
    new URL(friendRoomUrl({ ...options, base: "./" }, "CD34", "fuse-lane"))
      .pathname,
    "/arcade/fuse-lane/",
  );
  assert.throws(
    () => friendRoomUrl(options, "AB12", "unknown"),
    /Unknown game/,
  );
  assert.throws(
    () => friendRoomUrl(options, "https://evil", "fuse-craft"),
    /Invalid room/,
  );
  assert.throws(
    () =>
      friendRoomUrl(
        { ...options, base: "https://evil/" },
        "AB12",
        "fuse-craft",
      ),
    /Invalid game origin/,
  );
});

test("all games read accounts from the same backend and show the same controls", async () => {
  for (const gameId of ["fuse-craft", "fuse-lane", "dice"]) {
    const f = fixture(gameId);
    assert.deepEqual(
      [...f.social.element().querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
      ["SIGN IN", "FRIENDS", "MATCHES", "LEADERBOARD"],
    );
    f.change(true);
    await settle();
    assert.ok(
      f.calls.some(
        (call) => call.url === `https://api.example/api/games/${gameId}/me`,
      ),
    );
    assert.equal(f.social.playerName("Local"), "Ada");
    f.social.dispose();
    assert.equal(f.timers.size, 0);
    assert.equal(f.document.querySelector(".fui-social-layer"), null);
  }
});

test("result identity stays in headers and is restricted to this game's backend", async () => {
  const f = fixture();
  f.change(true);
  await settle();
  f.calls.length = 0;
  const url = "https://api.example/api/games/fuse-craft/rooms/AB12/results";
  await f.social.reportFetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer room-token" },
    body: '{"result":{}}',
  });
  assert.equal(f.calls[0]!.headers.get("X-Fuse-Identity"), "account-token");
  assert.equal(f.calls[0]!.headers.get("Authorization"), "Bearer room-token");
  assert.equal(f.calls[0]!.body, '{"result":{}}');
  await f.social.reportFetch(
    "https://other.example/api/games/fuse-craft/rooms/AB12/results",
    { method: "POST" },
  );
  assert.equal(f.calls[1]!.headers.get("X-Fuse-Identity"), null);
  f.noToken();
  await assert.rejects(
    f.social.reportFetch(url, { method: "POST" }),
    /Sign-in unavailable/,
  );
  f.change(false);
  await f.social.reportFetch(url, { method: "POST" });
  assert.equal(f.calls.at(-1)!.headers.get("X-Fuse-Identity"), null);
  f.social.dispose();
});

test("a successful account rename updates the name used by rooms without reloading", async () => {
  const f = fixture("fuse-craft", true);
  f.change(true);
  await settle();
  const dialog =
    f.document.querySelector<HTMLDialogElement>(".fui-social-dialog")!;
  Object.defineProperty(dialog, "open", {
    get: () => dialog.hasAttribute("open"),
  });
  Object.defineProperty(dialog, "showModal", {
    value: () => dialog.setAttribute("open", ""),
  });
  f.social.element().querySelector<HTMLButtonElement>("button")!.click();
  await settle();
  dialog.querySelector<HTMLInputElement>("#account-username")!.value =
    "Beatrice";
  dialog.querySelector("form")!.dispatchEvent(
    new f.document.defaultView!.Event("submit", {
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
  assert.equal(f.social.playerName("Local"), "Beatrice");
  f.releaseHydration();
  await settle();
  assert.equal(
    f.social.playerName("Local"),
    "Beatrice",
    "a delayed old profile cannot undo the rename",
  );
  f.social.dispose();
});

test("returning through the browser cache restarts the disposed social client", () => {
  const f = fixture();
  f.events.dispatchEvent(new Event("pagehide"));
  assert.equal(f.document.querySelector(".fui-social-layer"), null);
  const restore = new Event("pageshow");
  Object.defineProperty(restore, "persisted", { value: true });
  f.events.dispatchEvent(restore);
  assert.equal(f.reloads(), 1);
});

test("presence starts at admission, follows replacement membership and clears on transport close", () => {
  const f = fixture();
  let callbacks: TransportEvents | undefined,
    closed = false;
  const transport: RoomTransport = {
    id: "member",
    hostId: "host",
    sentBytes: 0,
    connect() {},
    close() {
      closed = true;
    },
    send: () => true,
    sendFast: () => true,
    linked: () => true,
    explain: () => "",
    stats: async () => ({ direct: 0, relayed: 0, buffered: 0 }),
  };
  const events: TransportEvents = {
    welcome() {},
    peer() {},
    link() {},
    message() {},
    fast() {},
    status() {},
    revoked() {},
    ended() {},
    terminated() {},
  };
  const bound = f.social.transport("AB12", "room-token", events, (received) => {
    callbacks = received;
    return transport;
  });
  assert.equal(f.social.friends.client.room(), undefined);
  callbacks!.welcome("member1", "host");
  assert.deepEqual(f.social.friends.client.room(), {
    code: "AB12",
    memberId: "member1",
    gameId: "fuse-craft",
    token: "room-token",
  });
  callbacks!.welcome("member2", "host");
  assert.equal(f.social.friends.client.room()?.memberId, "member2");
  callbacks!.terminated("gone");
  assert.equal(f.social.friends.client.room(), undefined);
  callbacks!.welcome("member3", "host");
  callbacks!.revoked();
  assert.equal(f.social.friends.client.room(), undefined);
  callbacks!.welcome("member4", "host");
  bound.close();
  assert.equal(f.social.friends.client.room(), undefined);
  assert.equal(closed, true);
  f.social.dispose();
});
