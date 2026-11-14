import { useContext } from "react";

import { FuseGamesContext } from "../fusegames/registry";
import type { GameLaunch } from "../settings/fuseosPrefsStore";
import { WINDOW_LAUNCH_MIN_WIDTH } from "../settings/fuseosPrefsStore";
import { useGameLaunch } from "../settings/useGameLaunch";

const LAUNCH_LABELS: Record<GameLaunch, string> = {
  window: "A window inside FuseOS",
  tab: "Always a new browser tab",
};

const LAUNCH_NOUNS: Record<GameLaunch, string> = {
  window: "a window",
  tab: "a browser tab",
};

/**
 * Control Panel, Games: where a Fuse game opens — in a window on this desktop or in a browser tab of its own —
 * remembered on this device (`settings/fuseosPrefsStore.ts`), and the games installed.
 */
export function GamesApplet() {
  const { games } = useContext(FuseGamesContext);
  const { launch, deviceDefault, chosen, setLaunch, useDeviceDefault } =
    useGameLaunch();
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend>Open games in</legend>
        <div className="field-row">
          <input
            id="games-launch-window"
            type="radio"
            name="games-launch"
            checked={launch === "window"}
            onChange={() => setLaunch("window")}
          />
          <label htmlFor="games-launch-window">{LAUNCH_LABELS.window}</label>
        </div>
        <div className="field-row">
          <input
            id="games-launch-tab"
            type="radio"
            name="games-launch"
            checked={launch === "tab"}
            onChange={() => setLaunch("tab")}
          />
          <label htmlFor="games-launch-tab">{LAUNCH_LABELS.tab}</label>
        </div>
        <p className="mt-2">
          Without a choice, FuseOS picks a window on a mouse-driven screen at
          least {WINDOW_LAUNCH_MIN_WIDTH} pixels wide and a tab elsewhere. On
          this device that is {LAUNCH_NOUNS[deviceDefault]}.
          {chosen ? (
            <>
              {" "}
              <button type="button" className="ml-1" onClick={useDeviceDefault}>
                Use the device default
              </button>
            </>
          ) : null}
        </p>
        <p className="text-[grey]">
          A game window has a Pop out button that moves the game, and the room
          it is in, to a tab of its own.
        </p>
      </fieldset>
      <fieldset>
        <legend>Installed games</legend>
        {games.length === 0 ? (
          <p>No Fuse games are installed on this desktop.</p>
        ) : (
          <ul
            className="sunken-panel bg-white p-2"
            aria-label="Installed games"
          >
            {games.map((game) => (
              <li key={game.id}>
                <span className="font-bold">{game.name}</span>
                <span className="text-[grey]"> — {game.tagline}</span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
