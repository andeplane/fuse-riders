import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRoomServer, type RoomServer } from './http.js';
import { listenFree } from './listen-free.js';
import { LocalRoomBus, MemoryHistoryDatabase, MemoryRoomDatabase } from './memory-database.js';
import { HistoryStore } from './history.js';
import { createIdentityVerifier, type IdentityVerifier } from './identity.js';
import { FIREBASE_PROJECT_ID } from '../shared/firebase-config.js';
import { RoomGateway } from './gateway.js';
import { RoomStore } from './room-store.js';

export interface DevRoomServiceOptions {
  /** Built frontend to serve beside the room API, e.g. `dist`. */
  staticDirectory?: string;
  /** Extra page origins allowed besides same-origin loopback pages. */
  allowedOrigins?: readonly string[];
  now?: () => number;
  /** Defaults to real Firebase verification, so a local sign-in works; tests pass a fake. */
  identity?: IdentityVerifier;
}
export interface DevRoomService { server: RoomServer; gateway: RoomGateway; close(): Promise<void> }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A page served by this loopback service itself, or the LAN dev server's proxy, which rewrites Origin to this service. */
function sameLoopbackOrigin(origin: string, req: IncomingMessage): boolean {
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  // Requiring a loopback hostname keeps a DNS-rebound page (whose Origin also matches Host) out.
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname) && parsed.host === req.headers.host;
}

/**
 * The production room protocol (RoomStore + RoomGateway) over in-memory metadata and a single-process bus.
 * Serves `npm run dev`, `npm run dev:online` and the browser smokes; rooms disappear when the process exits.
 */
export function createDevRoomService(options: DevRoomServiceOptions = {}): DevRoomService {
  const now = options.now ?? Date.now;
  const store = new RoomStore(new MemoryRoomDatabase(), { now, id: randomUUID });
  const gateway = new RoomGateway(`local-${randomUUID()}`, store, new LocalRoomBus(), {
    now, id: randomUUID,
    error: (kind, error) => console.error(JSON.stringify({ kind, errorType: error instanceof Error ? error.name : 'unknown' })),
  });
  const extra = new Set((options.allowedOrigins ?? []).map(value => new URL(value).origin));
  const history = new HistoryStore(new MemoryHistoryDatabase(), store, now);
  const server = createRoomServer({
    store, gateway, now, history, identity: options.identity ?? createIdentityVerifier(FIREBASE_PROJECT_ID),
    allowOrigin: (origin, req) => extra.has(origin) || sameLoopbackOrigin(origin, req),
    clientAddress: req => req.socket.remoteAddress ?? 'local',
    ...(options.staticDirectory ? { staticDirectory: options.staticDirectory } : {}),
  });
  return {
    server, gateway,
    close: async () => {
      await gateway.stop();
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      // Neither a backgrounded phone tab's WebSocket nor an idle keep-alive may hold a dev restart open.
      server.terminateSockets(); server.closeAllConnections();
      await closed;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : undefined; };
  const port = Number(argument('port') ?? process.env.PORT ?? 8787), host = argument('host') ?? '127.0.0.1';
  const staticDirectory = argument('static') ?? fileURLToPath(new URL('../../dist', import.meta.url));
  const service = createDevRoomService({ staticDirectory });
  // The port asked for is where the search starts, not a demand: another worktree's service may already hold it.
  const actual = await listenFree(service.server, port, host);
  if (actual !== port) console.log(`Port ${port} is in use; using ${actual} instead.`);
  console.log(`Local room service: http://${host === '127.0.0.1' ? 'localhost' : host}:${actual}/ (in-memory rooms, serving ${staticDirectory})`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void service.close().finally(() => process.exit(0)); });
}
