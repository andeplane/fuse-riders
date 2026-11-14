import type { PlayFrame } from "fuse-ui/play-metrics";
import type { View } from "../online/game.js";

/** Observe the actual army roster: vacant and disconnected slots are bot-driven. */
export function frontPlayFrame(
  view: View,
  self: string,
  display: boolean,
  online: boolean,
): PlayFrame {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const shared =
    display || (view.stage === "lobby" ? view.settings : view.play).display;
  return {
    matchId: view.matchId,
    active: view.stage === "running",
    ended: view.stage === "over",
    playerCount: view.world?.players.length ?? seats.length,
    botCount: view.world
      ? view.bots.length
      : seats.filter((seat) => seat.bot).length,
    seated: !display && seats.some((seat) => seat.id === self && !seat.bot),
    mode: online ? (shared ? "shared" : "online") : "solo",
  };
}
