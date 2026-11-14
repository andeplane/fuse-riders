import { useContext } from "react";

import { FuseGamesContext } from "../fusegames/registry";

/**
 * Control Panel, Games. Phase B (B2) puts the launch preference here (`settings/fuseosPrefsStore.ts`: a window
 * on this desktop or a browser tab); for now it lists what is installed.
 */
export function GamesApplet() {
  const { games } = useContext(FuseGamesContext);
  return (
    <fieldset>
      <legend>Installed games</legend>
      {games.length === 0 ? (
        <p>No Fuse games are installed on this desktop.</p>
      ) : (
        <ul className="sunken-panel bg-white p-2" aria-label="Installed games">
          {games.map((game) => (
            <li key={game.id}>
              <span className="font-bold">{game.name}</span>
              <span className="text-[grey]"> — {game.tagline}</span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
