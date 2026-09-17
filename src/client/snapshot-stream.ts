import type { GameSnapshot } from "../shared/protocol.js";

/** Per-rider presentation time is local rendering metadata, never authoritative state. */
export type ViewPlayer = GameSnapshot["players"][number] & {
  presentationTick?: number;
};
/** Optional fractional world time for cosmetics; LAN retains the discrete snapshot tick. */
export type ViewSnapshot = Omit<GameSnapshot, "players"> & {
  tick: number;
  round: number;
  players: readonly ViewPlayer[];
  presentationTick?: number;
};
