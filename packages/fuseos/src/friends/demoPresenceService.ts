import type {
  Buddy,
  PlayerCard,
  PresenceService,
  PresenceSnapshot,
  RoomInvite,
} from "./presenceService";
import { EMPTY_SNAPSHOT, SnapshotStore } from "./presenceService";

/**
 * The typed fake behind File > Demo buddies and the tests: a fixed buddy list and a short script in which a friend
 * signs in, starts a game and invites the player. Every step is driven by the injected scheduler, so a test
 * advances it by hand and the preview sees it unfold in real time. Nothing here touches the network.
 */
export type DemoScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

export type DemoPresenceOptions = {
  schedule: DemoScheduler;
  /** The script's own beat in milliseconds between steps; default 5 s. */
  beatMs?: number;
  /** Start signed in (the default) so picking the demo shows a list at once. */
  signedIn?: boolean;
};

export const DEMO_ME: PlayerCard = {
  publicId: "0123456789abcdef0123",
  name: "You (demo)",
  avatarId: "rider",
};

export const DEMO_BUDDIES: readonly Buddy[] = [
  {
    publicId: "a1a1a1a1a1a1a1a1a1a1",
    name: "DoomSlayer_1993",
    status: "playing",
    room: { code: "AB42", gameId: "fuseball" },
  },
  { publicId: "b2b2b2b2b2b2b2b2b2b2", name: "sk8rgrl99", status: "online" },
  { publicId: "c3c3c3c3c3c3c3c3c3c3", name: "Clippy_Fan", status: "online" },
  {
    publicId: "d4d4d4d4d4d4d4d4d4d4",
    name: "NetcodeNina",
    status: "away",
    statusLine: "brb, lag spike",
  },
  {
    publicId: "e5e5e5e5e5e5e5e5e5e5",
    name: "xXx_RocketMan_xXx",
    status: "offline",
  },
  {
    publicId: "f6f6f6f6f6f6f6f6f6f6",
    name: "LAN_party_Lars",
    status: "offline",
  },
];

const ROCKET = DEMO_BUDDIES[4]!;
const DEMO_INVITE_ROOM = { code: "VB77", gameId: "fuse-volley" };
const PIG_CHAMPION: PlayerCard = {
  publicId: "0707070707070707070707".slice(0, 20),
  name: "PigChampion",
};

/** The script, one step per beat after sign-in. Exported so a test can assert the whole story. */
export const DEMO_SCRIPT: readonly {
  describe: string;
  apply: (snapshot: PresenceSnapshot, at: number) => PresenceSnapshot;
}[] = [
  {
    describe: "RocketMan signs in",
    apply: (snapshot) =>
      withBuddy(snapshot, ROCKET.publicId, { status: "online" }),
  },
  {
    describe: "RocketMan starts Fuse Volley",
    apply: (snapshot) =>
      withBuddy(snapshot, ROCKET.publicId, {
        status: "playing",
        room: DEMO_INVITE_ROOM,
      }),
  },
  {
    describe: "RocketMan invites you",
    apply: (snapshot, at) => ({
      ...snapshot,
      invites: [
        {
          id: "11111111111111111111111111111111",
          from: ROCKET,
          code: DEMO_INVITE_ROOM.code,
          gameId: DEMO_INVITE_ROOM.gameId,
          at,
        } satisfies RoomInvite,
        ...snapshot.invites,
      ],
    }),
  },
  {
    describe: "PigChampion wants to be friends",
    apply: (snapshot) => ({
      ...snapshot,
      incoming: [PIG_CHAMPION, ...snapshot.incoming],
    }),
  },
  {
    describe: "sk8rgrl99 goes away",
    apply: (snapshot) =>
      withBuddy(snapshot, DEMO_BUDDIES[1]!.publicId, { status: "away" }),
  },
];

function withBuddy(
  snapshot: PresenceSnapshot,
  publicId: string,
  patch: Partial<Buddy>,
): PresenceSnapshot {
  return {
    ...snapshot,
    buddies: snapshot.buddies.map((buddy) => {
      if (buddy.publicId !== publicId) return buddy;
      const { room: _room, ...rest } = buddy;
      return { ...rest, ...patch };
    }),
  };
}

const signedInSnapshot = (): PresenceSnapshot => ({
  ...EMPTY_SNAPSHOT,
  mode: "demo",
  account: { kind: "signed-in", name: DEMO_ME.name },
  me: DEMO_ME,
  loaded: true,
  buddies: [...DEMO_BUDDIES],
});

const signedOutSnapshot = (): PresenceSnapshot => ({
  ...EMPTY_SNAPSHOT,
  mode: "demo",
});

export function createDemoPresenceService(
  options: DemoPresenceOptions,
): PresenceService {
  const beat = options.beatMs ?? 5_000;
  const store = new SnapshotStore(
    options.signedIn === false ? signedOutSnapshot() : signedInSnapshot(),
  );
  let step = 0,
    cancel: (() => void) | undefined,
    clock = 0;
  const stop = () => {
    cancel?.();
    cancel = undefined;
  };
  const next = () => {
    const entry = DEMO_SCRIPT[step];
    if (!entry || store.get().account.kind !== "signed-in") return;
    step++;
    clock += beat;
    store.set(entry.apply(store.get(), clock));
    cancel =
      step < DEMO_SCRIPT.length ? options.schedule(next, beat) : undefined;
  };
  const start = () => {
    stop();
    if (step < DEMO_SCRIPT.length) cancel = options.schedule(next, beat);
  };
  if (store.get().account.kind === "signed-in") start();

  const pendingCard = (publicId: string): PlayerCard => ({
    publicId,
    name: `Player ${publicId.slice(0, 6)}`,
  });
  return {
    capabilities: { away: true, demo: true },
    snapshot: () => store.get(),
    subscribe: (listener) => store.subscribe(listener),
    warmSignIn: () => undefined,
    async signIn() {
      if (store.get().account.kind === "signed-in") return;
      step = 0;
      store.set({ ...signedInSnapshot(), suspended: store.get().suspended });
      start();
    },
    async signOut() {
      stop();
      store.set({ ...signedOutSnapshot(), suspended: store.get().suspended });
    },
    refresh: () => undefined,
    async addFriend(publicId) {
      const snapshot = store.get();
      if (snapshot.account.kind !== "signed-in")
        throw new Error("Sign in first");
      const incoming = snapshot.incoming.find(
        (card) => card.publicId === publicId,
      );
      // Accepting a request makes a friend; asking someone new is a request that waits for them.
      if (incoming) {
        store.set({
          ...snapshot,
          incoming: snapshot.incoming.filter(
            (card) => card.publicId !== publicId,
          ),
          buddies: [...snapshot.buddies, { ...incoming, status: "online" }],
        });
        return;
      }
      if (
        snapshot.buddies.some((buddy) => buddy.publicId === publicId) ||
        snapshot.outgoing.some((card) => card.publicId === publicId)
      )
        return;
      store.set({
        ...snapshot,
        outgoing: [...snapshot.outgoing, pendingCard(publicId)],
      });
    },
    async removeFriend(publicId) {
      const snapshot = store.get();
      const drop = (card: PlayerCard) => card.publicId !== publicId;
      store.set({
        ...snapshot,
        buddies: snapshot.buddies.filter(drop),
        incoming: snapshot.incoming.filter(drop),
        outgoing: snapshot.outgoing.filter(drop),
      });
    },
    async dismissInvite(id) {
      const snapshot = store.get();
      store.set({
        ...snapshot,
        invites: snapshot.invites.filter((invite) => invite.id !== id),
      });
    },
    setSuspended: (suspended) => {
      if (store.get().suspended !== suspended) store.patch({ suspended });
    },
    setMode: () => undefined,
    dispose() {
      stop();
      store.clear();
    },
  };
}
