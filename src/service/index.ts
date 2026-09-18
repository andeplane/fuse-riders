import { pathToFileURL } from "node:url";
import type { AuthClient } from "google-auth-library";
import { startGcpRoomService } from "fuse-network-be/gcp";
import { ROOM_LIMITS } from "./room-limits.js";
import { HistoryStore } from "./history.js";
import { FirestoreHistoryDatabase } from "./firestore-history.js";
import { createIdentityVerifier } from "./identity.js";
import { createHistoryHttp } from "./history-http.js";

/** Game-owned history routes on the generic Cloud Run signalling service. */
export function startService(authClient?: AuthClient): void {
  startGcpRoomService({
    serviceName: "fuse-riders-gateway",
    defaultPrefix: "fuse-preview",
    ...ROOM_LIMITS,
    ...(authClient ? { authClient } : {}),
    httpExtension: ({ store, firestore, prefix, projectId }) =>
      createHistoryHttp(
        new HistoryStore(
          new FirestoreHistoryDatabase(firestore, prefix),
          store,
          Date.now,
        ),
        createIdentityVerifier(process.env.FIREBASE_PROJECT_ID ?? projectId),
      ),
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startService();
