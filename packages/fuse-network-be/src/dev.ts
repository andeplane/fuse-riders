import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  createRoomServer,
  type RoomServer,
  type HttpExtension,
} from "./http.js";
import { LocalRoomBus, MemoryRoomDatabase } from "./memory-database.js";
import { RoomGateway } from "./gateway.js";
import { RoomStore } from "./room-store.js";

export interface DevRoomServiceOptions {
  httpExtension?: (store: RoomStore) => HttpExtension;
  /** Built frontend to serve beside the room API, e.g. `dist`. */
  staticDirectory?: string;
  /** Extra page origins allowed besides same-origin loopback pages. */
  allowedOrigins?: readonly string[];
  now?: () => number;
  /** Room capacity and its refusal text; see `RoomStoreDependencies`. */
  maxGuests?: number;
  fullMessage?: string;
}
export interface DevRoomService {
  server: RoomServer;
  gateway: RoomGateway;
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A page served by this loopback service itself, or the LAN dev server's proxy, which rewrites Origin to this service. */
function sameLoopbackOrigin(origin: string, req: IncomingMessage): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  // Requiring a loopback hostname keeps a DNS-rebound page (whose Origin also matches Host) out.
  return (
    parsed.protocol === "http:" &&
    LOOPBACK_HOSTS.has(parsed.hostname) &&
    parsed.host === req.headers.host
  );
}

/**
 * The production room protocol (RoomStore + RoomGateway) over in-memory metadata and a single-process bus.
 * Serves `pnpm dev`, `pnpm dev:online` and the browser smokes; rooms disappear when the process exits.
 */
export function createDevRoomService(
  options: DevRoomServiceOptions = {},
): DevRoomService {
  const now = options.now ?? Date.now;
  const store = new RoomStore(new MemoryRoomDatabase(), {
    now,
    id: randomUUID,
    maxGuests: options.maxGuests,
    fullMessage: options.fullMessage,
  });
  const gateway = new RoomGateway(
    `local-${randomUUID()}`,
    store,
    new LocalRoomBus(),
    {
      now,
      id: randomUUID,
      error: (kind, error) =>
        console.error(
          JSON.stringify({
            kind,
            errorType: error instanceof Error ? error.name : "unknown",
          }),
        ),
    },
  );
  const extra = new Set(
    (options.allowedOrigins ?? []).map((value) => new URL(value).origin),
  );
  const server = createRoomServer({
    store,
    gateway,
    now,
    extension: options.httpExtension?.(store),
    allowOrigin: (origin, req) =>
      extra.has(origin) || sameLoopbackOrigin(origin, req),
    clientAddress: (req) => req.socket.remoteAddress ?? "local",
    ...(options.staticDirectory
      ? { staticDirectory: options.staticDirectory }
      : {}),
  });
  return {
    server,
    gateway,
    close: async () => {
      await gateway.stop();
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      // Neither a backgrounded phone tab's WebSocket nor an idle keep-alive may hold a dev restart open.
      server.terminateSockets();
      server.closeAllConnections();
      await closed;
    },
  };
}

/** `--port`, `--host` and `--static` from the command line, for a game's own dev entry point. */
export function runDevRoomService(
  options: DevRoomServiceOptions & { argv?: readonly string[] } = {},
): DevRoomService {
  const argv = options.argv ?? process.argv;
  const argument = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index > 0 ? argv[index + 1] : undefined;
  };
  const port = Number(argument("port") ?? process.env.PORT ?? 8787),
    host = argument("host") ?? "127.0.0.1";
  const staticDirectory = argument("static") ?? options.staticDirectory;
  const service = createDevRoomService({
    ...options,
    ...(staticDirectory ? { staticDirectory } : {}),
  });
  service.server.listen(port, host, () =>
    console.log(
      `Local room service: http://${host === "127.0.0.1" ? "localhost" : host}:${port}/ (in-memory rooms${staticDirectory ? `, serving ${staticDirectory}` : ""})`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void service.close().finally(() => process.exit(0));
    });
  return service;
}
