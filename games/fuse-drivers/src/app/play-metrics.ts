import type { PlayFrame } from "fuse-ui/play-metrics";
import type { FuseDriversRoom } from "../game/index.js";

export function playFrame(
  room: FuseDriversRoom,
  self: string,
  mode: string,
): PlayFrame {
  const drivers = [...room.seats.values()].filter((seat) => !seat.watcher);
  return {
    matchId: room.matchId,
    active: room.stage === "running",
    ended: room.stage === "over",
    round: room.round,
    playerCount: drivers.length,
    botCount: drivers.filter((seat) => seat.bot).length,
    seated: drivers.some((seat) => seat.id === self),
    mode,
  };
}
