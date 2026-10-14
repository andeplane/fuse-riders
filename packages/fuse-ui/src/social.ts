import {
  createAccountDialog,
  type AccountAuth,
  type AccountProfile,
} from "./account.js";
import { el } from "./dom.js";
import { createFriendsPanel } from "./social-friends.js";
import * as account from "./browser-account.js";
import {
  MAX_ACCOUNT_NAME,
  suggestAccountName,
  validAccountName,
} from "./account-name.js";
import { safeStorage, type SafeStorage } from "./safe-storage.js";
import { PORTAL_GAMES, type PortalGame } from "./portal.js";
import {
  createEndpoints,
  validRoomCode,
  type RoomTransport,
  type TransportEvents,
} from "fuse-network-fe";
import type { NotificationApi } from "./friends-notify.js";
import { newRating, type Rating } from "fuse-platform/rating";

interface Player {
  playerId: string;
  name: string;
  matchPlacement: number;
  roundWins: number;
}
interface Match {
  id: string;
  endedAt: number;
  result: { players: Player[] };
  accounts?: Record<string, string>;
}
interface Profile extends AccountProfile {
  rating?: Rating;
}
interface RankedPlayer {
  publicId?: string;
  name: string;
  elo: number;
  rank: number;
}
export interface GameSocialOptions {
  gameId: string;
  base: string;
  apiOrigin?: string;
  document: Document;
  window: Pick<Window, "addEventListener" | "removeEventListener" | "focus"> & {
    location: {
      href: string;
      origin: string;
      assign(url: string): void;
      reload(): void;
    };
    localStorage: SafeStorage;
  };
  fetch: typeof fetch;
  track(event: string, props?: Record<string, unknown>): void;
  auth?: AccountAuth<account.Account>;
  storage?: SafeStorage;
  games?: readonly PortalGame[];
  notifications?: NotificationApi | undefined;
  pollMs?: number;
  clock?: {
    now(): number;
    schedule(callback: () => void, delayMs: number): () => void;
  };
}

/** Destination is validated against the site's game registry; credentials never appear in the URL. */
export function friendRoomUrl(
  options: {
    base: string;
    pageUrl: string;
    games: readonly PortalGame[];
  },
  code: string,
  gameId: string,
): string {
  if (!validRoomCode(code)) throw new Error("Invalid room code");
  const game = options.games.find((entry) => entry.id === gameId);
  // Pig is the unlisted template, but still a registered playable game.
  const path = game?.path ?? (gameId === "dice" ? "dice/" : undefined);
  if (!path || !/^[a-z][a-z0-9-]*\/$/.test(path))
    throw new Error("Unknown game");
  const page = new URL(options.pageUrl);
  const base =
    options.base === "./" || options.base === "" ? "../" : options.base;
  const url = new URL(base + path, page);
  if (url.origin !== page.origin) throw new Error("Invalid game origin");
  url.searchParams.set("room", code);
  if (page.searchParams.has("mute")) url.searchParams.set("mute", "");
  return url.href;
}

/** One account, friends graph and backend, with ratings/history scoped to the current game. */
export function createGameSocial(options: GameSocialOptions) {
  const doc = options.document,
    win = options.window;
  const storage = options.storage ?? safeStorage(() => win.localStorage);
  let username: string | undefined;
  const baseAuth = options.auth ?? {
    watch: account.watchAccount,
    token: account.identityToken,
    ready: account.accountReady,
    warm: account.warmAccount,
    signIn: account.signIn,
    signOut: account.signOut,
    remember: account.rememberUsername,
    failure: account.signInFailure,
  };
  const auth = {
    ...baseAuth,
    remember(name: string) {
      username = name;
      baseAuth.remember(name);
      friends.refresh();
    },
  };
  const base =
    options.base === "./" || options.base === "" ? "../" : options.base;
  const endpoints = createEndpoints(
    {
      basePath: new URL(base + options.gameId + "/", win.location.href)
        .pathname,
      apiOrigin: options.apiOrigin,
    },
    win.location.origin,
  );
  const gamePath = `/api/games/${options.gameId}`;
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    cls = "",
  ) => el(tag, text, cls, doc);
  const localName = () =>
    username ??
    account.accountUsername() ??
    storage.getItem(`${options.gameId}-player-name`);
  const friends = createFriendsPanel({
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
    gameName: (id) =>
      (options.games ?? PORTAL_GAMES).find((game) => game.id === id)?.name ??
      "a game",
    document: doc,
    window: win,
    ...("notifications" in options
      ? { notifications: options.notifications }
      : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    fetch: options.fetch,
    apiUrl: endpoints.apiUrl,
    storage,
    auth,
    identity: () => {
      const name = localName();
      return validAccountName(name) ? { name } : {};
    },
    join: (code, gameId) =>
      win.location.assign(
        friendRoomUrl(
          {
            base: options.base,
            pageUrl: win.location.href,
            games: options.games ?? PORTAL_GAMES,
          },
          code,
          gameId,
        ),
      ),
    signIn: () => profile.button.click(),
    track: options.track,
  });
  function players(match: Match): HTMLElement {
    const list = node("ol", "", "fui-social-results");
    for (const player of [...match.result.players].sort(
      (a, b) => a.matchPlacement - b.matchPlacement,
    )) {
      const row = node("li");
      row.append(
        node(
          "span",
          `#${player.matchPlacement} · ${player.name} · ${player.roundWins} round wins`,
        ),
      );
      const publicId = match.accounts?.[player.playerId];
      if (publicId) row.append(friends.friendButton(publicId));
      list.append(row);
    }
    return list;
  }
  const profile = createAccountDialog<
    account.Account,
    Profile,
    Match,
    RankedPlayer
  >({
    ...(options.clock ? { refreshClock: options.clock } : {}),
    document: doc,
    auth,
    fetch: options.fetch,
    historyUrl: (before) =>
      endpoints.apiUrl(
        `${gamePath}/me/matches${before === undefined ? "" : `?before=${before}`}`,
      ),
    matchesUrl: (before) =>
      endpoints.apiUrl(
        `${gamePath}/matches${before === undefined ? "" : `?before=${before}`}`,
      ),
    profileUrl: endpoints.apiUrl(`${gamePath}/me`),
    leaderboardUrl: endpoints.apiUrl(`${gamePath}/leaderboard`),
    localName,
    track: options.track,
    names: {
      valid: validAccountName,
      suggest: suggestAccountName,
      max: MAX_ACCOUNT_NAME,
    },
    rating: (value) => value?.rating?.value ?? newRating().value,
    avatar: () => node("span"),
    totals: ({ profile: value, matches }) => {
      const details = node("div");
      details.append(
        node(
          "p",
          `${Math.round(value?.rating?.value ?? newRating().value)} ELO · ${value?.rating?.games ?? 0} rated rounds`,
        ),
        node(
          "p",
          `${matches.length} recent matches. Open MATCHES to see results and add players as friends.`,
        ),
      );
      return details;
    },
    match: (entry, context) => {
      const row = node("li"),
        open = node(
          "button",
          `${new Date(entry.endedAt).toLocaleTimeString()} · ${entry.result.players.map((p) => p.name).join(", ")}`,
          "fui-button",
        );
      open.type = "button";
      open.onclick = context.open;
      row.append(open);
      return row;
    },
    matchDetail: players,
    leaderboard: (entries) => {
      const list = node("ol", "", "fui-social-results");
      for (const player of entries) {
        const row = node("li");
        row.append(
          node(
            "span",
            `#${player.rank} · ${player.name} · ${Math.round(player.elo)} ELO`,
          ),
        );
        if (player.publicId) row.append(friends.friendButton(player.publicId));
        list.append(row);
      }
      return list;
    },
    text: {
      title: "FUSE ACCOUNT",
      signedOutNote:
        "One Fuse account for every game: the same name, friends and sign-in. Match history and ratings belong to each game. Playing never needs an account.",
    },
  });
  const controls = node("nav", "", "fui-social");
  controls.setAttribute("aria-label", "Fuse account and friends");
  controls.append(
    profile.button,
    friends.button,
    profile.matchesButton,
    profile.leaderboardButton,
  );
  profile.dialog.classList.add("fui-social-dialog");
  friends.dialog.classList.add("fui-social-dialog");
  friends.banner.classList.add("fui-social-banner");
  const layer = node("div", "", "fui-app fui-social-layer");
  layer.append(profile.dialog, friends.dialog, friends.banner);
  doc.body.append(layer);
  let disposed = false,
    generation = 0,
    signedIn = false;
  const stopAuth = auth.watch((value) => {
    signedIn = value !== undefined;
    const mine = ++generation;
    username = undefined;
    if (!value) return;
    void auth
      .token()
      .then(async (token) => {
        if (!token) return;
        const response = await options.fetch(
          endpoints.apiUrl(`${gamePath}/me`),
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body: unknown = response.ok ? await response.json() : undefined;
        const name = (body as { profile?: { username?: unknown } } | undefined)
          ?.profile?.username;
        if (!disposed && mine === generation && validAccountName(name)) {
          username = name;
          auth.remember(name);
          friends.refresh();
        }
      })
      .catch(() => undefined);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation++;
    stopAuth();
    profile.dispose();
    friends.dispose();
    controls.remove();
    layer.remove();
  };
  // Room clients also reload on bfcache return: closed transports and disposed polling must restart together.
  win.addEventListener("pagehide", dispose, { once: true });
  win.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) win.location.reload();
  });
  return {
    /** Move these controls into the current header when a game's page is rebuilt. */
    element: () => controls,
    playerName: (fallback: string | null | undefined) =>
      localName() ?? fallback,
    friends,
    /** Ordinary result reports acquire the shared account identity at the HTTP boundary. */
    reportFetch: (async (input, init) => {
      const url = new URL(String(input), win.location.href);
      const expected = new URL(endpoints.apiUrl(`${gamePath}/me`));
      const headers = new Headers(init?.headers);
      if (
        url.origin === expected.origin &&
        url.pathname.startsWith(gamePath + "/") &&
        init?.method === "POST" &&
        /\/(round-results|results)$/.test(url.pathname)
      ) {
        // A failed token refresh must not silently turn a signed-in report into a guest report.
        const token = await auth.token();
        if (signedIn && !token)
          throw new Error("Sign-in unavailable; retry report");
        if (token) headers.set("X-Fuse-Identity", token);
      }
      return options.fetch(input, { ...init, headers });
    }) as typeof fetch,
    /** Wrap admission/close without putting account data in the mesh or changing the room runtime. */
    transport(
      code: string,
      token: string,
      events: TransportEvents,
      create: (events: TransportEvents) => RoomTransport,
    ): RoomTransport {
      let admitted = false;
      const clear = () => {
        if (admitted) {
          admitted = false;
          friends.setRoom(undefined);
        }
      };
      const transport = create({
        ...events,
        welcome(id, hostId) {
          admitted = true;
          friends.setRoom({
            code,
            memberId: id,
            gameId: options.gameId,
            token,
          });
          events.welcome(id, hostId);
        },
        ended() {
          clear();
          events.ended();
        },
        revoked() {
          clear();
          events.revoked();
        },
        terminated(reason) {
          clear();
          events.terminated(reason);
        },
      });
      return {
        get id() {
          return transport.id;
        },
        get hostId() {
          return transport.hostId;
        },
        get sentBytes() {
          return transport.sentBytes;
        },
        connect: () => transport.connect(),
        close: (farewell) => {
          clear();
          transport.close(farewell);
        },
        send: (id, data, limit) => transport.send(id, data, limit),
        sendFast: (id, bytes) => transport.sendFast(id, bytes),
        linked: (id) => transport.linked(id),
        explain: (id) => transport.explain(id),
        stats: () => transport.stats(),
      };
    },
    dispose,
  };
}
