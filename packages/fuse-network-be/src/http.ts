import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  RoomError,
  digest,
  peerId,
  validCode,
  validToken,
  type RoomStore,
} from "./room-store.js";
import type { RoomGateway } from "./gateway.js";
import { DEFAULT_ICE_SERVERS } from "fuse-network-protocol";

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
  /** Rate-limit identity for room creation. */
  clientAddress: (req: IncomingMessage) => string;
  now?: () => number;
  /** Local development only: serve this built frontend with single-page fallback. Production serves no files. */
  staticDirectory?: string;
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
// Never log requests, query strings, room tokens or raw transport frames.
const logFailure = (kind: string, error: unknown) =>
  console.error(
    JSON.stringify({
      kind,
      errorType: error instanceof Error ? error.name : "unknown",
      code: (error as { code?: unknown })?.code,
    }),
  );

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
  const server = createServer(async (req, res) => {
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
        json({ ok: true });
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
          code = await store.createAvailable(token);
        json({ code, token }, 201);
        return;
      }
      const route = url.pathname.match(ROOM_ROUTE);
      if (route?.[2] === "end" && req.method === "POST") {
        await store.end(
          route[1]!,
          req.headers.authorization?.replace(/^Bearer /, "") ?? "",
        );
        json({ ok: true });
        return;
      }
      if (route?.[2] === "ice") {
        const token = url.searchParams.get("token") ?? "";
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
  });
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
      route = url.pathname.match(ROOM_ROUTE),
      token = url.searchParams.get("token") ?? "";
    if (
      !origin ||
      !options.allowOrigin(origin, req) ||
      route?.[2] !== "ws" ||
      !validCode(route[1]!) ||
      !validToken(token)
    ) {
      forbidden();
      return;
    }
    const code = route[1]!;
    sockets.handleUpgrade(req, socket, head, (ws) => {
      let connectionId: string | undefined,
        closed = false,
        pending: string[] = [];
      ws.on("message", (raw, binary) => {
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
        if (connectionId) void gateway.disconnect(connectionId);
      });
      ws.on("error", () => {
        ws.close();
      });
      void gateway
        .connect(code, token, ws)
        .then((id) => {
          connectionId = id;
          if (closed) {
            void gateway.disconnect(id);
            return;
          }
          for (const data of pending) void gateway.receive(id, data);
          pending = [];
        })
        .catch((error) => {
          logFailure("admission", error);
          ws.close(
            error instanceof RoomError && error.status === 404 ? 4004 : 4000,
            error instanceof RoomError
              ? error.message
              : "Room service unavailable",
          );
        });
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
