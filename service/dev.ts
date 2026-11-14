import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createDevRoomService as createService,
  type DevRoomService,
  type DevRoomServiceOptions as NetworkOptions,
  type HttpExtension,
} from "fuse-network-be";
import { ROOM_LIMITS } from "./room-limits.js";
import { listenFree } from "./listen-free.js";
import {
  FriendsStore,
  HistoryStore,
  MemoryFriendsDatabase,
  MemoryHistoryDatabase,
  composeHttp,
  createPlatformHttp,
  createIdentityVerifier,
  type IdentityVerifier,
  type Platform,
} from "fuse-platform";
import { platform } from "./history.js";
import { createTimingLogHttp } from "./timing-log.js";
import { FIREBASE_PROJECT_ID } from "../games/fuse-riders/src/shared/firebase-config.js";
import {
  createDeveloperVerifier,
  type DeveloperVerifier,
} from "fuse-telemetry/developer-access";
import { createLocalTelemetry, createMemoryTelemetry } from "./telemetry.js";
export type { DevRoomService };
export interface DevRoomServiceOptions extends Omit<
  NetworkOptions,
  "httpExtension"
> {
  identity?: IdentityVerifier;
  /** The games served; every registered game by default, as on Cloud Run. */
  platform?: Platform;
  /** Where a `?debugtiming` page's session is written (`timing-log.ts`); no such route without it. */
  timingLogDirectory?: string;
  /** Injectable private routes for integration tests or persistent local composition. */
  telemetry?: HttpExtension;
  developerIdentity?: DeveloperVerifier;
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
      const http = createPlatformHttp({
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
      const telemetry =
        options.telemetry ??
        createMemoryTelemetry({
          gameIds: games.gameIds,
          developer:
            options.developerIdentity ??
            createDeveloperVerifier(FIREBASE_PROJECT_ID),
          now,
        }).http;
      return composeHttp(
        telemetry,
        options.timingLogDirectory
          ? composeHttp(createTimingLogHttp(options.timingLogDirectory), http)
          : http,
      );
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
  timingLogDirectory?: string;
}): string {
  const { port, actual, base, staticDirectory } = at;
  const timing = at.timingLogDirectory
    ? `\nTiming lab: ${base}/fusemania/?debugtiming (sessions are written to ${at.timingLogDirectory})`
    : "";
  return `
FUSE GAMES — online rooms, locally
${actual === port ? "" : `\nPort ${port} is in use; using ${actual} instead.\n`}
Home:      ${base}/          (game gallery)
Riders:    ${base}/fuse-riders/ (create or join a room)
Play solo: ${base}/fuse-riders/?solo=1
Health:    ${base}/api/health${timing}

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
  // A `?debugtiming` session is written here, for whoever reads it afterwards.
  const timingLogDirectory =
    argument("timing-logs") ??
    fileURLToPath(new URL("../timing-logs", import.meta.url));
  const insightsDirectory =
    argument("insights") ??
    fileURLToPath(new URL("../.fuse-insights", import.meta.url));
  const insights = await createLocalTelemetry({
    directory: insightsDirectory,
    gameIds: platform.gameIds,
    developer: createDeveloperVerifier(FIREBASE_PROJECT_ID),
  });
  const service = createDevRoomService({
    staticDirectory,
    timingLogDirectory,
    telemetry: insights.http,
    ...(allowedOrigin ? { allowedOrigins: [allowedOrigin] } : {}),
  });
  // The port asked for is where the search starts, not a demand: another worktree's service may already hold it.
  const actual = await listenFree(service.server, port, host);
  const base = `http://${host === "127.0.0.1" || host === "0.0.0.0" ? "localhost" : host}:${actual}`;
  console.log(
    devBanner({ port, actual, base, staticDirectory, timingLogDirectory }),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void service.close().finally(() => process.exit(0));
    });
}
