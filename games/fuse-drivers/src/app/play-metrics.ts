import type { PlayFrame } from "fuse-ui/play-metrics";
import type { Frame } from "fuse-netcode";
import type { FuseDriversRoom, FuseDriversView } from "../game/index.js";

export function playFrame(
  room: FuseDriversRoom,
  self: string,
  mode: string,
): PlayFrame {
  const drivers = [...room.seats.values()].filter((seat) => !seat.watcher);
  return {
    matchId: room.matchId,
    roundActive: room.race?.phase === "racing",
    roundEnded: false,
    active: room.stage === "running",
    ended: room.stage === "over",
    round: room.round,
    playerCount: drivers.length,
    botCount: drivers.filter((seat) => seat.bot).length,
    seated: drivers.some((seat) => seat.id === self),
    mode,
  };
}

/** Final history carries its own roster and match even if the live room has already restarted. */
export function confirmedPlayFrame(
  view: Frame<FuseDriversView>,
  self: string,
  mode: string,
): PlayFrame {
  return {
    matchId: view.matchId,
    round: view.round,
    roundActive: false,
    roundEnded: view.race?.phase === "finished",
    active: false,
    ended: view.phase === "over",
    playerCount: view.drivers.length,
    botCount: view.drivers.filter((driver) => driver.bot).length,
    seated: view.drivers.some((driver) => driver.id === self),
    mode,
  };
}
