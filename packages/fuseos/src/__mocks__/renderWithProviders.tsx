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
import { createDemoPresenceService } from "../friends/demoPresenceService";
import type { FriendsDeps } from "../friends/friendsDepsContext";
import { FriendsDepsContext } from "../friends/friendsDepsContext";
import type { PresenceService } from "../friends/presenceService";
import { PresenceServiceContext } from "../friends/presenceService";
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
import type { MediaPlayerDeps } from "../mediaplayer/mediaPlayerDepsContext";
import { MediaPlayerDepsContext } from "../mediaplayer/mediaPlayerDepsContext";
import type { HallOfFameDeps } from "../halloffame/hallOfFameDepsContext";
import { HallOfFameDepsContext } from "../halloffame/hallOfFameDepsContext";
import { MemoryLeaderboardService } from "../halloffame/leaderboardService";
import type { NetworkDeps } from "../network/networkDeps";
import { NetworkDepsContext } from "../network/networkDeps";
import {
  MemoryRecentRoomsStore,
  RecentRoomsStoreContext,
} from "../network/recentRooms";
import type { RoomDirectory } from "../network/roomDirectory";
import {
  RoomDirectoryContext,
  UNSUPPORTED_ROOM_DIRECTORY,
} from "../network/roomDirectory";
import type { RoomLauncher } from "../network/roomLauncher";
import { RoomLauncherContext } from "../network/roomLauncher";
import type { PaintControls } from "../paint/paintControls";
import type { PaintDeps } from "../paint/paintDepsContext";
import { PaintDepsContext } from "../paint/paintDepsContext";
import {
  MemoryPaintPrefsStore,
  PaintPrefsStoreContext,
} from "../paint/paintPrefsStore";
import { EditorDepsContext } from "../notepadpp/editorDeps";
import { PaintRegistryContext } from "../paint/paintRegistryContext";
import {
  MemoryRecycleBinStore,
  RecycleBinStoreContext,
} from "../recyclebin/recycleBinStore";
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
import type { DialUpDeps } from "../sounds/dialup/dialUpDepsContext";
import { DialUpDepsContext } from "../sounds/dialup/dialUpDepsContext";
import {
  DialUpSessionContext,
  MemoryDialUpSession,
} from "../sounds/dialup/dialUpSession";
import { SoundServiceContext } from "../sounds/soundContext";
import type { AppState, WindowContent } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";
import type { AppStateDeps } from "../state/appStateContext";
import { AppStateDepsContext } from "../state/appStateContext";
import type { StateStore } from "../state/stateStore";
import { MemoryStateStore } from "../state/stateStore";
import type { System32Deps } from "../system32/system32Deps";
import { MemoryScheduler, System32DepsContext } from "../system32/system32Deps";
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
import { ManualScheduler as ManualDialUpScheduler } from "./dialUpDeps";
import type { FakeEngineFactory } from "./llmEngine";
import { createFakeEngineFactory } from "./llmEngine";
import { FakePaintFileDeps } from "./paintFiles";
import { FakePaintSurface } from "./paintSurface";
import { FakeSoundService } from "./soundService";
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
  /** Defaults to the demo presence service, signed out, over the manual scheduler in `friendsDeps`. */
  presence?: PresenceService;
  friendsDeps?: Partial<FriendsDeps>;
  /** Defaults to the fake engine factory (no download, no worker) and an empty in-memory model cache. */
  llmDeps?: Partial<LlmDeps>;
  /** Defaults to a fresh store: 3D Pipes after 5 idle minutes. */
  screenSaverStore?: MemoryScreenSaverStore;
  /** Defaults to timers that never fire and a pipes loader that never resolves (no three.js in tests). */
  screenSaverDeps?: Partial<ScreenSaverDeps>;
  /** Defaults to the fixture repository with an empty overlay and an instant floppy seek. */
  disk?: TestDiskOptions;
  diskDeps?: TestDiskDeps;
  /** Defaults to a full bin. */
  recycleBinStore?: MemoryRecycleBinStore;
  /** Defaults to a manual scheduler (`mediaPlayerTimers.fire()` advances the fake player one tick). */
  mediaPlayerDeps?: Partial<MediaPlayerDeps>;
  /** Defaults to an empty memory leaderboard service (every game: no rated players yet). */
  hallOfFameDeps?: HallOfFameDeps;
  /** Defaults to an empty in-memory list. */
  recentRooms?: MemoryRecentRoomsStore;
  /** Defaults to the production "unsupported" directory (the service lists no rooms). */
  roomDirectory?: RoomDirectory;
  /** Defaults to the built-in launcher over `prefsStore`; pass one to observe joins directly. */
  roomLauncher?: RoomLauncher;
  networkDeps?: Partial<NetworkDeps>;
  /** Defaults to a hand-stepped scheduler and no demo, so nothing folds unless a test asks. */
  system32Deps?: Partial<System32Deps>;
  /** Defaults to a recording fake that reports every sound as audible. */
  sounds?: FakeSoundService;
  /** Defaults to an offline session, so Network-style windows go through Dial-Up Networking first. */
  dialUpSession?: MemoryDialUpSession;
  /** Defaults to a manual scheduler, so the handshake's status lines advance only when a test says. */
  dialUpDeps?: DialUpDeps;
};

/** The media player's scheduled ticks, fired by the test rather than a clock. */
export class ManualScheduler {
  private pending: (() => void)[] = [];

  schedule = (callback: () => void, _ms: number): (() => void) => {
    this.pending.push(callback);
    return () => {
      this.pending = this.pending.filter((entry) => entry !== callback);
    };
  };

  get size(): number {
    return this.pending.length;
  }

  /** Runs every pending callback once (each may schedule the next). */
  fire(): void {
    const batch = this.pending;
    this.pending = [];
    for (const callback of batch) callback();
  }
}

export function createTestMediaPlayerDeps(
  scheduler: ManualScheduler,
  overrides: Partial<MediaPlayerDeps> = {},
): MediaPlayerDeps {
  return { schedule: scheduler.schedule, ...overrides };
}

/** A scheduler a test fires by hand: `timers.fire()` runs every pending callback in order. */
export type FriendsTimers = {
  schedule: FriendsDeps["schedule"];
  /** Runs what is due (everything, or only what was scheduled within `withinMs`). */
  fire: (withinMs?: number) => void;
  pending: () => number;
};

export function createFriendsTimers(): FriendsTimers {
  let pending: { id: number; delayMs: number; callback: () => void }[] = [];
  let nextId = 0;
  return {
    schedule: (callback, delayMs) => {
      const id = nextId++;
      pending.push({ id, delayMs, callback });
      return () => {
        pending = pending.filter((timer) => timer.id !== id);
      };
    },
    fire: (withinMs = Number.POSITIVE_INFINITY) => {
      const due = pending.filter((timer) => timer.delayMs <= withinMs);
      pending = pending.filter((timer) => timer.delayMs > withinMs);
      for (const timer of due) timer.callback();
    },
    pending: () => pending.length,
  };
}

export function createTestFriendsDeps(
  timers: FriendsTimers,
  overrides: Partial<FriendsDeps> = {},
): FriendsDeps {
  return {
    now: () => Date.UTC(1998, 5, 25, 12, 34),
    schedule: timers.schedule,
    playAlert: vi.fn(),
    copyText: vi.fn(async () => undefined),
    ...overrides,
  };
}

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
    isApplePlatform: () => false,
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

/** A fixed clock, a mouse-driven device and timers that never fire on their own (`tick` runs every scheduled callback once). */
export function createTestNetworkDeps(
  overrides: Partial<NetworkDeps> = {},
): NetworkDeps & { tick: () => void } {
  const callbacks = new Set<() => void>();
  return {
    now: () => Date.UTC(1998, 5, 25, 12, 34),
    finePointer: () => true,
    every: (callback) => {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    tick: () => callbacks.forEach((callback) => callback()),
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

  const hallOfFameDeps: HallOfFameDeps = options.hallOfFameDeps ?? {
    leaderboards: new MemoryLeaderboardService(
      Object.fromEntries(
        (options.games ?? FIXTURE_GAMES).map((game) => [game.id, []]),
      ),
    ),
  };
  const recentRooms = options.recentRooms ?? new MemoryRecentRoomsStore();
  const roomDirectory = options.roomDirectory ?? UNSUPPORTED_ROOM_DIRECTORY;
  const roomLauncher = options.roomLauncher ?? null;
  const networkDeps = createTestNetworkDeps(options.networkDeps);
  const timers = createFriendsTimers();
  const friendsDeps = createTestFriendsDeps(timers, options.friendsDeps);
  const presence =
    options.presence ??
    createDemoPresenceService({
      schedule: friendsDeps.schedule,
      signedIn: false,
    });
  const system32Deps: System32Deps = {
    scheduler: new MemoryScheduler(),
    ...options.system32Deps,
  };
  const sounds = options.sounds ?? new FakeSoundService();
  const dialUpSession = options.dialUpSession ?? new MemoryDialUpSession();
  const dialUpDeps = options.dialUpDeps ?? new ManualDialUpScheduler();
  const recycleBinStore =
    options.recycleBinStore ?? new MemoryRecycleBinStore();
  const mediaPlayerTimers = new ManualScheduler();
  const mediaPlayerDeps = createTestMediaPlayerDeps(
    mediaPlayerTimers,
    options.mediaPlayerDeps,
  );

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
    provider(RecycleBinStoreContext, recycleBinStore),
    provider(MediaPlayerDepsContext, mediaPlayerDeps),
    provider(HallOfFameDepsContext, hallOfFameDeps),
    provider(RecentRoomsStoreContext, recentRooms),
    provider(RoomDirectoryContext, roomDirectory),
    provider(RoomLauncherContext, roomLauncher),
    provider(NetworkDepsContext, networkDeps),
    provider(PresenceServiceContext, presence),
    provider(FriendsDepsContext, friendsDeps),
    provider(System32DepsContext, system32Deps),
    provider(SoundServiceContext, sounds),
    provider(DialUpSessionContext, dialUpSession),
    provider(DialUpDepsContext, dialUpDeps),
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
    recentRooms,
    roomDirectory,
    networkDeps,
    store,
    games,
    presence,
    friendsDeps,
    timers,
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
    recycleBinStore,
    mediaPlayerDeps,
    mediaPlayerTimers,
    hallOfFameDeps,
    sounds,
    dialUpSession,
    dialUpDeps,
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
