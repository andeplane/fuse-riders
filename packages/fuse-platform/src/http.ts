import type { IncomingMessage } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import { LEGACY_GAME_ID } from "./game.js";
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
