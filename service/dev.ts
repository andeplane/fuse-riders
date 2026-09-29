import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createDevRoomService as createService,
  type DevRoomService,
  type DevRoomServiceOptions as NetworkOptions,
} from "fuse-network-be";
import { ROOM_LIMITS } from "./room-limits.js";
import { listenFree } from "./listen-free.js";
import {
  FriendsStore,
  HistoryStore,
  MemoryFriendsDatabase,
  MemoryHistoryDatabase,
  createPlatformHttp,
  createIdentityVerifier,
  type IdentityVerifier,
  type Platform,
} from "fuse-platform";
import { platform } from "./history.js";
import { FIREBASE_PROJECT_ID } from "../games/fuse-riders/src/shared/firebase-config.js";
export type { DevRoomService };
export interface DevRoomServiceOptions extends Omit<
  NetworkOptions,
  "httpExtension"
> {
  identity?: IdentityVerifier;
  /** The games served; every game this repo has by default (Cloud Run serves `platformFor(EXTRA_GAME_IDS)`). */
  platform?: Platform;
}

/** Game history and capacity on the generic in-memory signalling service. */
export function createDevRoomService(
  options: DevRoomServiceOptions = {},
): DevRoomService {
  const now = options.now ?? Date.now,
    games = options.platform ?? platform;
  return createService({
    ...ROOM_LIMITS,
    gameIds: games.gameIds,
    ...options,
    httpExtension: (store) => {
      const history = new MemoryHistoryDatabase(games, now);
      return createPlatformHttp({
        history: new HistoryStore(games, history, store, now),
        friends: new FriendsStore(
          games,
          history,
          new MemoryFriendsDatabase(),
          store,
          now,
        ),
        identity:
          options.identity ?? createIdentityVerifier(FIREBASE_PROJECT_ID),
      });
    },
  });
}

/**
 * What the service prints once it listens: every link on its own line, after the build output, so it can be
 * found and clicked. scripts/lib/server.ts reads the `Home:` line to learn which port the search ended on.
 */
export function devBanner(at: {
  port: number;
  actual: number;
  base: string;
  staticDirectory: string;
}): string {
  const { port, actual, base, staticDirectory } = at;
  return `
FUSE RIDERS — online rooms, locally
${actual === port ? "" : `\nPort ${port} is in use; using ${actual} instead.\n`}
Home:      ${base}/          (create or join a room, SIGN IN / MY GAMES)
Play solo: ${base}/?solo=1
Health:    ${base}/api/health

Rooms and match history are in memory and vanish when this stops. Serving ${staticDirectory}
`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argument = (name: string) => {
    const index = process.argv.indexOf(`--${name}`);
    return index > 0 ? process.argv[index + 1] : undefined;
  };
  const port = Number(argument("port") ?? process.env.PORT ?? 8787),
    host = argument("host") ?? "127.0.0.1";
  const staticDirectory =
    argument("static") ?? fileURLToPath(new URL("../dist", import.meta.url));
  // LAN pages need an explicit origin; binding to 0.0.0.0 alone does not grant it.
  const allowedOrigin = argument("allow-origin");
  const service = createDevRoomService({
    staticDirectory,
    ...(allowedOrigin ? { allowedOrigins: [allowedOrigin] } : {}),
  });
  // The port asked for is where the search starts, not a demand: another worktree's service may already hold it.
  const actual = await listenFree(service.server, port, host);
  const base = `http://${host === "127.0.0.1" || host === "0.0.0.0" ? "localhost" : host}:${actual}`;
  console.log(devBanner({ port, actual, base, staticDirectory }));
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void service.close().finally(() => process.exit(0));
    });
}
