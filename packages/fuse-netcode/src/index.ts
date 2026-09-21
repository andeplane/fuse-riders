export * from "./game.js";
export * from "./wire.js";
export * from "./management.js";
export * from "./text.js";
export * from "./clock.js";
export * from "./status-notices.js";
export * from "./uuid.js";
export * from "./packet.js";
export * from "./stream.js";
export * from "./rollback.js";
export * from "./snapshot.js";
// `RoomRuntime`'s collaborators — `Membership`, `WorldSync`, `InputRecorder`, `RoomManager` — are the runtime's own
// decomposition, not this package's surface: a consumer drives the room through `RoomRuntime`. Only three things from
// them are exported here — the constants ADR 047's table documents, the rules comparison a game's app needs, and the
// types that name the one public seam, `RoomRuntime.sync`. Anything else is reachable by path, which is how the tests
// take it; re-exporting the classes would make every later change to them a breaking change for this package.
export { LINK_WAIT_MS, rulesAge } from "./membership.js";
export {
  CREATOR_SILENCE_MS,
  DISCONNECT_MS,
  KICK_NOTICE_ATTEMPTS,
} from "./room-manager.js";
export { DIVERGENCE_LIMIT, DIVERGENCE_WINDOW_MS } from "./world-sync.js";
export type {
  SnapshotRequest,
  WorldSync,
  WorldSyncState,
} from "./world-sync.js";
export * from "./room-runtime.js";
