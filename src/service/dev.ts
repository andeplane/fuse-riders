import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDevRoomService as createService, runDevRoomService, type DevRoomService, type DevRoomServiceOptions } from 'fuse-network-be';
import { ROOM_LIMITS } from './room-limits.js';
export type { DevRoomService, DevRoomServiceOptions };

/** The production room protocol over in-memory rooms, with this game's capacity: `npm run dev`, `npm run dev:online` and the browser smokes. */
export function createDevRoomService(options: DevRoomServiceOptions = {}): DevRoomService { return createService({ ...ROOM_LIMITS, ...options }); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runDevRoomService({ ...ROOM_LIMITS, staticDirectory: fileURLToPath(new URL('../../dist', import.meta.url)) });
