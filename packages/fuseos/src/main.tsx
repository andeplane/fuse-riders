import { PORTAL_GAMES } from "fuse-ui/portal";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { createUhOhSound } from "./friends/alertSound";
import { createDemoPresenceService } from "./friends/demoPresenceService";
import type { FriendsDeps } from "./friends/friendsDepsContext";
import {
  defaultFriendsDeps,
  FriendsDepsContext,
} from "./friends/friendsDepsContext";
import { PresenceServiceContext } from "./friends/presenceService";
import {
  apiUrlFor,
  createRealPresenceService,
} from "./friends/realPresenceService";
import { createSwitchablePresenceService } from "./friends/switchablePresenceService";
import { createFuseGameRegistry, FuseGamesContext } from "./fusegames/registry";
import {
  deepLinkContents,
  parseOpenParam,
  withoutOpenParam,
} from "./state/deepLink";
import { LocalStorageStateStore } from "./state/stateStore";
import { WEBAMP_EMBED_OPTIONS } from "./winamp/webampLayout";
import type { WinampDeps } from "./winamp/winampDepsContext";
import {
  defaultWinampDeps,
  WinampDepsContext,
} from "./winamp/winampDepsContext";

import "./styles.css";

/** The site base the OS is served from ("/" or "/fuse-riders/"; "./" in a static preview). */
const base = import.meta.env.BASE_URL;
const search = window.location.search;
// Read once: `?mute` carries over to every game the desktop embeds (AGENTS.md asks previews to open muted).
const muted = new URLSearchParams(search).has("mute");
const games = createFuseGameRegistry({ games: PORTAL_GAMES, base, muted });

// `?open=fuseball,paint` opens those windows once, then leaves the address so a reload does not repeat it.
const initialOpen = deepLinkContents(parseOpenParam(search), games);
if (initialOpen.length > 0)
  window.history.replaceState(
    window.history.state,
    "",
    withoutOpenParam(window.location.href),
  );

// Webamp ships its own React and the classic skin inlined; loaded only when a Winamp window opens.
const winampDeps: WinampDeps = {
  ...defaultWinampDeps,
  createPlayer: async () => {
    const { default: Webamp } = await import("webamp");
    return new Webamp(WEBAMP_EMBED_OPTIONS);
  },
};

// Fuse Messenger: the live friend list over the room service's friends routes, with the scripted demo behind
// File > Demo buddies. Sign-in and the SDK behind it load on the first click that needs them, never at boot.
const presence = createSwitchablePresenceService(
  createRealPresenceService({
    fetch: window.fetch.bind(window),
    apiUrl: apiUrlFor(import.meta.env.VITE_API_ORIGIN, window.location.origin),
  }),
  () => createDemoPresenceService({ schedule: defaultFriendsDeps.schedule }),
);
const friendsDeps: FriendsDeps = {
  ...defaultFriendsDeps,
  playAlert: muted ? () => undefined : createUhOhSound(),
};

export function mountFuseOs(container: HTMLElement): void {
  // No React.StrictMode: its double mount in development restarts every embedded game twice.
  ReactDOM.createRoot(container).render(
    <FuseGamesContext.Provider value={games}>
      <WinampDepsContext.Provider value={winampDeps}>
        <PresenceServiceContext.Provider value={presence}>
          <FriendsDepsContext.Provider value={friendsDeps}>
            <App
              store={new LocalStorageStateStore()}
              initialOpen={initialOpen}
            />
          </FriendsDepsContext.Provider>
        </PresenceServiceContext.Provider>
      </WinampDepsContext.Provider>
    </FuseGamesContext.Provider>,
  );
}

const root = document.getElementById("app");
if (root) mountFuseOs(root);
