/**
 * Product analytics: which riders reach a match, and what happened when they did.
 *
 * Twelve events, all prefixed `FlowRiders.` (`EVENT_PREFIX`). Nothing fires per tick, per pickup or per explosion
 * — a match's detail rides along on `FlowRiders.Match Ended`, read from the same authoritative `matchStats` the
 * recap renders. The exception is weapons: `Kill` and `Miss` fire once per kill and once per shot that killed
 * nobody, after each round, so which powerup kills and how often it misses can be counted directly. This is
 * separate from `telemetry.ts`, which posts raw runtime diagnostics to the dev server; this posts product events
 * to Mixpanel from real play.
 *
 * Off on local dev (a port in the address) so test rooms never reach the production project, on with
 * `?analytics=1` to verify a build, off outright with `?analytics=0`, off where the browser sends Do Not Track,
 * and off on a device that switched it off in SETTINGS. The Mixpanel bundle is imported only once analytics is
 * on, so none of those ever downloads it. When each event fires is `funnel.ts`; what free text may leave is
 * `analytics-text.ts`; `docs/ANALYTICS.md` is the account of all of it.
 */
import { TICK_HZ } from "../engine/game.js";
import { BOT_ID_PREFIX } from "../engine/bot-controller.js";
import type { MatchPlayerStats } from "../engine/match-stats.js";
import type { DecidedRound, RoundShot } from "../engine/shot-log.js";
import { safeStorage, type SafeStorage } from "../client/safe-storage.js";
import type { GraphicsReport } from "../client/phaser/presentation.js";
import { bootFailedProps, sanitizeProperties } from "./analytics-text.js";

type MixpanelConfig = import("mixpanel-browser").Config;

/** A Mixpanel project token is a write-only public identifier — every browser bundle reporting to a project ships one. It is not a credential and grants no read access. */
const TOKEN = "b5022dd7fe5b3cd0396d84284ae647e6";
/**
 * Every event name starts with this. It is the game's former name, and it stays: renaming it would split the
 * Mixpanel project's history in two, so that is the project owner's call and not a refactor's.
 */
export const EVENT_PREFIX = "FlowRiders.";

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

export function createAnalytics(environment: AnalyticsEnvironment): Analytics {
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
          if (status() === "on") mixpanel.track(EVENT_PREFIX + event, clean);
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
const page = createAnalytics({
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

/**
 * Safe to call more than once: the landing page, a room and the boot-failure path all call it, and only the
 * first loads Mixpanel. Every call registers its super properties, so a later caller merges over an earlier
 * one's — which is what the boot-failure path wants when it reports against a room that had already started.
 */
export const startAnalytics = page.start;
/**
 * Never name a property `length`. Mixpanel's bundled Underscore-style `each` treats any object whose `length`
 * is a number as an array, so a single `length` key makes it iterate indices instead of keys and the whole
 * property bag — super properties included — is dropped silently, with a 200 back from the API. Room settings
 * call theirs `length`; they are reported as `matchLength`.
 *
 * Every string property is bounded and scrubbed on the way out (`analytics-text.ts`).
 */
export const track = page.track;
export const analyticsStatusNow = page.status;
export const setAnalyticsOptOut = page.setOptOut;
export const onAnalyticsChange = page.onChange;
export const reportBootFailure = page.reportBootFailure;
export const reportGraphics = page.reportGraphics;

const seconds = (ticks: number) => Math.round(ticks / TICK_HZ);
/** Tenths, where whole seconds would put nearly every Gun, Target and Shell kill in the same bucket. */
const tenths = (ticks: number) => Math.round((ticks / TICK_HZ) * 10) / 10;

/**
 * Identifies the snapshot that begins a match, or `undefined` for every other snapshot. Callers report a match
 * start whenever this returns a key they have not already reported.
 *
 * Keyed on the first round of a match id rather than on a phase transition: every round opens with its own
 * countdown, so `lobby -> countdown` would count rounds, and solo never passes through the lobby at all —
 * `LocalRuntime.start` seats four bots and starts the match before the first snapshot reaches the UI, so its
 * first observed phase is already `countdown`. A rematch takes a fresh match id and returns to round 1, so it
 * keys apart from the match before it; a device that joins at round 3 reports no start, which is the truth.
 */
export function matchStartKey(
  matchId: string,
  phase: string,
  round: number,
): string | undefined {
  return phase === "countdown" && round === 1
    ? `${matchId}:${round}`
    : undefined;
}

/**
 * One event per finished match, from the authoritative end-of-match stats. `playerId` is this device's rider:
 * a shared-TV display or a spectator has none, and reports only the shape of the match it watched.
 */
export function matchEndedProps(
  stats: readonly MatchPlayerStats[],
  playerId: string,
): Record<string, unknown> {
  const botCount = stats.filter((entry) =>
    entry.playerId.startsWith(BOT_ID_PREFIX),
  ).length;
  const mine = stats.find((entry) => entry.playerId === playerId);
  return {
    playerCount: stats.length,
    botCount,
    humanCount: stats.length - botCount,
    rounds: stats.reduce(
      (most, entry) => Math.max(most, entry.roundsPlayed),
      0,
    ),
    played: Boolean(mine),
    ...(mine
      ? {
          placement: mine.matchPlacement,
          won: mine.matchPlacement === 1,
          roundWins: mine.roundWins,
          eliminations: mine.eliminations,
          pickups: mine.pickupsCollected,
          bombsPlaced: mine.bombsPlaced,
          bombsExploded: mine.bombsExploded,
          distance: Math.round(mine.distanceUnits),
          survivalSeconds: seconds(mine.survivalTicks),
          // Optional chaining rather than trust: this is built inside the host's publish loop, where a throw stops
          // the room publishing for everyone, so the invariant belongs here and not only in the code upstream.
          deathsWall: mine.deathsByCause?.wall,
          deathsTrail: mine.deathsByCause?.trail,
          deathsExplosion: mine.deathsByCause?.explosion,
          deathsRider: mine.deathsByCause?.rider,
        }
      : {}),
  };
}

export interface AnalyticsEvent {
  event: string;
  properties: Record<string, unknown>;
}

/**
 * One `Kill` per rider this device's rider killed and one `Miss` per pull of its own that killed nobody, for a
 * decided round. Only the shooter's own device reports its shots, so every kill and miss is sent exactly once
 * however many devices are in the room; a shared-TV display and a spectator report none, and nobody reports a
 * bot's shots.
 *
 * Why after the round rather than live: replicas simulate ahead of confirmed input, and a rollback cannot retract
 * an event already sent, so a live kill could be one that never happened. See `decidedRoundReport` for when.
 *
 * `shotKills` is how many riders the pull killed, so a double kill is two `Kill` events that agree on it, and
 * `firstKillOfShot` marks exactly one of them: hit rate is `count(Kill where firstKillOfShot) / (that + count(Miss))`.
 *
 * Every event carries what might explain its outcome, so any of it can be a histogram's breakdown: the shooter's
 * upgrades at the pull (`power`, `extraBombs`, `fuseLevel`, `grip`), how many bombs the pull launched, and the room
 * it happened in (`riders`, `bots`).
 */
export interface RoundContext {
  round: number;
  riders: number;
  bots: number;
}
export function roundShotEvents(
  shots: readonly RoundShot[],
  playerId: string,
  { round, riders, bots }: RoundContext,
): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  for (const shot of shots) {
    if (!playerId || shot.shooterId !== playerId) continue;
    const pulled = {
      weapon: shot.weapon,
      round,
      secondsIntoRound: tenths(shot.elapsed),
      bombs: shot.bombs,
      power: shot.power,
      extraBombs: shot.extraBombs,
      fuseLevel: shot.fuseLevel,
      rangeLevel: shot.rangeLevel,
      grip: shot.grip,
      riders,
      bots,
    };
    if (shot.kills.length === 0) {
      events.push({ event: "Miss", properties: pulled });
      continue;
    }
    shot.kills.forEach((kill, index) =>
      events.push({
        event: "Kill",
        properties: {
          ...pulled,
          victimBot: kill.victimId.startsWith(BOT_ID_PREFIX),
          shotKills: shot.kills.length,
          firstKillOfShot: index === 0,
          secondsToKill: tenths(kill.elapsed - shot.elapsed),
        },
      }),
    );
  }
  return events;
}

/**
 * Whether this device should report a decided round now: the key to remember and the events to send, or `undefined`.
 *
 * A snapshot this device renders is its own prediction, so a decided round in it can still be undone by a late
 * packet. The round is final only once every connected rider's input is confirmed through the tick it was decided
 * at, which is what `confirmedTick` must be. The simulation keeps the decided log until the next round is decided,
 * so a device that catches up past the round-over pause in one jump still finds it here.
 *
 * The key names the rider as well as the round, so a second tab seated as a different rider still reports its own,
 * while a reload or a reopened tab of the same rider does not report the same round twice. A device with no rider
 * yet consumes nothing: it may learn its seat on the next snapshot.
 */
export function decidedRoundReport(
  decided: DecidedRound | undefined,
  playerId: string,
  confirmedTick: number,
  reported: string,
  room: { riders: number; bots: number },
): { key: string; events: AnalyticsEvent[] } | undefined {
  if (!decided || !playerId || decided.tick > confirmedTick) return undefined;
  const key = `${decided.matchId}:${decided.round}:${playerId}`;
  if (key === reported) return undefined;
  return {
    key,
    events: roundShotEvents(decided.shots, playerId, {
      round: decided.round,
      ...room,
    }),
  };
}
