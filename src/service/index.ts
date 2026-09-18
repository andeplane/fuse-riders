import { pathToFileURL } from "node:url";
import type { AuthClient } from "google-auth-library";
import { startGcpRoomService } from "fuse-network-be/gcp";
import { ROOM_LIMITS } from "./room-limits.js";
import {
  HistoryStore,
  createHistoryHttp,
  createIdentityVerifier,
} from "fuse-platform";
import { FirestoreHistoryDatabase } from "fuse-platform/firestore";
import { platform } from "./history.js";

/** The one deployed service: every game's rooms and its shared history, accounts and ratings. */
export function startService(authClient?: AuthClient): void {
  startGcpRoomService({
    serviceName: "fuse-riders-gateway",
    defaultPrefix: "fuse-preview",
    ...ROOM_LIMITS,
    gameIds: platform.gameIds,
    ...(authClient ? { authClient } : {}),
    httpExtension: ({ store, firestore, prefix, projectId }) =>
      createHistoryHttp(
        new HistoryStore(
          platform,
          new FirestoreHistoryDatabase(platform, firestore, prefix),
          store,
          Date.now,
        ),
        createIdentityVerifier(process.env.FIREBASE_PROJECT_ID ?? projectId),
      ),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startService();
