import type { RenderOptions } from "@testing-library/react";
import { render } from "@testing-library/react";
import type { PortalGame } from "fuse-ui/portal";
import type { Context, ReactElement, ReactNode } from "react";

import type { GameLaunchKind, OsAnalytics } from "../analytics/osAnalytics";
import { OsAnalyticsContext } from "../analytics/osAnalytics";
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
import { DiskDepsContext } from "../disk/diskDepsContext";
import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import {
  DisplayPrefsStoreContext,
  MemoryDisplayPrefsStore,
} from "../desktop/displayPrefsStore";
import {
  MemoryWallpaperStore,
  WallpaperStoreContext,
} from "../desktop/wallpaperStore";
import type { DisplayEffectsDeps } from "../display/effects/effectsDeps";
import {
  createManualTimers,
  DisplayEffectsDepsContext,
} from "../display/effects/effectsDeps";
import {
  DisplayEffectsStoreContext,
  MemoryDisplayEffectsStore,
} from "../display/effects/effectsStore";
import type { FuseGameRegistry } from "../fusegames/registry";
import {
  createFuseGameRegistry,
  FuseGamesContext,
} from "../fusegames/registry";
import { MemoryLastPlayedStore } from "../launcher/lastPlayedStore";
import type { LauncherDeps } from "../launcher/launcherDepsContext";
import { LauncherDepsContext } from "../launcher/launcherDepsContext";
import type { LlmDeps } from "../llm/llmDepsContext";
import { LlmDepsContext } from "../llm/llmDepsContext";
import { MemoryModelCache } from "../llm/modelCache";
import type { PaintControls } from "../paint/paintControls";
import type { PaintDeps } from "../paint/paintDepsContext";
import { PaintDepsContext } from "../paint/paintDepsContext";
import {
  MemoryPaintPrefsStore,
  PaintPrefsStoreContext,
} from "../paint/paintPrefsStore";
import { EditorDepsContext } from "../notepadpp/editorDeps";
import { PaintRegistryContext } from "../paint/paintRegistryContext";
import type { GamesDeps } from "../retro/gamesDepsContext";
import { GamesDepsContext } from "../retro/gamesDepsContext";
import type { ScreenSaverDeps } from "../screensaver/screenSaverDepsContext";
import { ScreenSaverDepsContext } from "../screensaver/screenSaverDepsContext";
import {
  MemoryScreenSaverStore,
  ScreenSaverStoreContext,
} from "../screensaver/screenSaverStore";
import {
  FuseOsPrefsStoreContext,
  MemoryFuseOsPrefsStore,
} from "../settings/fuseosPrefsStore";
import type { LaunchDevice } from "../settings/launchDevice";
import { LaunchDeviceContext } from "../settings/launchDevice";
import { Shell } from "../Shell";
import type { AppState, WindowContent } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";
import type { AppStateDeps } from "../state/appStateContext";
import { AppStateDepsContext } from "../state/appStateContext";
import type { StateStore } from "../state/stateStore";
import { MemoryStateStore } from "../state/stateStore";
import type { WinampDeps } from "../winamp/winampDepsContext";
import { WinampDepsContext } from "../winamp/winampDepsContext";
import { createWinampRegistry } from "../winamp/winampRegistry";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";
import { PlainWindowFrame } from "../windows/PlainWindowFrame";
import type { WindowsDeps } from "../windows/windowsDepsContext";
import { WindowsDepsContext } from "../windows/windowsDepsContext";

import type { TestAssistantDeps } from "./assistantDeps";
import type { TestDiskDeps, TestDiskOptions } from "./disk";
import { createTestDiskDeps } from "./disk";
import type { FakeEditor } from "./editor";
import { createFakeEditorDeps } from "./editor";
import { createTestAssistantDeps } from "./assistantDeps";
import type { FakeEngineFactory } from "./llmEngine";
import { createFakeEngineFactory } from "./llmEngine";
import { FakePaintFileDeps } from "./paintFiles";
import { FakePaintSurface } from "./paintSurface";
import type { FakeWebampPlayer } from "./webampPlayer";
import { createFakeWebampPlayer } from "./webampPlayer";

/** Three Fuse games as the portal would list them; only Fuseball ships a desktop icon and a screenshot. */
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
    icon: "fuseos/game-icons/fuseball.png",
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
  /** A store of the test's own (a boot decorator, say); wins over `initialState`. */
  store?: StateStore;
  /** Defaults to an empty last-played map; where PLAY opens a game follows `launchDevice` and `prefsStore`. */
  launcherDeps?: Partial<LauncherDeps>;
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
  /** Display Properties' Appearance and Effects; defaults to everything off, Windows Standard. */
  effectsStore?: MemoryDisplayEffectsStore;
  /** Defaults to manual timers (`effectsTimers` in the result) and no curvature map. */
  effectsDeps?: Partial<DisplayEffectsDeps>;
  prefsStore?: MemoryFuseOsPrefsStore;
  /** Defaults to a wide, mouse-driven desktop, where games open in windows. */
  launchDevice?: LaunchDevice;
  paintDeps?: Partial<PaintDeps>;
  paintPrefs?: MemoryPaintPrefsStore;
  /** Defaults to a fake Webamp player; pass `{ createPlayer: undefined }` for "not available in this preview". */
  winampDeps?: Partial<WinampDeps>;
  /** Defaults to the fake chat, manual timers and the tiny frame table. */
  assistantDeps?: TestAssistantDeps;
  /** Defaults to a fresh store, i.e. a first visit: the greeting shows. */
  assistantOptions?: MemoryAssistantOptionsStore;
  systemProbe?: SystemProbe;
  /** Defaults to the fake engine factory (no download, no worker) and an empty in-memory model cache. */
  llmDeps?: Partial<LlmDeps>;
  /** Defaults to a fresh store: 3D Pipes after 5 idle minutes. */
  screenSaverStore?: MemoryScreenSaverStore;
  /** Defaults to timers that never fire and a pipes loader that never resolves (no three.js in tests). */
  screenSaverDeps?: Partial<ScreenSaverDeps>;
  /** Defaults to the fixture repository with an empty overlay and an instant floppy seek. */
  disk?: TestDiskOptions;
  diskDeps?: TestDiskDeps;
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

export const DESKTOP_DEVICE: LaunchDevice = {
  finePointer: true,
  viewportWidth: 1280,
};

export const PHONE_DEVICE: LaunchDevice = {
  finePointer: false,
  viewportWidth: 390,
};

export type LaunchRecord = { game: string; launch: GameLaunchKind };

/** An `OsAnalytics` that remembers every launch it was told about. */
export function createRecordingOsAnalytics(): OsAnalytics & {
  launches: LaunchRecord[];
} {
  const launches: LaunchRecord[] = [];
  return {
    launches,
    gameLaunched: (game, launch) => {
      launches.push({ game, launch });
    },
  };
}

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
    // Never fires spontaneously; a test simulating a playback failure overrides this and calls the callback itself.
    subscribeMediaErrors: vi.fn(() => () => undefined),
    base: TEST_BASE,
    ...overrides,
  };
}

/** Screen saver deps that never start the saver on their own: no idle timer fires and three.js is never loaded. */
export function createTestScreenSaverDeps(
  overrides: Partial<ScreenSaverDeps> = {},
): ScreenSaverDeps {
  return {
    setTimeout: () => globalThis.setTimeout(() => undefined, 0),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    subscribeActivity: () => () => undefined,
    isVisible: () => true,
    isGameFocused: () => false,
    loadPipes: () => new Promise(() => undefined),
    ...overrides,
  };
}

/** Launcher deps with an empty in-memory last-played map; where a game opens comes from `launchDevice` and `prefsStore`. */
export function createTestLauncherDeps(
  overrides: Partial<LauncherDeps> = {},
): LauncherDeps {
  return {
    lastPlayed: new MemoryLastPlayedStore(),
    ...overrides,
  };
}

/** One context and the value it provides, typed together so a mismatch fails to compile. */
type ProviderEntry = (children: ReactNode) => ReactElement;

function provider<T>(context: Context<T>, value: T): ProviderEntry {
  return (children) => (
    <context.Provider value={value}>{children}</context.Provider>
  );
}

function composeProviders(
  providers: readonly ProviderEntry[],
  leaf: ReactElement,
): ReactElement {
  return providers.reduceRight<ReactElement>(
    (inner, wrap) => wrap(inner),
    leaf,
  );
}

export function createWrapper(options: ProviderOptions = {}) {
  const store =
    options.store ??
    new MemoryStateStore(options.initialState ?? DEFAULT_STATE);
  const launcherDeps = createTestLauncherDeps(options.launcherDeps);
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
  const launchDevice = options.launchDevice ?? DESKTOP_DEVICE;
  const osAnalytics = createRecordingOsAnalytics();
  const effectsStore = options.effectsStore ?? new MemoryDisplayEffectsStore();
  const effectsTimers = createManualTimers();
  const effectsDeps: DisplayEffectsDeps = {
    setTimeout: effectsTimers.setTimeout,
    clearTimeout: effectsTimers.clearTimeout,
    createCurvatureMap: () => undefined,
    ...options.effectsDeps,
  };
  const surfaces: FakePaintSurface[] = [];
  const paintDeps = createTestPaintDeps(surfaces, options.paintDeps);
  const paintPrefs = options.paintPrefs ?? new MemoryPaintPrefsStore();
  const paintRegistry = new Map<string, PaintControls>();
  const assistantDeps = options.assistantDeps ?? createTestAssistantDeps();
  const assistantOptions =
    options.assistantOptions ?? new MemoryAssistantOptionsStore();
  const winampPlayers: FakeWebampPlayer[] = [];
  const winampDeps = createTestWinampDeps(winampPlayers, options.winampDeps);
  const winampRegistry = createWinampRegistry();
  const systemProbe = options.systemProbe ?? TEST_SYSTEM_PROBE;
  const llmFactory: FakeEngineFactory = createFakeEngineFactory();
  const modelCache = new MemoryModelCache();
  const llmDeps: LlmDeps = {
    createEngine: llmFactory.createEngine,
    modelCache,
    ...options.llmDeps,
  };
  const screenSaverStore =
    options.screenSaverStore ?? new MemoryScreenSaverStore();
  const screenSaverDeps = createTestScreenSaverDeps(options.screenSaverDeps);
  const diskDeps = options.diskDeps ?? createTestDiskDeps(options.disk);
  const editors: FakeEditor[] = [];
  const editorDeps = createFakeEditorDeps(editors);

  /** Outermost first; each entry wraps everything after it. */
  const providers: readonly ProviderEntry[] = [
    provider(ScreenSaverStoreContext, screenSaverStore),
    provider(ScreenSaverDepsContext, screenSaverDeps),
    provider(FuseGamesContext, games),
    provider(AppStateDepsContext, immediateAppStateDeps),
    provider(WindowsDepsContext, testWindowsDeps),
    provider(DesktopDepsContext, desktopDeps),
    provider(MediaDepsContext, mediaDeps),
    provider(GamesDepsContext, gamesDeps),
    provider(WallpaperStoreContext, wallpaperStore),
    provider(DisplayPrefsStoreContext, displayPrefsStore),
    provider(FuseOsPrefsStoreContext, prefsStore),
    provider(LaunchDeviceContext, () => launchDevice),
    provider(OsAnalyticsContext, osAnalytics),
    provider(DisplayEffectsStoreContext, effectsStore),
    provider(DisplayEffectsDepsContext, effectsDeps),
    provider(PaintDepsContext, paintDeps),
    provider(PaintPrefsStoreContext, paintPrefs),
    provider(PaintRegistryContext, paintRegistry),
    provider(WinampDepsContext, winampDeps),
    provider(WinampRegistryContext, winampRegistry),
    provider(AssistantDepsContext, assistantDeps),
    provider(AssistantOptionsStoreContext, assistantOptions),
    provider(SystemProbeContext, () => systemProbe),
    provider(LlmDepsContext, llmDeps),
    provider(DiskDepsContext, diskDeps),
    provider(EditorDepsContext, editorDeps),
    provider(LauncherDepsContext, launcherDeps),
  ];

  function Wrapper({ children }: { children: ReactNode }) {
    return composeProviders(
      providers,
      <Shell store={store} initialOpen={options.initialOpen}>
        {children}
      </Shell>,
    );
  }
  return {
    Wrapper,
    screenSaverStore,
    screenSaverDeps,
    store,
    games,
    desktopDeps,
    mediaDeps,
    gamesDeps,
    wallpaperStore,
    displayPrefsStore,
    effectsStore,
    effectsTimers,
    effectsDeps,
    prefsStore,
    launchDevice,
    osAnalytics,
    paintDeps,
    paintPrefs,
    paintRegistry,
    surfaces,
    assistantDeps,
    assistantOptions,
    winampDeps,
    winampPlayers,
    winampRegistry,
    llmFactory,
    modelCache,
    diskDeps,
    editors,
    launcherDeps,
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
