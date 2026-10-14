import type { PlayFrame } from "fuse-ui/play-metrics";
import type { RoomView } from "../online/game.js";

export function playFrame(
  view: RoomView,
  self: string,
  mode: string,
): PlayFrame {
  const players = view.players.filter((seat) => !seat.watcher);
  return {
    matchId: view.matchId,
    active: view.stage === "running",
    ended: view.stage === "over",
    playerCount: players.length,
    botCount: players.filter((seat) => seat.bot).length,
    seated: players.some((seat) => seat.id === self),
    mode,
  };
}
