import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createDevRoomService as createService,
  type DevRoomService,
  type DevRoomServiceOptions as NetworkOptions,
} from "fuse-network-be";
import { ROOM_LIMITS } from "./room-limits.js";
import { listenFree } from "./listen-free.js";
import { HistoryStore } from "./history.js";
import { MemoryHistoryDatabase } from "./memory-history.js";
import { createIdentityVerifier, type IdentityVerifier } from "./identity.js";
import { createHistoryHttp } from "./history-http.js";
import { FIREBASE_PROJECT_ID } from "../shared/firebase-config.js";
export type { DevRoomService };
export interface DevRoomServiceOptions extends Omit<
  NetworkOptions,
  "httpExtension"
> {
  identity?: IdentityVerifier;
}

/** Game history and capacity on the generic in-memory signalling service. */
export function createDevRoomService(
  options: DevRoomServiceOptions = {},
): DevRoomService {
  const now = options.now ?? Date.now;
  return createService({
    ...ROOM_LIMITS,
    ...options,
    httpExtension: (store) =>
      createHistoryHttp(
        new HistoryStore(new MemoryHistoryDatabase(now), store, now),
        options.identity ?? createIdentityVerifier(FIREBASE_PROJECT_ID),
      ),
  });
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
    argument("static") ?? fileURLToPath(new URL("../../dist", import.meta.url));
  const service = createDevRoomService({ staticDirectory });
  // The port asked for is where the search starts, not a demand: another worktree's service may already hold it.
  const actual = await listenFree(service.server, port, host);
  const base = `http://${host === "127.0.0.1" || host === "0.0.0.0" ? "localhost" : host}:${actual}`;
  // Same shape as `npm run dev`'s banner: every link on its own line, after the build output, so it can be found and clicked.
  console.log(`
FUSE RIDERS — online rooms, locally
${actual === port ? "" : `\nPort ${port} is in use; using ${actual} instead.\n`}
Home:      ${base}/          (create or join a room, SIGN IN / MY GAMES)
Play solo: ${base}/?solo=1
Health:    ${base}/api/health

Rooms and match history are in memory and vanish when this stops. Serving ${staticDirectory}
`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void service.close().finally(() => process.exit(0));
    });
}
