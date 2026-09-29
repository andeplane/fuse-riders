import { pathToFileURL } from "node:url";
import type { AuthClient } from "google-auth-library";
import { startGcpRoomService } from "fuse-network-be/gcp";
import { ROOM_LIMITS } from "./room-limits.js";
import {
  FriendsStore,
  HistoryStore,
  createPlatformHttp,
  createIdentityVerifier,
} from "fuse-platform";
import {
  FirestoreFriendsDatabase,
  FirestoreHistoryDatabase,
} from "fuse-platform/firestore";
import { extraGameIds, platformFor } from "./history.js";

/**
 * The one deployed service: every served game's rooms and its shared history, accounts and ratings. Fuse Riders is
 * always served; `EXTRA_GAME_IDS=dice` adds the dice game (see docs/online/GCP-DEPLOY.md before setting it).
 */
export function startService(
  authClient?: AuthClient,
  extra = process.env.EXTRA_GAME_IDS,
): void {
  const platform = platformFor(extraGameIds(extra));
  startGcpRoomService({
    serviceName: "fuse-riders-gateway",
    defaultPrefix: "fuse-preview",
    ...ROOM_LIMITS,
    gameIds: platform.gameIds,
    ...(authClient ? { authClient } : {}),
    httpExtension: ({ store, firestore, prefix, projectId }) => {
      const history = new FirestoreHistoryDatabase(platform, firestore, prefix);
      return createPlatformHttp({
        history: new HistoryStore(platform, history, store, Date.now),
        friends: new FriendsStore(
          platform,
          history,
          new FirestoreFriendsDatabase(firestore, prefix),
          store,
          Date.now,
        ),
        identity: createIdentityVerifier(
          process.env.FIREBASE_PROJECT_ID ?? projectId,
        ),
      });
    },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startService();
