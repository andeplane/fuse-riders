import { pathToFileURL } from 'node:url';
import type { AuthClient } from 'google-auth-library';
import { startGcpRoomService } from 'fuse-network-be/gcp';
import { ROOM_LIMITS } from './room-limits.js';

/** The production room service (Cloud Run): everything but the game's names lives in fuse-network-be. */
export function startService(authClient?:AuthClient):void {
  startGcpRoomService({serviceName:'fuse-riders-gateway',defaultPrefix:'fuse-preview',...ROOM_LIMITS,...(authClient?{authClient}:{})});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startService();
