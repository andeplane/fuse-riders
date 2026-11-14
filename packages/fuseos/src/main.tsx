import { PORTAL_GAMES } from "fuse-ui/portal";
import ReactDOM from "react-dom/client";

import {
  createBrowserOsAnalytics,
  OsAnalyticsContext,
} from "./analytics/osAnalytics";
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
import { withLauncherOnBoot } from "./launcher/launcherBoot";
import {
  effectiveGameLaunch,
  FuseOsPrefsStoreContext,
  LocalStorageFuseOsPrefsStore,
} from "./settings/fuseosPrefsStore";
import { browserLaunchDevice } from "./settings/launchDevice";
import {
  deepLinkContents,
  deepLinkRedirect,
  parseOpenParam,
  withoutOpenParam,
} from "./state/deepLink";
import { createRecordingLoader } from "./sounds/recordings";
import { SoundServiceContext } from "./sounds/soundContext";
import { LocalStorageSoundPrefsStore } from "./sounds/soundPrefsStore";
import type { SoundAudioContext } from "./sounds/soundService";
import { documentGestures, WebAudioSoundService } from "./sounds/soundService";
import { loadSynth } from "./sounds/synth";
import { LocalStorageStateStore } from "./state/stateStore";
import { WEBAMP_OPTIONS } from "./winamp/webampLayout";
import type { WinampDeps } from "./winamp/winampDepsContext";
import {
  defaultWinampDeps,
  WinampDepsContext,
} from "./winamp/winampDepsContext";
import { defaultWindowsDeps } from "./windows/windowsDepsContext";
import { createBrowserY2kDeps, Y2kDepsContext } from "./y2k/y2kDeps";
import { browserMircDeps, MircDepsContext } from "./mirc/mircDeps";

import "./styles.css";

/** The site base the OS is served from ("/" or "/fuse-riders/"; "./" in a static preview). */
const base = import.meta.env.BASE_URL;
const search = window.location.search;
// Read once: `?mute` carries over to every game the desktop embeds (AGENTS.md asks previews to open muted).
const muted = new URLSearchParams(search).has("mute");
const games = createFuseGameRegistry({ games: PORTAL_GAMES, base, muted });
const prefsStore = new LocalStorageFuseOsPrefsStore();

// `?open=fuseball,paint` opens those windows once, then leaves the address so a reload does not repeat it.
const openIds = parseOpenParam(search);
// Where games open in a tab (a phone, or the Games applet's choice) a link to a game is the game itself: no
// desktop boots, and the game's own page reports its opening.
const redirect = deepLinkRedirect(
  openIds,
  games,
  effectiveGameLaunch(prefsStore.get(), browserLaunchDevice()),
);
const initialOpen = redirect ? [] : deepLinkContents(openIds, games);
if (!redirect && initialOpen.length > 0)
  window.history.replaceState(
    window.history.state,
    "",
    withoutOpenParam(window.location.href),
  );

// Winamp (queued, not playing) and Fusteam, the game launcher, open on every boot, Fusteam focused; the deep
// link's windows land on top of them.
const store = withLauncherOnBoot(
  new LocalStorageStateStore(),
  defaultWindowsDeps.getViewport,
);

// Webamp ships its own React and the classic skin inlined; loaded only when Winamp opens.
const winampDeps: WinampDeps = {
  ...defaultWinampDeps,
  createPlayer: async () => {
    const { default: Webamp } = await import("webamp");
    return new Webamp(WEBAMP_OPTIONS);
  },
};

// System sounds: synthesised (or, for the drive, a recording fetched) on first use, and only after the first click or key press (autoplay policy).
// `?mute` silences them all, as it does the games.
const sounds = new WebAudioSoundService({
  createContext: (): SoundAudioContext | undefined =>
    typeof AudioContext === "undefined" ? undefined : new AudioContext(),
  prefs: new LocalStorageSoundPrefsStore(),
  muted,
  loadSynth,
  // The floppy drive is a real recording (CC0), fetched on its first play; the synthesiser is the fallback.
  loadRecording: createRecordingLoader((url) => window.fetch(url)),
  gestures: documentGestures(window),
});
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

// The millennium bug strikes at local midnight; `?y2k=now` plays it on boot for a demo.
const y2kDeps = createBrowserY2kDeps({ search });

export function mountFuseOs(container: HTMLElement): void {
  // Reports the desktop's opening now, and every game launch from here on; the deep link's windows count too.
  const analytics = createBrowserOsAnalytics();
  for (const content of initialOpen)
    if (content.kind === "fusegame")
      analytics.gameLaunched(content.gameId, "window");
  // No React.StrictMode: its double mount in development restarts every embedded game twice.
  ReactDOM.createRoot(container).render(
    <FuseGamesContext.Provider value={games}>
      <FuseOsPrefsStoreContext.Provider value={prefsStore}>
        <OsAnalyticsContext.Provider value={analytics}>
          <WinampDepsContext.Provider value={winampDeps}>
            <SoundServiceContext.Provider value={sounds}>
              <PresenceServiceContext.Provider value={presence}>
                <FriendsDepsContext.Provider value={friendsDeps}>
                  <Y2kDepsContext.Provider value={y2kDeps}>
                    <MircDepsContext.Provider value={browserMircDeps()}>
                      <App store={store} initialOpen={initialOpen} />
                    </MircDepsContext.Provider>
                  </Y2kDepsContext.Provider>
                </FriendsDepsContext.Provider>
              </PresenceServiceContext.Provider>
            </SoundServiceContext.Provider>
          </WinampDepsContext.Provider>
        </OsAnalyticsContext.Provider>
      </FuseOsPrefsStoreContext.Provider>
    </FuseGamesContext.Provider>,
  );
}

const root = document.getElementById("app");
if (redirect) window.location.replace(redirect);
else if (root) mountFuseOs(root);
