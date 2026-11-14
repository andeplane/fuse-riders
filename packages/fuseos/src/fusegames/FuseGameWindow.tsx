import { useContext } from "react";

import { Win98Icon } from "../ui/icons";
import { IframeGame } from "../windows/IframeGame";

import { FuseGamesContext } from "./registry";

export type FuseGameWindowProps = {
  gameId: string;
  /** A room code to join on open, as a friend's "Join game" asks. */
  room?: string;
  active: boolean;
  onActivate: () => void;
};

/** The embed URL with `room=<code>` added, whether or not it already carries a query (`?mute`). */
export function withRoom(url: string, room: string | undefined): string {
  if (!room) return url;
  return `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(room)}`;
}

/** Body of a Fuse game window: the game's own page in an iframe, started as soon as the window opens. */
export function FuseGameWindow({
  gameId,
  room,
  active,
  onActivate,
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
      url={withRoom(registry.embedUrl(game), room)}
      backdropUrl={registry.screenshotUrl(game)}
      active={active}
      onActivate={onActivate}
    />
  );
}
