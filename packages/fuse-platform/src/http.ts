import type { IncomingMessage } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import { LEGACY_GAME_ID } from "./game.js";
import type { FriendsStore } from "./friends.js";
import type { HistoryStore } from "./history.js";
import type { IdentityVerifier } from "./identity.js";

const MAX_BODY_BYTES = 256_000,
  BODY_TIMEOUT_MS = 10_000;
const bearer = (req: IncomingMessage): string =>
  req.headers.authorization?.replace(/^Bearer /, "") ?? "";
/** A bounded JSON body: the limit is enforced while reading, so a lying Content-Length cannot buy memory. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  // A body this small arrives at once; a sender trickling it is cut off rather than holding a connection open.
  const slow = setTimeout(
    () => req.destroy(new RoomError(408, "Request too slow")),
    BODY_TIMEOUT_MS,
  );
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new RoomError(413, "Request too large");
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(slow);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoomError(400, "Invalid JSON");
  }
}

/** `?before=` pages backwards from a listed `endedAt`; null is a malformed cursor. */
function pageCursor(url: URL): number | undefined | null {
  const before = url.searchParams.get("before");
  if (before === null) return undefined;
  const cursor = Number(before);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

/**
 * `/api/games/{gameId}/…` addresses one game; the same routes without the prefix are the legacy game's, as they were
 * before there were games. Returns the game and the route as it reads without the prefix.
 */
const GAME_ROUTE = /^\/api\/games\/([^/]*)(\/.*)$/;
export function gameRoute(pathname: string): { gameId: string; path: string } {
  const scoped = pathname.match(GAME_ROUTE);
  return scoped
    ? { gameId: scoped[1]!, path: `/api${scoped[2]!}` }
    : { gameId: LEGACY_GAME_ID, path: pathname };
}
const HISTORY_ROUTE =
  /^\/api\/(?:rooms\/[A-Z]{2}[0-9]{2}\/(?:results|round-results)|me\/round-results|leaderboard|matches|me|me\/matches)$/;

/**
 * Match history, accounts and ratings, mounted behind the networking service's Origin and error boundaries. The
 * account (`/api/me`, the username) is every game's; ratings, leaderboards, results and match history are per game.
 * An unknown game is refused with 404 before anything else is read.
 */
export function createHistoryHttp(
  store: HistoryStore,
  identity: IdentityVerifier,
): HttpExtension {
  return {
    methods: ["PUT"],
    headers: ["X-Fuse-Identity"],
    async handle(req, res, clientAddress) {
      const url = new URL(req.url ?? "/", "http://gateway");
      const routed = gameRoute(url.pathname);
      if (!HISTORY_ROUTE.test(routed.path)) return false;
      const history = store.game(routed.gameId),
        pathname = routed.path;
      const route = pathname.match(
        /^\/api\/rooms\/([A-Z]{2}[0-9]{2})\/(results|round-results)$/,
      );
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      // The room token says which seat is reporting; the optional identity header says whose account that seat is.
      // An identity that does not verify is a guest's report, never a refusal: signing in must not be able to cost a rider their result.
      if (route && req.method === "POST") {
        // The room token is checked first, so a stranger can buy neither a body read nor a signature verification.
        const reporter = await history.admit(
            route[1]!,
            bearer(req),
            clientAddress,
            route[2] === "round-results",
          ),
          body = await readJson(req);
        const header = req.headers["x-fuse-identity"],
          uid = typeof header === "string" ? await identity(header) : undefined;
        // A temporarily unverifiable signed-in round reporter must not be settled as a guest.
        const result =
          body && typeof body === "object" && "result" in body
            ? history.parseResult(body.result)
            : undefined;
        if (
          !result ||
          (route[2] === "round-results") !== (result.round !== undefined)
        )
          throw new RoomError(400, "Wrong result kind");
        if (header && !uid && result.round !== undefined)
          throw new RoomError(503, "Identity unavailable; retry round report");
        json(await history.submit(reporter, body, uid));
        return true;
      }
      if (pathname === "/api/me/round-results" && req.method === "POST") {
        const header = req.headers["x-fuse-identity"];
        if (typeof header !== "string" || !header)
          throw new RoomError(401, "Sign in first");
        const uid = await identity(header);
        if (!uid)
          throw new RoomError(503, "Identity unavailable; retry round report");
        const reporter = await history.admitSolo(uid, clientAddress);
        json(await history.submitSolo(reporter, await readJson(req), uid));
        return true;
      }
      // Public like the leaderboard: no sign-in, and an optional one only names the caller's own seat.
      if (pathname === "/api/matches" && req.method === "GET") {
        const cursor = pageCursor(url);
        if (cursor === null) {
          json({ error: "Invalid cursor" }, 400);
          return true;
        }
        const token = bearer(req),
          uid = token ? await identity(token) : undefined;
        json(await history.feed(clientAddress, uid, cursor));
        return true;
      }
      if (pathname === "/api/leaderboard" && req.method === "GET") {
        const token = bearer(req),
          uid = token ? await identity(token) : undefined;
        json({ players: await history.leaderboard(clientAddress, uid) });
        return true;
      }
      if (
        pathname === "/api/me" &&
        (req.method === "GET" || req.method === "PUT")
      ) {
        const uid = await identity(bearer(req));
        if (!uid) {
          json({ error: "Sign in first" }, 401);
          return true;
        }
        json(
          req.method === "PUT"
            ? await history.rename(uid, await readJson(req))
            : { profile: (await history.profile(uid)) ?? null },
        );
        return true;
      }
      if (pathname === "/api/me/matches" && req.method === "GET") {
        const uid = await identity(bearer(req));
        if (!uid) {
          json({ error: "Sign in first" }, 401);
          return true;
        }
        const cursor = pageCursor(url);
        if (cursor === null) {
          json({ error: "Invalid cursor" }, 400);
          return true;
        }
        json(await history.history(uid, cursor));
        return true;
      }
      return false;
    },
  };
}

const FRIENDS_ROUTE =
  /^\/api\/(?:friends(?:\/sync|\/invites\/[a-f0-9]{32}|\/[a-f0-9]{20})?|rooms\/[A-Z]{2}[0-9]{2}\/invites)$/;

/**
 * Friends, presence and invites: account routes, so shared by every game and never under `/api/games/:gameId/`.
 * Every route needs a sign-in except the room invite, which like a result report is proven by the room token
 * first and the sign-in second: nobody outside the room can make it read a body.
 */
export function createFriendsHttp(
  store: FriendsStore,
  identity: IdentityVerifier,
): HttpExtension {
  return {
    methods: ["DELETE"],
    headers: ["X-Fuse-Identity"],
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://gateway"),
        pathname = url.pathname;
      if (!FRIENDS_ROUTE.test(pathname)) return false;
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const invite = pathname.match(
        /^\/api\/rooms\/([A-Z]{2}[0-9]{2})\/invites$/,
      );
      if (invite) {
        if (req.method !== "POST") return false;
        const header = req.headers["x-fuse-identity"];
        const uid =
          typeof header === "string" && header
            ? await identity(header)
            : undefined;
        if (!uid) throw new RoomError(401, "Sign in first");
        json(
          await store.invite(invite[1]!, bearer(req), uid, await readJson(req)),
        );
        return true;
      }
      const uid = await identity(bearer(req));
      if (!uid) {
        json({ error: "Sign in first" }, 401);
        return true;
      }
      if (pathname === "/api/friends/sync" && req.method === "POST") {
        json(await store.sync(uid, await readJson(req)));
        return true;
      }
      if (pathname === "/api/friends" && req.method === "POST") {
        json(await store.add(uid, await readJson(req)));
        return true;
      }
      const friend = pathname.match(/^\/api\/friends\/([a-f0-9]{20})$/);
      if (friend && req.method === "DELETE") {
        json(await store.remove(uid, friend[1]!));
        return true;
      }
      const dismiss = pathname.match(
        /^\/api\/friends\/invites\/([a-f0-9]{32})$/,
      );
      if (dismiss && req.method === "DELETE") {
        await store.dismissInvite(uid, dismiss[1]!);
        json({ dismissed: true });
        return true;
      }
      return false;
    },
  };
}

/** One extension out of several: the first that handles a request answers it; methods and headers are the union. */
export function composeHttp(
  ...extensions: readonly HttpExtension[]
): HttpExtension {
  return {
    methods: [...new Set(extensions.flatMap((e) => e.methods ?? []))],
    headers: [...new Set(extensions.flatMap((e) => e.headers ?? []))],
    async handle(req, res, clientAddress) {
      for (const extension of extensions)
        if (await extension.handle(req, res, clientAddress)) return true;
      return false;
    },
  };
}

/** Every platform route: history and accounts, then friends. */
export function createPlatformHttp(options: {
  history: HistoryStore;
  friends: FriendsStore;
  identity: IdentityVerifier;
}): HttpExtension {
  return composeHttp(
    createHistoryHttp(options.history, options.identity),
    createFriendsHttp(options.friends, options.identity),
  );
}
