import { useContext } from "react";

import { FuseGamesContext } from "../fusegames/registry";
import { Win98Icon } from "../ui/icons";
import { IframeGame } from "../windows/IframeGame";

import { roomUrl } from "./roomCode";
import { useRecordRoom } from "./roomObserver";

export type RoomGameWindowProps = {
  gameId: string;
  code: string;
  active: boolean;
  onActivate: () => void;
};

/** Body of a game window opened into a room: the game's page with `?room=CODE`, remembered as a recent room. */
export function RoomGameWindow({
  gameId,
  code,
  active,
  onActivate,
}: RoomGameWindowProps) {
  const registry = useContext(FuseGamesContext);
  const game = registry.find(gameId);
  useRecordRoom(gameId, code);
  if (!game) {
    return (
      <div className="window-body flex items-start gap-3" role="alert">
        <Win98Icon name="warning" size={32} />
        <p>
          The game &quot;{gameId}&quot; is not installed on this FuseOS, so room{" "}
          {code} cannot be joined from here.
        </p>
      </div>
    );
  }
  return (
    <IframeGame
      name={`${game.name} room ${code}`}
      url={roomUrl(registry.embedUrl(game), code)}
      backdropUrl={registry.screenshotUrl(game)}
      active={active}
      onActivate={onActivate}
    />
  );
}
