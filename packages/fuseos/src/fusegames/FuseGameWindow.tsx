import { useContext, useRef } from "react";

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
  /** The window's id, so Pop out can close it once the game runs in a tab of its own. */
  windowId?: string;
};

export const POP_OUT_LABEL = "Pop out";
export const POP_OUT_HINT =
  "Open this game in a browser tab of its own; the room you are in comes along.";

/** The embed URL with `room=<code>` added, whether or not it already carries a query (`?mute`). */
export function withRoom(url: string, room: string | undefined): string {
  if (!room) return url;
  return `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(room)}`;
}

/**
 * Body of a Fuse game window: a toolbar with Pop out over the game's own page in an iframe, started as soon as
 * the window opens (in `room` when a friend's "Join game" asked for one). Pop out reads the frame's live address
 * (same origin), so a game that has entered a room reopens in that room, then closes this window so the game does
 * not run twice. The room the page joins is recorded for Network Neighborhood's recent rooms.
 */
export function FuseGameWindow({
  gameId,
  room,
  active,
  onActivate,
  windowId,
}: FuseGameWindowProps) {
  const registry = useContext(FuseGamesContext);
  const { openExternal } = useContext(DesktopDepsContext);
  const analytics = useContext(OsAnalyticsContext);
  const commands = useWindowCommands();
  const frame = useRef<HTMLIFrameElement | null>(null);
  // A game puts `?room=CODE` in its own address when it creates or joins a room; Network Neighborhood lists it.
  useRecordRoomFromFrame(frame, gameId);
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
  const embedUrl = withRoom(registry.embedUrl(game), room);
  const popOut = () => {
    openExternal(liveFrameUrl(frame.current, embedUrl));
    analytics.gameLaunched(game.id, "popout");
    if (windowId !== undefined) commands.close(windowId);
  };
  return (
    <>
      <div
        role="toolbar"
        aria-label={`${game.name} toolbar`}
        className="flex shrink-0 items-center gap-2 border-b border-[#808080] px-1 py-0.5"
      >
        <span className="truncate text-[grey]">{game.tagline}</span>
        <button
          type="button"
          className="ml-auto"
          title={POP_OUT_HINT}
          onClick={popOut}
        >
          {POP_OUT_LABEL} ↗
        </button>
      </div>
      <IframeGame
        name={game.name}
        url={embedUrl}
        backdropUrl={registry.screenshotUrl(game)}
        active={active}
        onActivate={onActivate}
        onFrame={(element) => {
          frame.current = element;
        }}
      />
    </>
  );
}
