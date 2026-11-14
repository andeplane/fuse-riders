import { PORTAL_GAMES } from "fuse-ui/portal";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { createFuseGameRegistry, FuseGamesContext } from "./fusegames/registry";
import {
  deepLinkContents,
  parseOpenParam,
  withoutOpenParam,
} from "./state/deepLink";
import { LocalStorageStateStore } from "./state/stateStore";
import { parseFoldParam, withoutFoldParam } from "./system32/demoTrigger";
import type { System32Deps } from "./system32/system32Deps";
import {
  defaultSystem32Deps,
  System32DepsContext,
} from "./system32/system32Deps";
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

// `?fold=now|stage:N|bsod` plays the SYSTEM32 gag for a demo or a screenshot; dropped from the
// address the same way so the fake restart, or a reload, boots a healthy desktop.
const foldDemo = parseFoldParam(search);
if (foldDemo)
  window.history.replaceState(
    window.history.state,
    "",
    withoutFoldParam(window.location.href),
  );
const system32Deps: System32Deps = { ...defaultSystem32Deps, demo: foldDemo };

// Webamp ships its own React and the classic skin inlined; loaded only when a Winamp window opens.
const winampDeps: WinampDeps = {
  ...defaultWinampDeps,
  createPlayer: async () => {
    const { default: Webamp } = await import("webamp");
    return new Webamp(WEBAMP_EMBED_OPTIONS);
  },
};

export function mountFuseOs(container: HTMLElement): void {
  // No React.StrictMode: its double mount in development restarts every embedded game twice.
  ReactDOM.createRoot(container).render(
    <FuseGamesContext.Provider value={games}>
      <WinampDepsContext.Provider value={winampDeps}>
        <System32DepsContext.Provider value={system32Deps}>
          <App store={new LocalStorageStateStore()} initialOpen={initialOpen} />
        </System32DepsContext.Provider>
      </WinampDepsContext.Provider>
    </FuseGamesContext.Provider>,
  );
}

const root = document.getElementById("app");
if (root) mountFuseOs(root);
