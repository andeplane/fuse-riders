import { useCallback, useContext } from "react";

import { OsAnalyticsContext } from "../analytics/osAnalytics";
import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import { Win98Icon } from "../ui/icons";
import { IframeGame, liveFrameUrl } from "../windows/IframeGame";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FuseGamesContext } from "./registry";

export type FuseGameWindowProps = {
  gameId: string;
  active: boolean;
  onActivate: () => void;
  /** Called with the game's iframe when it mounts and `null` when it unmounts, so the title bar's Pop out can read its live address. */
  onFrame?: (element: HTMLIFrameElement | null) => void;
};

export const POP_OUT_LABEL = "Pop out to a new tab";
export const POP_OUT_HINT =
  "Open this game in a browser tab of its own; the room you are in comes along.";

/**
 * Pop out for a game window, shown in its title bar (`WindowChrome`'s `extraTitleButtons`). Reads the frame's
 * live address (same origin), so a game that has entered a room reopens in that room, then closes the window
 * so the game does not run twice.
 */
export function useGamePopOut(
  frameFor: (windowId: string) => HTMLIFrameElement | null,
): (windowId: string, gameId: string) => void {
  const registry = useContext(FuseGamesContext);
  const { openExternal } = useContext(DesktopDepsContext);
  const analytics = useContext(OsAnalyticsContext);
  const commands = useWindowCommands();
  return useCallback(
    (windowId, gameId) => {
      const game = registry.find(gameId);
      if (!game) return;
      openExternal(liveFrameUrl(frameFor(windowId), registry.embedUrl(game)));
      analytics.gameLaunched(game.id, "popout");
      commands.close(windowId);
    },
    [registry, openExternal, analytics, commands, frameFor],
  );
}

/** Body of a Fuse game window: the game's own page in an iframe filling the window, started as soon as it opens. */
export function FuseGameWindow({
  gameId,
  active,
  onActivate,
  onFrame,
}: FuseGameWindowProps) {
  const registry = useContext(FuseGamesContext);
  const game = registry.find(gameId);
  if (!game) {
    return (
      <div className="window-body flex items-start gap-3" role="alert">
        <Win98Icon name="warning" size={32} />
        <p>
          The game &quot;{gameId}&quot; is not installed on this FuseOS. Pick
          another one from the desktop.
        </p>
      </div>
    );
  }
  return (
    <IframeGame
      name={game.name}
      url={registry.embedUrl(game)}
      backdropUrl={registry.screenshotUrl(game)}
      active={active}
      onActivate={onActivate}
      onFrame={onFrame}
    />
  );
}
