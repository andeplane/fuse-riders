/** Shared Mixpanel client. Games pass their stable platform game id; privacy and delivery are centralized here. */
import { safeStorage, type SafeStorage } from "./safe-storage.js";
import { bootFailedProps, sanitizeProperties } from "./analytics-text.js";

export type GraphicsReport =
  | { kind: "ready"; renderer: string }
  | { kind: "failed"; stage: "startup" | "context" | "render" };

type MixpanelConfig = import("mixpanel-browser").Config;

/** A Mixpanel project token is a write-only public identifier — every browser bundle reporting to a project ships one. It is not a credential and grants no read access. */
const TOKEN = "b5022dd7fe5b3cd0396d84284ae647e6";
/** Shared event namespace for dashboards across every game. */
export const EVENT_PREFIX = "fuse.";

const OVERRIDE_KEY = "fuse-analytics";
/** `"1"` once this device has switched analytics off in SETTINGS; absent otherwise. */
export const OPT_OUT_KEY = "fuse-analytics-opt-out";

/**
 * What Mixpanel is initialised with. Exported so the test and `docs/ANALYTICS.md` describe the same object.
 *
 * - `ip: false` makes the SDK send `ip=0` on every request, which tells Mixpanel not to derive `$city`, `$region`
 *   or `mp_country_code` from the connection. The request still arrives from an address, as any request does;
 *   what stops is geolocation being stored on the event.
 * - `persistence: "localStorage"` over cookies: the game stores everything else there too, and a batch that
 *   outlives a navigation is what lets CREATE ROOM report before the page it triggers replaces this one.
 *   Where local storage is refused the SDK falls back to a cookie, so `cross_subdomain_cookie: false` keeps
 *   that cookie on this host instead of the SDK's default of the parent domain.
 * - `ignore_dnt: false` is the SDK's default, pinned: with Do Not Track on, the SDK sends nothing. This module
 *   goes one step further and never downloads the SDK in that case (see `doNotTrackOn`).
 * - A room page is `?room=AB42`, and that code is the whole join credential — there is no second token, so
 *   anyone holding the URL can walk into the game. Mixpanel attaches `$current_url` and `$referrer` to every
 *   event by default, which would ship a live invite to a third party on every seat, match and setting change.
 *   The `*_domain` properties survive: they answer where players come from and carry no room code.
 */
export const MIXPANEL_CONFIG = {
  persistence: "localStorage",
  cross_subdomain_cookie: false,
  ip: false,
  ignore_dnt: false,
  track_pageview: false,
  autocapture: false,
  property_blacklist: ["$current_url", "$referrer", "$initial_referrer"],
} satisfies Partial<MixpanelConfig>;

/**
 * Where the SDK keeps its unsent batches (`get_batcher_configs` in mixpanel-browser 2.83: `__mpq_<token>_ev`,
 * `_pp`, `_gr`). `opt_out_tracking()` empties them, but the SDK enqueues asynchronously, behind a lock it polls
 * every 100 ms, so an event accepted a moment before the switch can land in storage just after it. Nothing would
 * send it while analytics is off; it is removed anyway, so that switching back on replays nothing.
 */
export const SDK_QUEUE_KEYS = ["ev", "pp", "gr"].map(
  (suffix) => `__mpq_${TOKEN}_${suffix}`,
);

/**
 * The override sticks for the browser rather than riding the URL. `appUrl` replaces the query string on every
 * navigation out of the landing page — deliberately, so an invite can never inherit a capability — so a flag
 * read only from `location.search` would last exactly one page: `?analytics=0` would come back on at CREATE
 * ROOM, and `?analytics=1` could never reach the room half of the funnel it exists to verify.
 *
 * Only an exact `1` or `0` is honoured or stored. Treating any present value as "on" would make `?analytics=off`
 * and `?analytics=false` report a dev session into the production project, the opposite of what someone typing
 * them wants.
 */
export function analyticsOverride(
  search: string,
  storage: Pick<Storage, "getItem" | "setItem">,
): string | null {
  const found = new URLSearchParams(search).get("analytics");
  try {
    if (found === "1" || found === "0") {
      storage.setItem(OVERRIDE_KEY, found);
      return found;
    }
    return storage.getItem(OVERRIDE_KEY);
  } catch {
    return found;
  }
}

export function analyticsEnabled(
  override: string | null,
  port: string,
): boolean {
  if (override === "1") return true;
  if (override === "0") return false;
  return port === "";
}

/**
 * The same test Mixpanel's SDK applies (`navigator.doNotTrack`, the old `msDoNotTrack`, `window.doNotTrack`), so
 * this module and the SDK can never disagree about it. Applied here as well so that a browser asking not to be
 * tracked does not download 130 kB of SDK in order to be told so, and so SETTINGS can say why analytics is off.
 */
export function doNotTrackOn(flags: readonly unknown[]): boolean {
  return flags.some(
    (flag) => flag === true || flag === 1 || flag === "1" || flag === "yes",
  );
}

/**
 * Why analytics is on or off for this page, in the order the reasons win. The address and the `?analytics=0`
 * flag come first: they are not the rider's to change from SETTINGS, so the toggle there is shown disabled with
 * the reason rather than offering a switch that would do nothing.
 */
export type AnalyticsStatus =
  "on" | "flagOff" | "addressOff" | "doNotTrack" | "optedOut";

export function analyticsStatus(state: {
  override: string | null;
  port: string;
  doNotTrack: boolean;
  optedOut: boolean;
}): AnalyticsStatus {
  if (!analyticsEnabled(state.override, state.port))
    return state.override === "0" ? "flagOff" : "addressOff";
  if (state.doNotTrack) return "doNotTrack";
  return state.optedOut ? "optedOut" : "on";
}

/** The slice of Mixpanel's SDK this module calls, so a test can stand in a typed fake for it. */
export interface MixpanelLike {
  init(token: string, config: Partial<MixpanelConfig>): unknown;
  register(properties: Record<string, unknown>): void;
  track(event: string, properties?: Record<string, unknown>): unknown;
  has_opted_out_tracking(): boolean;
  opt_out_tracking(): void;
  clear_opt_in_out_tracking(): void;
}

export interface AnalyticsEnvironment {
  /** Downloads the SDK. Called at most once, and only while analytics is on. */
  load(): Promise<MixpanelLike>;
  storage: SafeStorage;
  search(): string;
  port(): string;
  doNotTrack(): boolean;
  /**
   * Calls `listener` with the key whenever ANOTHER tab changes storage (`null` for a clear) — the browser's
   * `storage` event, which never fires in the tab that made the change. Optional: where it is missing, or where
   * storage is refused and there is nothing shared to hear about, this page's own switch still works.
   */
  onStorage?(listener: (key: string | null) => void): void;
}

export interface Analytics {
  start(superProperties: Record<string, unknown>): void;
  track(event: string, properties?: Record<string, unknown>): void;
  status(): AnalyticsStatus;
  /** This device's choice from SETTINGS. Takes effect at once, in both directions, and survives a reload. */
  setOptOut(optedOut: boolean): void;
  /** `listener` runs whenever the status may have changed, from this page or another tab. Returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  reportBootFailure(error: unknown): void;
  /**
   * The arena's renderer (`webgl`, or Phaser's `canvas` fallback) is a `Graphics Ready` event and, from then on, a
   * super property. The event is what counts renderers: the first events of a solo run (`Seat Taken`,
   * `Match Started`) usually fire while Phaser is still downloading, before the super property exists. A view that
   * ends on the RETRY GRAPHICS card is a `Graphics Failed` event.
   */
  reportGraphics(event: GraphicsReport): void;
}

const ignore = () => {
  /* analytics never breaks the game */
};

export function createAnalytics(
  gameId: string,
  environment: AnalyticsEnvironment,
): Analytics {
  /**
   * Also the ordering guarantee: every `track` attaches its own reaction to this one promise, and same-promise
   * reactions run in the order they were attached, so calls made before Mixpanel loads still arrive in order.
   * They are not chained — attaching to the result of the previous `track` would serialise on each send instead.
   */
  let client: Promise<MixpanelLike> | undefined;
  /** Everything `start` has been asked to register, kept so that switching analytics back on can start late. */
  let superProperties: Record<string, unknown> | undefined;

  /** The room code on this page, which no event may carry (see `sanitizeText`'s `secrets`). */
  const secrets = (): string[] => {
    const room = new URLSearchParams(environment.search()).get("room");
    return room && /^[a-z0-9]{3,12}$/i.test(room) ? [room] : [];
  };
  const status = (): AnalyticsStatus =>
    analyticsStatus({
      override: analyticsOverride(environment.search(), environment.storage),
      port: environment.port(),
      doNotTrack: environment.doNotTrack(),
      optedOut: environment.storage.getItem(OPT_OUT_KEY) === "1",
    });
  const purgeSdkQueues = () => {
    for (const key of SDK_QUEUE_KEYS) environment.storage.removeItem(key);
  };
  const begin = () => {
    // `init` runs inside the promise: a browser that refuses storage can make Mixpanel's own persistence throw,
    // and that must reject here — where every caller already ignores it — rather than throw into page boot.
    client ??= environment.load().then((mixpanel) => {
      mixpanel.init(TOKEN, {
        ...MIXPANEL_CONFIG,
        hooks: {
          // The last gate, and the only synchronous one: the SDK runs this for each event as a batch is about to
          // be sent — on its five-second timer and as the page hides — and the status is re-read from storage
          // right then. So a switch flipped in ANOTHER tab stops this tab's next flush even if the `storage`
          // event below has not been delivered yet. Returning `null` drops the event; a batch of none sends nothing.
          before_send_events: (payload) => (status() === "on" ? payload : null),
        },
      });
      // Switching off below also tells the SDK, which remembers it in its own storage. This code only runs while
      // analytics is on, so a remembered opt-out is from before the rider switched back on.
      if (mixpanel.has_opted_out_tracking())
        mixpanel.clear_opt_in_out_tracking();
      return mixpanel;
    });
    const registered = superProperties ?? {};
    void client.then((mixpanel) => mixpanel.register(registered)).catch(ignore);
  };

  const listeners = new Set<() => void>();
  /**
   * Makes the SDK agree with the status, whoever changed it. Off: `opt_out_tracking()` stops the SDK's batch
   * sender, empties the batch it had queued and disables its unload flush — our own gate in `track` only stops
   * NEW events. On: the SDK's remembered opt-out is cleared, or the SDK is started late if this page never
   * fetched it.
   */
  const sync = () => {
    const now = status();
    if (now === "on") {
      if (client)
        void client
          .then((mixpanel) => {
            if (mixpanel.has_opted_out_tracking())
              mixpanel.clear_opt_in_out_tracking();
          })
          .catch(ignore);
      // A page that loaded switched off never fetched the SDK. Start it now, if this page ever asked to.
      else if (superProperties) begin();
    } else {
      if (now === "optedOut") purgeSdkQueues();
      void client
        ?.then((mixpanel) => mixpanel.opt_out_tracking())
        .catch(ignore);
    }
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* a SETTINGS row that cannot render is not analytics' problem, nor the next row's */
      }
    }
  };
  try {
    // Another tab switched analytics off (or back on): this tab's SDK still holds a batch and a timer of its own,
    // and its SETTINGS row still shows the old label. Deliberately deaf to `fuse-analytics`: `status()` writes
    // that key whenever the address carries `?analytics=`, so two tabs opened with opposite flags would answer
    // each other's writes for ever.
    environment.onStorage?.((key) => {
      if (key === null || key === OPT_OUT_KEY) sync();
    });
  } catch {
    /* no cross-tab channel: this page's own switch still works */
  }

  const analytics: Analytics = {
    status,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(properties) {
      superProperties = {
        ...superProperties,
        ...sanitizeProperties(properties, { secrets: secrets() }),
      };
      const now = status();
      if (now === "on") begin();
      // A page that loads switched off: whatever an earlier page left in the SDK's queue is never to be sent.
      else if (now === "optedOut") purgeSdkQueues();
    },
    track(event, properties) {
      if (!client || status() !== "on") return;
      const clean =
        properties && sanitizeProperties(properties, { secrets: secrets() });
      void client
        .then((mixpanel) => {
          // Checked again here: SETTINGS can switch analytics off between this call and the SDK arriving.
          if (status() === "on")
            mixpanel.track(EVENT_PREFIX + event, { ...clean, gameId });
        })
        .catch(ignore);
    },
    setOptOut(optedOut) {
      if (optedOut) environment.storage.setItem(OPT_OUT_KEY, "1");
      else {
        environment.storage.removeItem(OPT_OUT_KEY);
        purgeSdkQueues(); // nothing from the time it was off is replayed
      }
      sync();
    },
    /**
     * Registers nothing of its own: a boot failure raised after a room already registered its `role` would
     * otherwise relabel every later event on the page as `boot`. The role travels on the event instead.
     */
    reportGraphics(event) {
      if (event.kind === "ready") {
        analytics.start({ renderer: event.renderer });
        analytics.track("Graphics Ready");
      } else analytics.track("Graphics Failed", { stage: event.stage });
    },
    reportBootFailure(error) {
      analytics.start({});
      analytics.track("Boot Failed", {
        ...bootFailedProps(error, { secrets: secrets() }),
        role: "boot",
      });
    },
  };
  return analytics;
}

/**
 * The page's one instance. Every browser global is read inside a function, and storage only through
 * `safeStorage`: Safari with "Block all cookies" throws on merely evaluating `localStorage`, and this runs
 * during boot.
 */
export function createBrowserAnalytics(gameId: string): Analytics {
  return createAnalytics(gameId, {
    load: () => import("mixpanel-browser").then((module) => module.default),
    storage: safeStorage(() => localStorage),
    search: () => location.search,
    port: () => location.port,
    doNotTrack: () =>
      doNotTrackOn([
        navigator.doNotTrack,
        (navigator as { msDoNotTrack?: unknown }).msDoNotTrack,
        (window as { doNotTrack?: unknown }).doNotTrack,
      ]),
    onStorage: (listener) =>
      window.addEventListener("storage", (event) => listener(event.key)),
  });
}
