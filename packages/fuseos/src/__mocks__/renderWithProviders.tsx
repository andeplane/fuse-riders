import type { RenderOptions } from "@testing-library/react";
import { render } from "@testing-library/react";
import type { PortalGame } from "fuse-ui/portal";
import type { ReactElement, ReactNode } from "react";

import { AssistantDepsContext } from "../assistant/assistantDepsContext";
import {
  AssistantOptionsStoreContext,
  MemoryAssistantOptionsStore,
} from "../assistant/assistantOptionsStore";
import type { MediaDeps } from "../controlpanel/mediaDepsContext";
import { MediaDepsContext } from "../controlpanel/mediaDepsContext";
import type { SystemProbe } from "../controlpanel/systemInfo";
import { SystemProbeContext } from "../controlpanel/systemProbeContext";
import type { DesktopDeps } from "../desktop/desktopDepsContext";
import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import {
  DisplayPrefsStoreContext,
  MemoryDisplayPrefsStore,
} from "../desktop/displayPrefsStore";
import {
  MemoryWallpaperStore,
  WallpaperStoreContext,
} from "../desktop/wallpaperStore";
import type { FuseGameRegistry } from "../fusegames/registry";
import {
  createFuseGameRegistry,
  FuseGamesContext,
} from "../fusegames/registry";
import type { PaintControls } from "../paint/paintControls";
import type { PaintDeps } from "../paint/paintDepsContext";
import { PaintDepsContext } from "../paint/paintDepsContext";
import {
  MemoryPaintPrefsStore,
  PaintPrefsStoreContext,
} from "../paint/paintPrefsStore";
import { PaintRegistryContext } from "../paint/paintRegistryContext";
import type { GamesDeps } from "../retro/gamesDepsContext";
import { GamesDepsContext } from "../retro/gamesDepsContext";
import {
  FuseOsPrefsStoreContext,
  MemoryFuseOsPrefsStore,
} from "../settings/fuseosPrefsStore";
import { Shell } from "../Shell";
import type { AppState, WindowContent } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";
import type { AppStateDeps } from "../state/appStateContext";
import { AppStateDepsContext } from "../state/appStateContext";
import { MemoryStateStore } from "../state/stateStore";
import type { WinampControls } from "../winamp/winampControls";
import type { WinampDeps } from "../winamp/winampDepsContext";
import { WinampDepsContext } from "../winamp/winampDepsContext";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";
import { PlainWindowFrame } from "../windows/PlainWindowFrame";
import type { WindowsDeps } from "../windows/windowsDepsContext";
import { WindowsDepsContext } from "../windows/windowsDepsContext";

import type { TestAssistantDeps } from "./assistantDeps";
import { createTestAssistantDeps } from "./assistantDeps";
import { FakePaintFileDeps } from "./paintFiles";
import { FakePaintSurface } from "./paintSurface";
import type { FakeWebampPlayer } from "./webampPlayer";
import { createFakeWebampPlayer } from "./webampPlayer";

/** Three Fuse games as the portal would list them. */
export const FIXTURE_GAMES: readonly PortalGame[] = [
  {
    id: "fuseball",
    name: "Fuseball",
    tagline: "Five-a-side with rockets",
    mark: "FB",
    accent: "#ff5533",
    order: 1,
    path: "fuseball/",
    screenshot: "gallery/fuseball.jpg",
  },
  {
    id: "fuse-riders",
    name: "Fuse Riders",
    tagline: "Light cycles for five",
    mark: "FR",
    accent: "#33ddff",
    order: 2,
    path: "fuse-riders/",
  },
  {
    id: "fuse-birds",
    name: "Fuse Birds",
    tagline: "Flap, dodge, survive",
    mark: "FBi",
    accent: "#ffcc00",
    order: 3,
    path: "fuse-birds/",
  },
];

export const TEST_BASE = "/fuse-riders/";

export function createTestGames(
  games: readonly PortalGame[] = FIXTURE_GAMES,
  options: { muted?: boolean; base?: string } = {},
): FuseGameRegistry {
  return createFuseGameRegistry({
    games,
    base: options.base ?? TEST_BASE,
    muted: options.muted ?? false,
  });
}

export type ProviderOptions = {
  /** The stored state the desktop boots from; default empty. */
  initialState?: AppState;
  /** What a deep link asked for. */
  initialOpen?: readonly WindowContent[];
  /** Defaults to the three fixture games; pass `[]` for an empty desktop. */
  games?: readonly PortalGame[];
  muted?: boolean;
  desktopDeps?: Partial<DesktopDeps>;
  mediaDeps?: Partial<MediaDeps>;
  gamesDeps?: Partial<GamesDeps>;
  wallpaperStore?: MemoryWallpaperStore;
  displayPrefsStore?: MemoryDisplayPrefsStore;
  prefsStore?: MemoryFuseOsPrefsStore;
  paintDeps?: Partial<PaintDeps>;
  paintPrefs?: MemoryPaintPrefsStore;
  /** Defaults to a fake Webamp player; pass `{ createPlayer: undefined }` for "not available in this preview". */
  winampDeps?: Partial<WinampDeps>;
  /** Defaults to the fake chat, manual timers and the tiny frame table. */
  assistantDeps?: TestAssistantDeps;
  /** Defaults to a fresh store, i.e. a first visit: the greeting shows. */
  assistantOptions?: MemoryAssistantOptionsStore;
  systemProbe?: SystemProbe;
};

export const immediateAppStateDeps: AppStateDeps = {
  setTimeout: (callback) => {
    callback();
    return globalThis.setTimeout(() => undefined, 0);
  },
  clearTimeout: () => undefined,
  syncDelayMs: 0,
};

export const testWindowsDeps: WindowsDeps = {
  WindowFrame: PlainWindowFrame,
  getViewport: () => ({ width: 1280, height: 800 }),
  subscribeViewport: () => () => undefined,
};

export const TEST_SYSTEM_PROBE: SystemProbe = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  platform: "MacIntel",
  language: "en-GB",
  hasWebGpu: true,
  screen: { width: 1920, height: 1080 },
  storageAvailable: true,
};

export function createTestDesktopDeps(
  overrides: Partial<DesktopDeps> = {},
): DesktopDeps {
  return {
    now: () => Date.UTC(1998, 5, 25, 12, 34),
    subscribeClock: () => () => undefined,
    reload: vi.fn(),
    openExternal: vi.fn(),
    ...overrides,
  };
}

export function createTestMediaDeps(
  overrides: Partial<MediaDeps> = {},
): MediaDeps {
  return {
    readImageFile: vi.fn(async () => "data:image/jpeg;base64,FILE"),
    openCamera: vi.fn(
      async () =>
        ({ getTracks: () => [] }) as Partial<MediaStream> as MediaStream,
    ),
    captureFrame: vi.fn(async () => "data:image/jpeg;base64,PHOTO"),
    cameraAvailable: () => true,
    ...overrides,
  };
}

/** Deterministic retro games: a fixed clock, no ticking timer and a repeating random sequence. */
export function createTestGamesDeps(
  overrides: Partial<GamesDeps> = {},
): GamesDeps {
  let seed = 0;
  return {
    resolveUrl: (path) => `https://fuseos.test${TEST_BASE}${path}`,
    now: () => Date.UTC(1998, 5, 25, 12, 34),
    subscribeSeconds: () => () => undefined,
    subscribeFrames: () => () => undefined,
    random: () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    },
    ...overrides,
  };
}

/** Paint deps that never touch a canvas, a file picker or downloads; every surface created is collected in `surfaces`. */
export function createTestPaintDeps(
  surfaces: FakePaintSurface[],
  overrides: Partial<PaintDeps> = {},
): PaintDeps {
  return {
    createSurface: vi.fn(() => {
      const surface = new FakePaintSurface();
      surfaces.push(surface);
      return surface;
    }),
    files: new FakePaintFileDeps(),
    ...overrides,
  };
}

/** A Webamp player that never touches the DOM or audio; every player created is collected in `players`. */
export function createTestWinampDeps(
  players: FakeWebampPlayer[],
  overrides: Partial<WinampDeps> = {},
): WinampDeps {
  return {
    createPlayer: vi.fn(async () => {
      const player = createFakeWebampPlayer();
      players.push(player);
      return player;
    }),
    createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    revokeObjectURL: vi.fn(),
    // Never fires spontaneously; a test simulating a playback failure overrides this and calls the callback itself.
    subscribeMediaErrors: vi.fn(() => () => undefined),
    ...overrides,
  };
}

export function createWrapper(options: ProviderOptions = {}) {
  const store = new MemoryStateStore(options.initialState ?? DEFAULT_STATE);
  const games = createTestGames(options.games ?? FIXTURE_GAMES, {
    muted: options.muted,
  });
  const desktopDeps = createTestDesktopDeps(options.desktopDeps);
  const mediaDeps = createTestMediaDeps(options.mediaDeps);
  const gamesDeps = createTestGamesDeps(options.gamesDeps);
  const wallpaperStore = options.wallpaperStore ?? new MemoryWallpaperStore();
  const displayPrefsStore =
    options.displayPrefsStore ?? new MemoryDisplayPrefsStore();
  const prefsStore = options.prefsStore ?? new MemoryFuseOsPrefsStore();
  const surfaces: FakePaintSurface[] = [];
  const paintDeps = createTestPaintDeps(surfaces, options.paintDeps);
  const paintPrefs = options.paintPrefs ?? new MemoryPaintPrefsStore();
  const paintRegistry = new Map<string, PaintControls>();
  const assistantDeps = options.assistantDeps ?? createTestAssistantDeps();
  const assistantOptions =
    options.assistantOptions ?? new MemoryAssistantOptionsStore();
  const winampPlayers: FakeWebampPlayer[] = [];
  const winampDeps = createTestWinampDeps(winampPlayers, options.winampDeps);
  const winampRegistry = new Map<string, WinampControls>();
  const systemProbe = options.systemProbe ?? TEST_SYSTEM_PROBE;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FuseGamesContext.Provider value={games}>
        <AppStateDepsContext.Provider value={immediateAppStateDeps}>
          <WindowsDepsContext.Provider value={testWindowsDeps}>
            <DesktopDepsContext.Provider value={desktopDeps}>
              <MediaDepsContext.Provider value={mediaDeps}>
                <GamesDepsContext.Provider value={gamesDeps}>
                  <WallpaperStoreContext.Provider value={wallpaperStore}>
                    <DisplayPrefsStoreContext.Provider
                      value={displayPrefsStore}
                    >
                      <FuseOsPrefsStoreContext.Provider value={prefsStore}>
                        <PaintDepsContext.Provider value={paintDeps}>
                          <PaintPrefsStoreContext.Provider value={paintPrefs}>
                            <PaintRegistryContext.Provider
                              value={paintRegistry}
                            >
                              <WinampDepsContext.Provider value={winampDeps}>
                                <WinampRegistryContext.Provider
                                  value={winampRegistry}
                                >
                                  <AssistantDepsContext.Provider
                                    value={assistantDeps}
                                  >
                                    <AssistantOptionsStoreContext.Provider
                                      value={assistantOptions}
                                    >
                                      <SystemProbeContext.Provider
                                        value={() => systemProbe}
                                      >
                                        <Shell
                                          store={store}
                                          initialOpen={options.initialOpen}
                                        >
                                          {children}
                                        </Shell>
                                      </SystemProbeContext.Provider>
                                    </AssistantOptionsStoreContext.Provider>
                                  </AssistantDepsContext.Provider>
                                </WinampRegistryContext.Provider>
                              </WinampDepsContext.Provider>
                            </PaintRegistryContext.Provider>
                          </PaintPrefsStoreContext.Provider>
                        </PaintDepsContext.Provider>
                      </FuseOsPrefsStoreContext.Provider>
                    </DisplayPrefsStoreContext.Provider>
                  </WallpaperStoreContext.Provider>
                </GamesDepsContext.Provider>
              </MediaDepsContext.Provider>
            </DesktopDepsContext.Provider>
          </WindowsDepsContext.Provider>
        </AppStateDepsContext.Provider>
      </FuseGamesContext.Provider>
    );
  }
  return {
    Wrapper,
    store,
    games,
    desktopDeps,
    mediaDeps,
    gamesDeps,
    wallpaperStore,
    displayPrefsStore,
    prefsStore,
    paintDeps,
    paintPrefs,
    paintRegistry,
    surfaces,
    assistantDeps,
    assistantOptions,
    winampDeps,
    winampPlayers,
    winampRegistry,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions = {},
  renderOptions?: RenderOptions,
) {
  const context = createWrapper(options);
  const result = render(ui, { wrapper: context.Wrapper, ...renderOptions });
  return { ...result, ...context };
}
