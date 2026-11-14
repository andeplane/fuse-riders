import { PORTAL_GAMES } from "fuse-ui/portal";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { createFuseGameRegistry, FuseGamesContext } from "./fusegames/registry";
import {
  deepLinkContents,
  parseOpenParam,
  withoutOpenParam,
} from "./state/deepLink";
import { SoundServiceContext } from "./sounds/soundContext";
import { LocalStorageSoundPrefsStore } from "./sounds/soundPrefsStore";
import type { SoundAudioContext } from "./sounds/soundService";
import { documentGestures, WebAudioSoundService } from "./sounds/soundService";
import { loadSynth } from "./sounds/synth";
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

// System sounds: synthesised on first use, and only after the first click or key press (autoplay policy).
// `?mute` silences them all, as it does the games.
const sounds = new WebAudioSoundService({
  createContext: (): SoundAudioContext | undefined =>
    typeof AudioContext === "undefined" ? undefined : new AudioContext(),
  prefs: new LocalStorageSoundPrefsStore(),
  muted,
  loadSynth,
  gestures: documentGestures(window),
});

export function mountFuseOs(container: HTMLElement): void {
  // No React.StrictMode: its double mount in development restarts every embedded game twice.
  ReactDOM.createRoot(container).render(
    <FuseGamesContext.Provider value={games}>
      <WinampDepsContext.Provider value={winampDeps}>
        <SoundServiceContext.Provider value={sounds}>
          <App store={new LocalStorageStateStore()} initialOpen={initialOpen} />
        </SoundServiceContext.Provider>
      </WinampDepsContext.Provider>
    </FuseGamesContext.Provider>,
  );
}

const root = document.getElementById("app");
if (root) mountFuseOs(root);
