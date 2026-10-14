import type { PlayFrame } from "fuse-ui/play-metrics";
import type { GameMode, NeuralSession, OnlineSession } from "./contracts.js";

/** Observe the same session the UI uses; disposing it clears its subscribers. */
export function observeLocalPlay(
  session: NeuralSession,
  mode: GameMode,
  report: (frame: PlayFrame) => void,
): NeuralSession {
  const update = () => {
    const view = session.view();
    report({
      matchId: view.matchId,
      active: !view.finished,
      ended: view.finished,
      playerCount: view.players.length,
      botCount: view.players.filter(
        (player) => player.id !== session.localPlayerId || !session.canControl,
      ).length,
      seated: session.canControl,
      mode,
    });
  };
  session.subscribe(update);
  update();
  return session;
}

export function observeOnlinePlay(
  session: OnlineSession,
  report: (frame: PlayFrame) => void,
): OnlineSession {
  const update = () => {
    const room = session.room();
    if (room.stage === "connecting") return;
    report({
      matchId: session.view().matchId,
      active: room.stage === "running",
      ended: room.stage === "over",
      playerCount: room.seats.filter((seat) => !seat.watcher).length,
      botCount: room.seats.filter((seat) => seat.bot).length,
      seated: room.seats.some((seat) => seat.id === room.self && !seat.watcher),
      mode: "online",
    });
  };
  session.subscribe(update);
  update();
  return session;
}
