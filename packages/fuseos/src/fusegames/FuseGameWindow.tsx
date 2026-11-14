import { useCallback, useContext, useRef } from "react";

import { OsAnalyticsContext } from "../analytics/osAnalytics";
import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import { useRecordRoomFromFrame } from "../network/roomObserver";
import { Win98Icon } from "../ui/icons";
import { IframeGame, liveFrameUrl } from "../windows/IframeGame";
import { useWindowCommands } from "../windows/useWindowCommands";

import { FuseGamesContext } from "./registry";

export type FuseGameWindowProps = {
  gameId: string;
  /** A room code to join on open, as a friend's "Join game" asks. */
  room?: string;
  active: boolean;
  onActivate: () => void;
  /** Called with the game's iframe when it mounts and `null` when it unmounts, so the title bar's Pop out can read its live address. */
  onFrame?: (element: HTMLIFrameElement | null) => void;
};

export const POP_OUT_LABEL = "Pop out to a new tab";
export const POP_OUT_HINT =
  "Open this game in a browser tab of its own; the room you are in comes along.";

/** The embed URL with `room=<code>` added, whether or not it already carries a query (`?mute`). */
export function withRoom(url: string, room: string | undefined): string {
  if (!room) return url;
  return `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(room)}`;
}

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

/**
 * Body of a Fuse game window: the game's own page in an iframe filling the window, started as soon as it opens
 * (in `room` when a friend's "Join game" asked for one). The room the page joins is recorded for Network
 * Neighborhood's recent rooms.
 */
export function FuseGameWindow({
  gameId,
  room,
  active,
  onActivate,
  onFrame,
}: FuseGameWindowProps) {
  const registry = useContext(FuseGamesContext);
  const frame = useRef<HTMLIFrameElement | null>(null);
  // A game puts `?room=CODE` in its own address when it creates or joins a room; Network Neighborhood lists it.
  useRecordRoomFromFrame(frame, gameId);
  const trackFrame = useCallback(
    (element: HTMLIFrameElement | null) => {
      frame.current = element;
      onFrame?.(element);
    },
    [onFrame],
  );
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
      url={withRoom(registry.embedUrl(game), room)}
      backdropUrl={registry.screenshotUrl(game)}
      active={active}
      onActivate={onActivate}
      onFrame={trackFrame}
    />
  );
}
