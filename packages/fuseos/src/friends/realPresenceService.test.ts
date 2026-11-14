import type {
  FriendsClient,
  FriendsClientDependencies,
  FriendsState,
} from "fuse-ui/friends-client";

import type { PresenceSnapshot } from "./presenceService";
import type { BrowserAccountAuth, FriendsView } from "./realPresenceService";
import {
  apiUrlFor,
  buddyFrom,
  createRealPresenceService,
} from "./realPresenceService";

/** fuse-ui's client, recorded: the test pushes states and reads what was asked of it. */
class FakeFriendsClient implements FriendsClient {
  calls: string[] = [];
  private current: FriendsState = {
    view: undefined,
    loading: false,
    error: undefined,
  };
  private listeners = new Set<(state: FriendsState) => void>();
  private currentRoom: ReturnType<FriendsClient["room"]>;
  constructor(readonly dependencies: FriendsClientDependencies) {}
  emit(state: Partial<FriendsState>): void {
    this.current = { ...this.current, ...state };
    for (const listener of this.listeners) listener(this.current);
  }
  state = () => this.current;
  watch(listener: (state: FriendsState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
  onInvite = () => () => undefined;
  setSignedIn(signedIn: boolean): void {
    this.calls.push(`signedIn:${signedIn}`);
  }
  setRoom(room: ReturnType<FriendsClient["room"]>): void {
    this.currentRoom = room;
  }
  room = () => this.currentRoom;
  refresh = () => void this.calls.push("refresh");
  async add(publicId: string): Promise<void> {
    this.calls.push(`add:${publicId}`);
    if (publicId === "full") throw new Error("Friend list is full");
  }
  async remove(publicId: string): Promise<void> {
    this.calls.push(`remove:${publicId}`);
    if (publicId === "bad") throw new Error("");
  }
  async invite(): Promise<number> {
    return 0;
  }
  async dismissInvite(id: string): Promise<void> {
    this.calls.push(`dismiss:${id}`);
  }
  leave = () => undefined;
  dispose = () => void this.calls.push("dispose");
}

/** A promise settled from outside, for an SDK that is still loading. */
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type AuthListener = (account: { name: string } | undefined) => void;
function fakeAuth(options: {
  remembers?: boolean;
  signIn?: () => Promise<void>;
  signOut?: () => Promise<void>;
  ready?: () => Promise<void>;
}) {
  let listener: AuthListener | undefined;
  const calls: string[] = [];
  const auth: BrowserAccountAuth = {
    watch: (next) => {
      listener = next;
      next(undefined);
      return () => {
        listener = undefined;
      };
    },
    token: async () => "token",
    ready: options.ready ?? (async () => undefined),
    warm: () => void calls.push("warm"),
    signIn: options.signIn ?? (async () => void calls.push("signIn")),
    signOut: options.signOut ?? (async () => void calls.push("signOut")),
    failure: (error) =>
      error instanceof Error && error.message === "closed"
        ? ""
        : "Could not sign in. Try again.",
    remembers: () => options.remembers ?? false,
  };
  return {
    auth,
    calls,
    signIn: (name: string) => listener?.({ name }),
    signOut: () => listener?.(undefined),
  };
}

const view: FriendsView = {
  me: { publicId: "0".repeat(20), name: "Me" },
  friends: [
    {
      publicId: "1".repeat(20),
      name: "Amy",
      online: true,
      room: { code: "AB42", gameId: "fuseball" },
      avatarId: "cat",
    },
    { publicId: "2".repeat(20), name: "Bob", online: true },
    {
      publicId: "3".repeat(20),
      name: "Cat",
      online: false,
      room: { code: "ZZ99", gameId: "fuseball" },
    },
  ],
  incoming: [{ publicId: "4".repeat(20), name: "Dan" }],
  outgoing: [{ publicId: "5".repeat(20), name: "Eve" }],
  invites: [
    {
      id: "a".repeat(32),
      from: { publicId: "1".repeat(20), name: "Amy" },
      code: "AB42",
      gameId: "fuseball",
      at: 5,
    },
  ],
  roomPlayers: [],
};

function setup(options: Parameters<typeof fakeAuth>[0] = {}) {
  const account = fakeAuth(options);
  let client: FakeFriendsClient | undefined;
  const service = createRealPresenceService({
    fetch: vi.fn(),
    apiUrl: (path) => `https://api.test${path}`,
    auth: account.auth,
    pollMs: 1000,
    clock: { now: () => 0, schedule: () => () => undefined },
    createClient: (dependencies) =>
      (client = new FakeFriendsClient(dependencies)),
  });
  const seen: PresenceSnapshot[] = [];
  service.subscribe((s) => seen.push(s));
  return { service, account, client: client!, seen };
}

describe(apiUrlFor.name, () => {
  it("builds API URLs on the configured origin, or the page's when none is set", () => {
    expect(
      apiUrlFor(
        "https://api.example.com",
        "https://site.example",
      )("/api/friends/sync"),
    ).toBe("https://api.example.com/api/friends/sync");
    expect(apiUrlFor(undefined, "https://site.example")("/api/me")).toBe(
      "https://site.example/api/me",
    );
    expect(apiUrlFor("", "http://localhost:5173")("/api/me")).toBe(
      "http://localhost:5173/api/me",
    );
  });

  it("refuses paths outside /api/", () => {
    const url = apiUrlFor(undefined, "https://site.example");
    expect(() => url("/other")).toThrow("Invalid API path");
    expect(() => url("/api/../x")).toThrow("Invalid API path");
    expect(() => url("/api/a\\b")).toThrow("Invalid API path");
  });
});

describe(buddyFrom.name, () => {
  it("maps online+room to playing, online to online and anything else to offline", () => {
    expect(view.friends.map(buddyFrom)).toEqual([
      {
        publicId: "1".repeat(20),
        name: "Amy",
        avatarId: "cat",
        status: "playing",
        room: { code: "AB42", gameId: "fuseball" },
      },
      { publicId: "2".repeat(20), name: "Bob", status: "online" },
      { publicId: "3".repeat(20), name: "Cat", status: "offline" },
    ]);
  });
});

describe("buddyFrom against a service that reports away", () => {
  type Friend = FriendsView["friends"][number];
  /** A friend as a newer service sends it: the same view with `away` beside it. */
  const reporting = (friend: Friend, away: unknown): Friend => {
    const extended: Friend & { away: unknown } = { ...friend, away };
    return extended;
  };
  const [playing, online] = view.friends;

  it("shows an online friend as away when the service says so, and ignores the field otherwise", () => {
    if (!playing || !online) throw new Error("the fixture has two friends");
    expect(buddyFrom(reporting(online, true)).status).toBe("away");
    expect(buddyFrom(reporting(online, false)).status).toBe("online");
    // Not a boolean, or sent for someone offline or in a room: the older reading stands.
    expect(buddyFrom(reporting(online, "yes")).status).toBe("online");
    expect(
      buddyFrom(reporting({ ...online, online: false }, true)).status,
    ).toBe("offline");
    expect(buddyFrom(reporting(playing, true)).status).toBe("playing");
  });
});

describe(createRealPresenceService.name, () => {
  it("reports the client's identity as empty, polls only while signed in and maps the view", () => {
    const { service, account, client, seen } = setup();
    expect(client.dependencies.identity()).toEqual({});
    expect(client.dependencies.apiUrl("/api/friends/sync")).toBe(
      "https://api.test/api/friends/sync",
    );
    expect(service.snapshot().account).toEqual({ kind: "signed-out" });
    expect(client.calls).toEqual(["signedIn:false"]);
    expect(service.capabilities).toEqual({ away: false, demo: false });

    account.signIn("Anders");
    expect(client.calls).toEqual(["signedIn:false", "signedIn:true"]);
    expect(service.snapshot().account).toEqual({
      kind: "signed-in",
      name: "Anders",
    });
    expect(service.snapshot().loaded).toBe(false);

    client.emit({ loading: true });
    expect(service.snapshot().loading).toBe(true);
    client.emit({ view, loading: false, error: undefined });
    const snapshot = service.snapshot();
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.me).toEqual(view.me);
    expect(snapshot.buddies.map((b) => b.status)).toEqual([
      "playing",
      "online",
      "offline",
    ]);
    expect(snapshot.incoming).toEqual(view.incoming);
    expect(snapshot.outgoing).toEqual(view.outgoing);
    expect(snapshot.invites).toEqual(view.invites);
    expect(snapshot.error).toBeUndefined();

    client.emit({ error: "Friends unavailable (503)" });
    expect(service.snapshot().error).toBe("Friends unavailable (503)");
    expect(service.snapshot().buddies).toHaveLength(3);
    client.emit({ error: undefined });
    expect(service.snapshot().error).toBeUndefined();

    account.signOut();
    expect(client.calls.at(-1)).toBe("signedIn:false");
    expect(service.snapshot()).toMatchObject({
      account: { kind: "signed-out" },
      loaded: false,
      buddies: [],
      invites: [],
    });
    expect(seen.length).toBeGreaterThan(3);
    service.dispose();
    expect(client.calls.at(-1)).toBe("dispose");
  });

  it("pauses the client while suspended and keeps the last list on screen", () => {
    const { service, account, client } = setup();
    account.signIn("Anders");
    client.emit({ view, loading: false });
    service.setSuspended(true);
    service.setSuspended(true);
    expect(client.calls.filter((c) => c.startsWith("signedIn"))).toEqual([
      "signedIn:false",
      "signedIn:true",
      "signedIn:false",
    ]);
    expect(service.snapshot().suspended).toBe(true);
    expect(service.snapshot().buddies).toHaveLength(3);
    // fuse-ui's client empties its view when told it is signed out; the desktop ignores that while paused.
    client.emit({ view: undefined, loading: false, error: undefined });
    expect(service.snapshot().buddies).toHaveLength(3);
    service.setSuspended(false);
    expect(client.calls.at(-1)).toBe("signedIn:true");
    expect(service.snapshot().suspended).toBe(false);
    // Suspension is remembered across a sign-out.
    service.setSuspended(true);
    account.signOut();
    expect(service.snapshot().suspended).toBe(true);
    account.signIn("Anders");
    expect(client.calls.at(-1)).toBe("signedIn:false");
  });

  it("shows a remembered sign-in as restoring until the SDK says otherwise", async () => {
    const ready = deferred();
    const { service, account } = setup({
      remembers: true,
      ready: () => ready.promise,
    });
    expect(service.snapshot().account).toEqual({ kind: "restoring" });
    ready.resolve();
    await ready.promise;
    await Promise.resolve();
    expect(service.snapshot().account).toEqual({ kind: "signed-out" });
    account.signIn("Back");
    expect(service.snapshot().account).toEqual({
      kind: "signed-in",
      name: "Back",
    });
  });

  it("stays signed in when the SDK restores the account before ready settles, and reports an unreachable SDK", async () => {
    const ready = deferred();
    const first = setup({ remembers: true, ready: () => ready.promise });
    first.account.signIn("Early");
    ready.resolve();
    await ready.promise;
    await Promise.resolve();
    expect(first.service.snapshot().account).toEqual({
      kind: "signed-in",
      name: "Early",
    });

    const failing = deferred();
    const second = setup({ remembers: true, ready: () => failing.promise });
    failing.reject(new Error("offline"));
    await failing.promise.catch(() => undefined);
    await Promise.resolve();
    expect(second.service.snapshot()).toMatchObject({
      account: { kind: "signed-out" },
      error: "Could not reach the sign-in service.",
    });
  });

  it("signs in through the SDK once it is ready and translates failures for the player", async () => {
    const { service, account } = setup();
    service.warmSignIn();
    await service.signIn();
    expect(account.calls).toEqual(["warm", "signIn"]);

    const closed = setup({
      signIn: async () => {
        throw new Error("closed");
      },
    });
    await expect(closed.service.signIn()).rejects.toThrow("");
    expect(closed.service.snapshot().error).toBeUndefined();

    const broken = setup({
      signIn: async () => {
        throw new Error("boom");
      },
    });
    await expect(broken.service.signIn()).rejects.toThrow(
      "Could not sign in. Try again.",
    );
    expect(broken.service.snapshot().error).toBe(
      "Could not sign in. Try again.",
    );

    const stuck = setup({
      signOut: async () => {
        throw new Error("nope");
      },
    });
    await expect(stuck.service.signOut()).rejects.toThrow("Could not sign out");
    expect(stuck.service.snapshot().error).toBe(
      "Could not sign out. Try again.",
    );
    await service.signOut();
    expect(account.calls.at(-1)).toBe("signOut");
  });

  it("forwards actions to the client and surfaces their refusals", async () => {
    const { service, client } = setup();
    service.refresh();
    await service.addFriend("1".repeat(20));
    await service.removeFriend("2".repeat(20));
    await service.dismissInvite("a".repeat(32));
    expect(client.calls.slice(1)).toEqual([
      "refresh",
      `add:${"1".repeat(20)}`,
      `remove:${"2".repeat(20)}`,
      `dismiss:${"a".repeat(32)}`,
    ]);
    await expect(service.addFriend("full")).rejects.toThrow(
      "Friend list is full",
    );
    expect(service.snapshot().error).toBe("Friend list is full");
    await expect(service.removeFriend("bad")).rejects.toThrow();
    expect(service.snapshot().error).toBe("Friends unavailable");
    service.setMode("demo");
  });
});
