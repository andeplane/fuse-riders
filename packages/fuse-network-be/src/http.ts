import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { AdmissionGate } from "./admission-gate.js";
import {
  RoomError,
  RoomFullError,
  digest,
  peerId,
  validCode,
  validToken,
  type RoomStore,
} from "./room-store.js";
import type { RoomGateway } from "./gateway.js";
import {
  AUTH_DEADLINE_MS,
  REFUSED_CLOSE_GRACE_MS,
  readAuthFrame,
} from "./socket-auth.js";
import {
  CLOSE_ROOM_ENDED,
  CLOSE_ROOM_FULL,
  CLOSE_UNAUTHENTICATED,
  DEFAULT_ICE_SERVERS,
} from "fuse-network-protocol";

/** Optional game-owned HTTP routes, behind the common Origin and error boundaries. */
export interface HttpExtension {
  methods?: readonly string[];
  headers?: readonly string[];
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    clientAddress: string,
  ): Promise<boolean>;
}
export interface RoomHttpOptions {
  extension?: HttpExtension;
  store: RoomStore;
  gateway: RoomGateway;
  /** Decides a request's Origin header; WebSocket upgrades must always carry an allowed one. */
  allowOrigin: (origin: string, req: IncomingMessage) => boolean;
  /** Rate-limit identity for room creation and admission failures. */
  clientAddress: (req: IncomingMessage) => string;
  now?: () => number;
  /** Runs the socket authentication deadline and the refused-socket cut-off; returns the cancellation. Defaults to an unreferenced timer. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
  /** Structured operational log. Entries never carry a request URL, a token or a frame. */
  log?: (entry: Record<string, unknown>) => void;
  /**
   * LEGACY-QUERY-TOKEN — every site of the window carries this tag; `grep -rn LEGACY-QUERY-TOKEN` lists what to delete.
   * DEPRECATED rollout window (#256 S3, docs/online/TOKEN-TRANSPORT.md): also admit a room socket whose token is in
   * `?token=`, as clients built before the first-frame handshake send it. Off unless the deployment asks for it.
   * Remove this option, its block in the upgrade handler and its tests once no client sends the old form.
   */
  legacyQueryToken?: boolean;
  /** Local development only: serve this built frontend with single-page fallback. Production serves no files. */
  staticDirectory?: string;
  /** The deployed source revision, reported by the health route so a frontend release can wait for the backend it needs. */
  revision?: string;
}

const ROOM_ROUTE = /^\/api\/rooms\/([A-Z]{2}[0-9]{2})\/(end|ice|ws)$/;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const bearer = (req: IncomingMessage): string =>
  req.headers.authorization?.replace(/^Bearer /, "") ?? "";

async function serveStatic(
  root: string,
  pathname: string,
  method: string,
  res: ServerResponse,
): Promise<boolean> {
  if (method !== "GET" && method !== "HEAD") return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const base = path.resolve(root);
  let file = path.resolve(base, `.${decoded}`);
  if (file !== base && !file.startsWith(base + path.sep)) return false;
  let info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) {
    // Navigations fall back to the app shell; a missing asset stays a 404.
    if (path.extname(decoded)) return false;
    file = path.join(base, "index.html");
    info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) return false;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": body.length,
  });
  res.end(method === "HEAD" ? undefined : body);
  return true;
}

export interface RoomServer extends Server {
  /** Drops open WebSockets without a close handshake, so shutdown cannot wait on an unresponsive client. */
  terminateSockets(): void;
}

/** The room service's HTTP and WebSocket surface, shared by the Cloud Run service and the local development service. */
export function createRoomServer(options: RoomHttpOptions): RoomServer {
  const { store, gateway } = options,
    now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref();
      return () => clearTimeout(timer);
    });
  // Never log requests, query strings, room tokens or raw transport frames.
  const log =
    options.log ??
    ((entry: Record<string, unknown>) => console.error(JSON.stringify(entry)));
  const logFailure = (kind: string, error: unknown) =>
    log({
      kind,
      errorType: error instanceof Error ? error.name : "unknown",
      code: (error as { code?: unknown })?.code,
    });
  const admissions = new AdmissionGate(store.database, now);
  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const origin = req.headers.origin;
    if (origin && !options.allowOrigin(origin, req)) {
      res.writeHead(403);
      res.end("Origin denied");
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Methods",
        ["GET", "POST", "OPTIONS", ...(options.extension?.methods ?? [])].join(
          ", ",
        ),
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        [
          "Content-Type",
          "Authorization",
          ...(options.extension?.headers ?? []),
        ].join(", "),
      );
      // `/ice` carries `Authorization`, so a cross-origin page preflights it on every admission without this.
      res.setHeader("Access-Control-Max-Age", "600");
      res.writeHead(204);
      res.end();
      return;
    }
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url ?? "/", "http://gateway");
      if (url.pathname === "/api/health" || url.pathname === "/healthz") {
        json({
          ok: true,
          ...(options.revision ? { revision: options.revision } : {}),
        });
        return;
      }
      if (url.pathname === "/api/ready" || url.pathname === "/readyz") {
        json(
          {
            ok: gateway.state !== "failed",
            state: gateway.state,
            connections: gateway.connections,
          },
          gateway.state === "failed" ? 503 : 200,
        );
        return;
      }
      if (url.pathname === "/api/rooms" && req.method === "POST") {
        // The game rides in the query, not a body, so creation stays a simple request with no CORS preflight.
        // Absent means `LEGACY_GAME_ID`: a page from before rooms carried a game. Checked before the creation budget.
        const gameId = url.searchParams.get("gameId") ?? undefined;
        if (gameId !== undefined && !store.gameIds.has(gameId)) {
          json({ error: "Unknown game" }, 400);
          return;
        }
        if (
          !(await store.database.allowance(
            digest(options.clientAddress(req)),
            now(),
            30,
          ))
        ) {
          json({ error: "Room creation limit; try later" }, 429);
          return;
        }
        const token = randomBytes(32).toString("hex"),
          code = await store.createAvailable(token, undefined, gameId);
        json({ code, token }, 201);
        return;
      }
      const route = url.pathname.match(ROOM_ROUTE);
      if (route?.[2] === "end" && req.method === "POST") {
        await store.end(route[1]!, bearer(req));
        json({ ok: true });
        return;
      }
      if (route?.[2] === "ice") {
        // The token is a bearer credential: a query string would put it in every access log on the way here.
        const token = bearer(req);
        if (!validToken(token)) {
          json({ error: "Invalid identity" }, 401);
          return;
        }
        const room = await store.get(route[1]!),
          member = room.members[peerId(token)];
        if (!member || member.expiresAt <= now()) {
          json({ error: "Join the room first" }, 403);
          return;
        }
        json({ iceServers: DEFAULT_ICE_SERVERS, relayConfigured: false });
        return;
      }
      if (await options.extension?.handle(req, res, options.clientAddress(req)))
        return;
      if (
        url.pathname !== "/api" &&
        !url.pathname.startsWith("/api/") &&
        options.staticDirectory &&
        (await serveStatic(
          options.staticDirectory,
          url.pathname,
          req.method ?? "GET",
          res,
        ))
      )
        return;
      json({ error: "Not found" }, 404);
    } catch (error) {
      logFailure("http-operation", error);
      json(
        {
          error:
            error instanceof RoomError
              ? error.message
              : "Room service unavailable",
        },
        error instanceof RoomError ? error.status : 503,
      );
    }
  };
  const server = createServer((req, res) => {
    // node:http drops the handler's promise. What rejects here is whatever the boundary above could
    // not answer, so it must neither hang nor become an unhandled rejection that ends the process.
    // A failure before the response started (the Origin decision threw) still gets a status; one
    // after it started cannot, so that connection is dropped. The body never carries the error.
    handle(req, res).catch((error: unknown) => {
      logFailure("http-handler", error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Room service unavailable" }));
      } catch {
        // A header set before the failure can make even this answer unwritable.
        res.destroy();
      }
    });
  });
  let legacyUses = 0,
    legacyLoggedAt = Number.NEGATIVE_INFINITY;
  // LEGACY-QUERY-TOKEN: DEPRECATED rollout window — see `legacyQueryToken`. At most one line a minute, and only a count.
  const deprecatedQueryToken = () => {
    legacyUses++;
    if (now() - legacyLoggedAt < 60_000) return;
    legacyLoggedAt = now();
    log({
      kind: "deprecated-query-token",
      severity: "WARNING",
      uses: legacyUses,
    });
    legacyUses = 0;
  };
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 32_000,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    const forbidden = () => {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    };
    // An unparsable request target must be refused, not thrown: this handler runs outside the HTTP try/catch.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://gateway");
    } catch {
      forbidden();
      return;
    }
    const origin = req.headers.origin,
      route = url.pathname.match(ROOM_ROUTE);
    if (
      !origin ||
      !options.allowOrigin(origin, req) ||
      route?.[2] !== "ws" ||
      !validCode(route[1]!)
    ) {
      forbidden();
      return;
    }
    const code = route[1]!;
    // The request carries no credential: the socket authenticates with its first frame, inside the admission
    // slot taken below, so unauthenticated sockets are bounded per address and in total like any other admission.
    let queryToken: string | undefined;
    // LEGACY-QUERY-TOKEN: DEPRECATED rollout window — see `legacyQueryToken`. Delete this block (and `queryToken`) with the option.
    if (options.legacyQueryToken && url.searchParams.has("token")) {
      queryToken = url.searchParams.get("token") ?? "";
      if (!validToken(queryToken)) {
        forbidden();
        return;
      }
      deprecatedQueryToken();
    }
    let upgraded: WebSocket | undefined;
    socket.on("error", () => socket.destroy());
    void admissions
      .run(
        options.clientAddress(req),
        () =>
          new Promise<void>((resolve, reject) => {
            if (socket.destroyed) {
              reject(new RoomError(503, "Connection closed"));
              return;
            }
            // ws can reject malformed upgrade headers without invoking its callback.
            // Release the pending slot when that rejected connection closes.
            const aborted = () =>
              reject(new RoomError(400, "Invalid WebSocket upgrade"));
            socket.once("close", aborted);
            sockets.handleUpgrade(req, socket, head, (ws) => {
              socket.off("close", aborted);
              upgraded = ws;
              let connectionId: string | undefined,
                closed = false,
                pending: string[] = [],
                // "auth": only an `auth` frame is read. "rejected": nothing is read again.
                // LEGACY-QUERY-TOKEN: without the window the initial phase is always "auth".
                phase: "auth" | "admitted" | "rejected" =
                  queryToken === undefined ? "auth" : "admitted",
                cancelDeadline: (() => void) | undefined;
              const refuse = (error: RoomError) => {
                phase = "rejected";
                cancelDeadline?.();
                reject(error);
              };
              const admit = (token: string, gameId?: string) => {
                phase = "admitted";
                cancelDeadline?.();
                void gateway
                  .connect(code, token, ws, gameId)
                  .then((id) => {
                    connectionId = id;
                    if (closed) {
                      void gateway.disconnect(id);
                      resolve();
                      return;
                    }
                    for (const data of pending) void gateway.receive(id, data);
                    pending = [];
                    resolve();
                  })
                  .catch(reject);
              };
              if (phase === "auth")
                cancelDeadline = schedule(() => {
                  if (phase === "auth")
                    refuse(new RoomError(401, "Authentication timed out"));
                }, AUTH_DEADLINE_MS);
              ws.on("message", (raw, binary) => {
                if (phase === "rejected") return;
                if (phase === "auth") {
                  // Whatever arrives first is the authentication attempt; it is never handed to the gateway.
                  const frame = readAuthFrame(raw.toString(), binary);
                  if (frame === undefined)
                    // Nothing about the frame is echoed or logged.
                    refuse(new RoomError(401, "Authentication required"));
                  else admit(frame.token, frame.gameId);
                  return;
                }
                if (binary) {
                  ws.close(1003, "Text frames required");
                  return;
                }
                const data = raw.toString();
                if (connectionId) void gateway.receive(connectionId, data);
                else if (pending.length < 4) pending.push(data);
                else ws.close(1008, "Wait for welcome");
              });
              ws.on("close", () => {
                closed = true;
                pending = [];
                // Leaving before authenticating frees the slot and is not a failure. Charging it would stop nobody —
                // a slot can be held to the deadline and then authenticated for free — and it would land on honest
                // pages: one closed, frozen or dropped within a round trip of the upgrade.
                if (phase === "auth") {
                  phase = "rejected";
                  cancelDeadline?.();
                  resolve();
                }
                if (connectionId) void gateway.disconnect(connectionId);
              });
              ws.on("error", () => {
                // `ws` reports a frame it will not parse (a protocol violation, or one past `maxPayload`) here, not a
                // network drop. As a first frame that is a bad authentication attempt like any other.
                if (phase === "auth")
                  refuse(new RoomError(401, "Authentication required"));
                ws.close();
              });
              // LEGACY-QUERY-TOKEN: admitted without an `auth` frame.
              if (queryToken !== undefined) admit(queryToken);
            });
          }),
      )
      .catch((error) => {
        logFailure("admission", error);
        if (upgraded) {
          const refused = upgraded;
          refused.close(
            !(error instanceof RoomError)
              ? 4000
              : error instanceof RoomFullError
                ? CLOSE_ROOM_FULL
                : error.status === 404
                  ? CLOSE_ROOM_ENDED
                  : error.status === 401
                    ? CLOSE_UNAUTHENTICATED
                    : 4000,
            error instanceof RoomError
              ? error.message
              : "Room service unavailable",
          );
          // `ws` waits 30 s for the peer's close frame. A refused socket holds no admission slot by then, but it
          // still occupies one of the platform's concurrent requests; a peer that never answers is cut off.
          // Only refused sockets: an admitted socket's close handshake is left to run.
          if (refused.readyState !== refused.CLOSED)
            refused.once(
              "close",
              schedule(() => refused.terminate(), REFUSED_CLOSE_GRACE_MS),
            );
        } else if (!socket.destroyed)
          socket.end(
            `HTTP/1.1 ${error instanceof RoomError && error.status === 429 ? "429 Too Many Requests" : "503 Service Unavailable"}\r\nConnection: close\r\n\r\n`,
          );
      });
  });
  server.on("close", () => {
    sockets.close();
  });
  return Object.assign(server, {
    terminateSockets: () => {
      for (const client of sockets.clients) client.terminate();
    },
  });
}
