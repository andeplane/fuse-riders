import {
  observeConfirmedPlay,
  type PlayFrame,
  type PlayObserver,
} from "fuse-ui/play-metrics";
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
      roundActive: !view.finished,
      roundEnded: view.finished,
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
  report: PlayObserver,
): OnlineSession {
  const update = () => {
    const room = session.room();
    if (room.stage === "connecting") return;
    observeConfirmedPlay<{
      world: ReturnType<NeuralSession["view"]>;
      seats: readonly { id: string; bot: boolean; watcher?: boolean }[];
    }>(
      report,
      { world: session.view(), seats: room.seats },
      () => {
        const world = session.confirmedView();
        return world && { world, seats: world.seats };
      },
      ({ world: view, seats }) => ({
        matchId: view.matchId,
        roundActive: room.stage === "running",
        roundEnded: view.finished,
        active: room.stage === "running",
        ended: room.stage === "over",
        playerCount: seats.filter((seat) => !seat.watcher).length,
        botCount: seats.filter((seat) => seat.bot).length,
        seated: seats.some((seat) => seat.id === room.self && !seat.watcher),
        mode: "online",
      }),
    );
  };
  session.subscribe(update);
  update();
  return session;
}
