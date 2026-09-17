import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_PREFIX,
  MIXPANEL_CONFIG,
  OPT_OUT_KEY,
  SDK_QUEUE_KEYS,
  analyticsEnabled,
  analyticsOverride,
  analyticsStatus,
  createAnalytics,
  doNotTrackOn,
  matchEndedProps,
  matchStartKey,
  decidedRoundReport,
  roundShotEvents,
  type AnalyticsEnvironment,
  type MixpanelLike,
} from "../src/online/analytics.js";
import {
  ANALYTICS_NOTICE,
  consentView,
} from "../src/online/analytics-consent.js";
import {
  createMemoryStorage,
  safeStorage,
  type SafeStorage,
} from "../src/client/safe-storage.js";
import type { DecidedRound, RoundShot } from "../src/shared/shot-log.js";
import { BOT_ID_PREFIX } from "../src/shared/bot-controller.js";
import type { MatchPlayerStats } from "../src/shared/match-stats.js";

function rider(
  overrides: Partial<MatchPlayerStats> & {
    playerId: string;
    slot: number;
    matchPlacement: number;
  },
): MatchPlayerStats {
  return {
    name: overrides.playerId.toUpperCase(),
    color: `#00000${overrides.slot}`,
    roundsPlayed: 0,
    matchScoreUnits: 0,
    roundWins: 0,
    roundsDrawn: 0,
    survivalTicks: 0,
    longestSurvivalTicks: 0,
    distanceUnits: 0,
    bombsPlaced: 0,
    bombsExploded: 0,
    eliminations: 0,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 },
    pickupsCollected: 0,
    powerPickups: 0,
    starPickups: 0,
    beerPickups: 0,
    inkPickups: 0,
    triplePickups: 0,
    fivePickups: 0,
    targetPickups: 0,
    shieldPickups: 0,
    portalPickups: 0,
    portalTransits: 0,
    invulnerableTicks: 0,
    wallBounces: 0,
    earlyExits: 0,
    ...overrides,
  };
}

const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
};

test("analytics stays off on a LAN or dev address and obeys the explicit override either way", () => {
  assert.equal(
    analyticsEnabled(null, "5173"),
    false,
    "a port means local dev or LAN play",
  );
  assert.equal(
    analyticsEnabled(null, ""),
    true,
    "the deployed site has no port",
  );
  assert.equal(
    analyticsEnabled("1", "5173"),
    true,
    "forced on to verify a build",
  );
  assert.equal(
    analyticsEnabled("0", ""),
    false,
    "forced off beats every other rule",
  );
});

test("only 1 and 0 override the address, so a plausible-looking opt-out cannot switch reporting on", () => {
  // Reading any `analytics` value as "on" would make each of these report a dev session into the production project.
  for (const value of ["off", "false", "no", "00", "", "true", "2"]) {
    assert.equal(
      analyticsEnabled(value, "5173"),
      false,
      `${value} must not enable a dev address`,
    );
    assert.equal(
      analyticsEnabled(value, ""),
      true,
      `${value} must not disable the deployed site`,
    );
  }
});

test("the override sticks for the browser, because appUrl drops the query on the way into a room", () => {
  const storage = fakeStorage();
  assert.equal(analyticsOverride("?analytics=0", storage), "0");
  // CREATE ROOM lands on `?room=AB42`: appUrl replaces the query string, so the flag is gone from the URL.
  assert.equal(
    analyticsOverride("?room=AB42", storage),
    "0",
    "the opt-out must outlive the navigation that drops it",
  );
  assert.equal(
    analyticsEnabled(analyticsOverride("?room=AB42", storage), ""),
    false,
  );
  // ...and the same in reverse, so ?analytics=1 can verify the room half of the funnel, not just the landing page.
  assert.equal(analyticsOverride("?analytics=1", storage), "1");
  assert.equal(
    analyticsEnabled(analyticsOverride("?room=AB42", storage), "5173"),
    true,
  );
});

test("a junk override neither overwrites a stored choice nor is stored itself", () => {
  const storage = fakeStorage({ "fuse-analytics": "0" });
  assert.equal(
    analyticsOverride("?analytics=maybe", storage),
    "0",
    "junk falls through to the stored choice",
  );
  assert.equal(storage.values.get("fuse-analytics"), "0");
  assert.equal(
    analyticsOverride("", fakeStorage()),
    null,
    "no flag and nothing stored falls through to the address",
  );
});

test("a browser that refuses storage still honours the flag in the address", () => {
  const sealed = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(analyticsOverride("?analytics=0", sealed), "0");
  assert.equal(
    analyticsOverride("?room=AB42", sealed),
    null,
    "without storage it cannot stick, and must not throw",
  );
});

test("a finished match reports the arena shape and this device rider own line", () => {
  const stats = [
    rider({
      playerId: "me",
      slot: 0,
      matchPlacement: 1,
      roundsPlayed: 3,
      roundWins: 2,
      eliminations: 4,
      pickupsCollected: 7,
      bombsPlaced: 9,
      bombsExploded: 6,
      distanceUnits: 512.4,
      survivalTicks: 130,
      deathsByCause: { wall: 1, trail: 2, explosion: 0, rider: 3 },
    }),
    rider({
      playerId: `${BOT_ID_PREFIX}1`,
      slot: 1,
      matchPlacement: 2,
      roundsPlayed: 3,
    }),
    rider({
      playerId: `${BOT_ID_PREFIX}2`,
      slot: 2,
      matchPlacement: 3,
      roundsPlayed: 2,
    }),
  ];
  assert.deepEqual(matchEndedProps(stats, "me"), {
    playerCount: 3,
    botCount: 2,
    humanCount: 1,
    rounds: 3,
    played: true,
    placement: 1,
    won: true,
    roundWins: 2,
    eliminations: 4,
    pickups: 7,
    bombsPlaced: 9,
    bombsExploded: 6,
    distance: 512,
    survivalSeconds: 7,
    deathsWall: 1,
    deathsTrail: 2,
    deathsExplosion: 0,
    deathsRider: 3,
  });
});

test("a shared-TV display reports the match it watched without inventing a rider line", () => {
  const stats = [
    rider({ playerId: "a", slot: 0, matchPlacement: 1, roundsPlayed: 5 }),
    rider({ playerId: "b", slot: 1, matchPlacement: 2, roundsPlayed: 4 }),
  ];
  assert.deepEqual(matchEndedProps(stats, ""), {
    playerCount: 2,
    botCount: 0,
    humanCount: 2,
    rounds: 5,
    played: false,
  });
  assert.deepEqual(matchEndedProps([], "me"), {
    playerCount: 0,
    botCount: 0,
    humanCount: 0,
    rounds: 0,
    played: false,
  });
});

test("a runner-up is not recorded as a winner", () => {
  const stats = [
    rider({
      playerId: "me",
      slot: 0,
      matchPlacement: 2,
      roundsPlayed: 3,
      roundWins: 1,
    }),
  ];
  const props = matchEndedProps(stats, "me");
  assert.equal(props.won, false);
  assert.equal(props.placement, 2);
});

test("a match start is the first round of a match id, not a countdown", () => {
  // Every round opens with its own countdown, so rounds 2+ must not read as a new match.
  assert.equal(matchStartKey("m1", "countdown", 1), "m1:1");
  assert.equal(matchStartKey("m1", "countdown", 2), undefined);
  assert.equal(matchStartKey("m1", "countdown", 5), undefined);
  // Solo never passes through the lobby: LocalRuntime seats its bots and starts before the first snapshot,
  // so the very first phase the UI sees is already the round-1 countdown and must still count as a start.
  assert.equal(matchStartKey("solo-match", "countdown", 1), "solo-match:1");
  // A rematch takes a fresh match id back to round 1, so it keys apart from the match before it.
  assert.notEqual(
    matchStartKey("m2", "countdown", 1),
    matchStartKey("m1", "countdown", 1),
  );
  for (const phase of ["lobby", "playing", "roundOver", "matchOver"]) {
    assert.equal(
      matchStartKey("m1", phase, 1),
      undefined,
      `${phase} does not begin a match`,
    );
  }
});

test("a decided round is reported once, only after every rider has confirmed it, and only by its own rider", () => {
  const pull = (
    shot: number,
    shooterId: string,
    kills: RoundShot["kills"] = [],
  ): RoundShot => ({
    shot,
    shooterId,
    weapon: "bomb",
    elapsed: 20,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    grip: false,
    kills,
  });
  const decided: DecidedRound = {
    matchId: "m1",
    round: 2,
    tick: 500,
    shots: [pull(1, "me", [{ victimId: "you", elapsed: 60 }]), pull(4, "you")],
  };
  const room = { riders: 2, bots: 0 };

  // This device renders its own prediction: until the decision tick is confirmed, a late packet could still undo it.
  assert.equal(
    decidedRoundReport(decided, "me", 499, "", room),
    undefined,
    "not while the decision is speculative",
  );
  const report = decidedRoundReport(decided, "me", 500, "", room)!;
  assert.deepEqual(
    report.events.map((entry) => entry.event),
    ["Kill"],
  );
  // The snapshot keeps arriving twenty times a second, and the log stays in state through the whole next round.
  assert.equal(
    decidedRoundReport(decided, "me", 900, report.key, room),
    undefined,
    "never twice for the same round",
  );
  assert.equal(
    decidedRoundReport(undefined, "me", 900, report.key, room),
    undefined,
    "nothing decided yet",
  );

  // Each device reports only its own rider's pulls, so the two devices together send each outcome once.
  const theirs = decidedRoundReport(decided, "you", 500, report.key, room)!;
  assert.notEqual(
    theirs.key,
    report.key,
    "a second tab seated as another rider in this browser still reports its own",
  );
  assert.deepEqual(
    theirs.events.map((entry) => entry.event),
    ["Miss"],
  );

  // A device that does not know its seat yet consumes nothing, so it can still report once it does.
  assert.equal(decidedRoundReport(decided, "", 900, "", room), undefined);
  // The next round, or a rematch reusing round numbers, is a new key.
  assert.ok(
    decidedRoundReport(
      { ...decided, round: 3, tick: 800 },
      "me",
      900,
      report.key,
      room,
    ),
  );
  assert.ok(
    decidedRoundReport(
      { ...decided, matchId: "m2" },
      "me",
      900,
      report.key,
      room,
    ),
  );
});

test("each kill is its own event and a double kill marks exactly one of them as the first", () => {
  const shots: RoundShot[] = [
    {
      shot: 1,
      shooterId: "me",
      weapon: "five",
      elapsed: 40,
      bombs: 7,
      power: 12,
      extraBombs: 2,
      fuseLevel: 1,
      grip: true,
      kills: [
        { victimId: `${BOT_ID_PREFIX}1`, elapsed: 120 },
        { victimId: "friend", elapsed: 120 },
      ],
    },
    {
      shot: 7,
      shooterId: "me",
      weapon: "gun",
      elapsed: 300,
      bombs: 1,
      power: 0,
      extraBombs: 0,
      fuseLevel: 0,
      grip: false,
      kills: [],
    },
    {
      shot: 9,
      shooterId: "friend",
      weapon: "shell",
      elapsed: 310,
      bombs: 1,
      power: 0,
      extraBombs: 0,
      fuseLevel: 0,
      grip: false,
      kills: [{ victimId: "me", elapsed: 330 }],
    },
  ];
  const room = { round: 4, riders: 5, bots: 2 };
  // Everything a histogram might break down by rides on each event: the pull's upgrades and the room it was in.
  const five = {
    weapon: "five",
    round: 4,
    secondsIntoRound: 2,
    bombs: 7,
    power: 12,
    extraBombs: 2,
    fuseLevel: 1,
    grip: true,
    riders: 5,
    bots: 2,
  };
  assert.deepEqual(roundShotEvents(shots, "me", room), [
    {
      event: "Kill",
      properties: {
        ...five,
        victimBot: true,
        shotKills: 2,
        firstKillOfShot: true,
        secondsToKill: 4,
      },
    },
    {
      event: "Kill",
      properties: {
        ...five,
        victimBot: false,
        shotKills: 2,
        firstKillOfShot: false,
        secondsToKill: 4,
      },
    },
    {
      event: "Miss",
      properties: {
        weapon: "gun",
        round: 4,
        secondsIntoRound: 15,
        bombs: 1,
        power: 0,
        extraBombs: 0,
        fuseLevel: 0,
        grip: false,
        riders: 5,
        bots: 2,
      },
    },
  ]);
  // Hit rate from events alone: pulls that killed, over every pull.
  const events = roundShotEvents(shots, "me", room);
  const hits = events.filter(
    (entry) => entry.event === "Kill" && entry.properties.firstKillOfShot,
  ).length;
  assert.equal(
    hits / (hits + events.filter((entry) => entry.event === "Miss").length),
    0.5,
  );
  // Only the shooter sends: across every device in the room, each kill and each miss is reported exactly once.
  const everyone = ["me", "friend", `${BOT_ID_PREFIX}1`, ""].flatMap((id) =>
    roundShotEvents(shots, id, room),
  );
  assert.equal(everyone.filter((entry) => entry.event === "Kill").length, 3);
  assert.equal(everyone.filter((entry) => entry.event === "Miss").length, 1);
  for (const entry of everyone)
    assert.equal(
      Object.hasOwn(entry.properties, "length"),
      false,
      "a length property silently drops the bag",
    );
});

/**
 * A typed stand-in for Mixpanel's SDK with the one behaviour that matters to opting out: `track` only queues,
 * and the queue reaches the transport on a later flush (the real SDK flushes every five seconds and on unload).
 * `opt_out_tracking` stops that and empties the queue, as `stop_batch_senders` does in mixpanel-browser 2.83.
 */
function fakeSdk(transport: { url: string; events: string[] }[]) {
  let optedOut = false;
  let queue: string[] = [];
  const calls: string[] = [];
  const registered: Record<string, unknown>[] = [];
  const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
  let config: Partial<import("mixpanel-browser").Config> | undefined;
  const sdk: MixpanelLike = {
    init(_token, initConfig) {
      calls.push("init");
      config = initConfig;
    },
    register(properties) {
      registered.push(properties);
    },
    track(event, properties) {
      if (optedOut) return;
      tracked.push(properties ? { event, properties } : { event });
      queue.push(event);
    },
    has_opted_out_tracking: () => optedOut,
    opt_out_tracking() {
      calls.push("opt_out");
      optedOut = true;
      queue = [];
    },
    clear_opt_in_out_tracking() {
      calls.push("clear_opt");
      optedOut = false;
    },
  };
  return {
    sdk,
    calls,
    registered,
    tracked,
    config: () => config,
    /** The SDK's batch timer or unload handler firing: each event passes the `before_send_events` hook, as in 2.83. */
    flush() {
      if (optedOut) return;
      const hook = config?.hooks?.before_send_events;
      queue = queue.filter((event) =>
        hook ? hook({ event, properties: {} }) !== null : true,
      );
      if (!queue.length) return;
      transport.push({
        url: `https://api-js.mixpanel.com/track/?ip=${config?.ip ? 1 : 0}`,
        events: queue,
      });
      queue = [];
    },
    rememberOptOut() {
      optedOut = true;
    },
  };
}

const seededStorage = (initial: Record<string, string>): SafeStorage => {
  const storage = createMemoryStorage();
  for (const [key, value] of Object.entries(initial))
    storage.setItem(key, value);
  return storage;
};

/** Lets every reaction already attached to a settled promise run. No timers. */
const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

function page(
  options: {
    search?: string;
    port?: string;
    doNotTrack?: boolean;
    storage?: SafeStorage;
  } = {},
) {
  const transport: { url: string; events: string[] }[] = [];
  const fake = fakeSdk(transport);
  let loads = 0;
  const storageListeners: ((key: string | null) => void)[] = [];
  const environment: AnalyticsEnvironment = {
    onStorage: (listener) => {
      storageListeners.push(listener);
    },
    load: () => {
      loads += 1;
      return Promise.resolve(fake.sdk);
    },
    storage: options.storage ?? createMemoryStorage(),
    search: () => options.search ?? "",
    port: () => options.port ?? "",
    doNotTrack: () => options.doNotTrack ?? false,
  };
  return {
    analytics: createAnalytics(environment),
    environment,
    transport,
    fake,
    loads: () => loads,
    /** The browser telling this tab that another tab changed `key`. */
    storageEvent: (key: string | null) =>
      storageListeners.forEach((listener) => listener(key)),
  };
}

test("Mixpanel is initialised without IP geolocation, page URLs, pageviews, autocapture or a parent-domain cookie", async () => {
  const { analytics, fake } = page();
  analytics.start({ role: "landing" });
  await settle();
  const { hooks, ...config } = fake.config() ?? {};
  assert.deepEqual(config, MIXPANEL_CONFIG);
  assert.deepEqual(Object.keys(hooks ?? {}), ["before_send_events"]);
  assert.deepEqual(MIXPANEL_CONFIG, {
    persistence: "localStorage",
    cross_subdomain_cookie: false,
    ip: false,
    ignore_dnt: false,
    track_pageview: false,
    autocapture: false,
    property_blacklist: ["$current_url", "$referrer", "$initial_referrer"],
  });
});

test("every event carries the one prefix, in call order, and only the first start loads the SDK", async () => {
  const { analytics, fake, loads } = page();
  analytics.track("Too Early");
  analytics.start({ role: "host", mode: "shared", solo: false });
  analytics.track("App Opened");
  analytics.track("Seat Taken", { avatarId: "fox", playerCount: 2 });
  analytics.start({});
  await settle();
  assert.equal(EVENT_PREFIX, "FlowRiders.");
  assert.deepEqual(fake.tracked, [
    { event: "FlowRiders.App Opened" },
    {
      event: "FlowRiders.Seat Taken",
      properties: { avatarId: "fox", playerCount: 2 },
    },
  ]);
  assert.equal(loads(), 1);
  assert.deepEqual(fake.registered.at(-1), {
    role: "host",
    mode: "shared",
    solo: false,
  });
});

test("off for the address, the flag or Do Not Track means the SDK is never even downloaded", async () => {
  for (const [options, status] of [
    [{ port: "8831" }, "addressOff"],
    [{ search: "?analytics=0" }, "flagOff"],
    [{ doNotTrack: true }, "doNotTrack"],
    [{ doNotTrack: true, search: "?analytics=1", port: "8831" }, "doNotTrack"],
  ] as const) {
    const { analytics, loads, transport, fake } = page(options);
    analytics.start({ role: "landing" });
    analytics.track("App Opened");
    analytics.setOptOut(false);
    await settle();
    fake.flush();
    assert.equal(analytics.status(), status);
    assert.equal(loads(), 0, status);
    assert.deepEqual(transport, [], status);
  }
  assert.equal(
    page({ port: "8831", search: "?analytics=1" }).analytics.status(),
    "on",
  );
});

test("switching analytics off in SETTINGS stops every request at once, including the batch already queued", async () => {
  const { analytics, transport, fake, environment } = page({
    search: "?room=AB42",
  });
  analytics.start({ role: "joiner" });
  analytics.track("App Opened");
  await settle();
  fake.flush();
  assert.equal(transport.length, 1);
  assert.match(transport[0]!.url, /[?&]ip=0\b/);

  analytics.track("Seat Taken");
  await settle(); // accepted by the SDK, and waiting in its batch for the next flush
  analytics.setOptOut(true);
  analytics.track("Match Started");
  await settle();
  fake.flush();
  assert.equal(analytics.status(), "optedOut");
  assert.equal(environment.storage.getItem(OPT_OUT_KEY), "1");
  assert.equal(transport.length, 1, "nothing after the opt-out");
  assert.deepEqual(
    fake.tracked.map((entry) => entry.event),
    ["FlowRiders.App Opened", "FlowRiders.Seat Taken"],
  );

  // And back on, in the same page: the SDK is told, and events flow again.
  analytics.setOptOut(false);
  analytics.track("Match Ended");
  await settle();
  fake.flush();
  assert.equal(environment.storage.getItem(OPT_OUT_KEY), null);
  assert.deepEqual(transport[1]?.events, ["FlowRiders.Match Ended"]);
});

test("an opt-out that lands while the SDK is still downloading wins over the calls made before it", async () => {
  const { analytics, transport, fake } = page();
  analytics.start({ role: "landing" });
  analytics.track("App Opened");
  analytics.setOptOut(true); // before a single microtask has run
  await settle();
  fake.flush();
  assert.deepEqual(fake.tracked, []);
  assert.deepEqual(transport, []);
  assert.ok(fake.calls.includes("opt_out"));
});

test("the choice survives a reload: a page that loads opted out never downloads the SDK, and can be switched back on", async () => {
  const storage = createMemoryStorage();
  const before = page({ storage });
  before.analytics.start({ role: "landing" });
  before.analytics.setOptOut(true);
  await settle();

  const reloaded = page({ storage });
  // Mixpanel remembers the opt-out in its own storage too; model that on the fresh SDK.
  reloaded.fake.rememberOptOut();
  reloaded.analytics.start({ role: "host", mode: "shared" });
  reloaded.analytics.track("App Opened");
  await settle();
  assert.equal(reloaded.analytics.status(), "optedOut");
  assert.equal(reloaded.loads(), 0);

  reloaded.analytics.setOptOut(false);
  reloaded.analytics.track("Recap Reopened");
  await settle();
  reloaded.fake.flush();
  assert.equal(reloaded.loads(), 1);
  assert.deepEqual(reloaded.fake.calls, ["init", "clear_opt"]);
  assert.deepEqual(reloaded.fake.registered, [
    { role: "host", mode: "shared" },
  ]);
  assert.deepEqual(reloaded.transport[0]?.events, [
    "FlowRiders.Recap Reopened",
  ]);

  // Switching on a page that never asked for analytics to start does not start it.
  const idle = page({ storage });
  idle.analytics.setOptOut(false);
  await settle();
  assert.equal(idle.loads(), 0);
});

test("a browser that refuses storage, and an SDK that cannot start in it, never break boot", async () => {
  const refused = (): Storage => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  const { environment } = page({ storage: safeStorage(refused) });
  let rejected = 0;
  const analytics = createAnalytics({
    ...environment,
    load: () =>
      Promise.resolve<MixpanelLike>({
        ...fakeSdk([]).sdk,
        init() {
          rejected += 1;
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      }),
  });
  assert.doesNotThrow(() => {
    analytics.start({ role: "landing" });
    analytics.track("App Opened");
    analytics.setOptOut(true);
    analytics.setOptOut(false);
    analytics.reportBootFailure(new Error("boom"));
  });
  await settle();
  assert.equal(rejected, 1, "init ran, threw, and nobody heard about it");

  // The same when the SDK chunk itself fails to download.
  const offline = createAnalytics({
    ...environment,
    load: () => Promise.reject(new Error("chunk failed")),
  });
  offline.start({ role: "landing" });
  offline.track("App Opened");
  offline.setOptOut(true);
  await settle();
});

test("a boot failure leaves as a class, a code and a scrubbed message, without relabelling the room's later events", async () => {
  const { analytics, fake } = page({ search: "?room=AB42" });
  analytics.start({ role: "host" });
  analytics.reportBootFailure(
    new TypeError(
      `Failed to fetch dynamically imported module: https://fuse.example/assets/ui.js?room=AB42 ${"x".repeat(5000)}`,
    ),
  );
  await settle();
  assert.deepEqual(fake.tracked, [
    {
      event: "FlowRiders.Boot Failed",
      properties: {
        name: "TypeError",
        code: "module-load",
        message:
          "Failed to fetch dynamically imported module: [url] [truncated]",
        role: "boot",
      },
    },
  ]);
  assert.deepEqual(fake.registered.at(-1), { role: "host" });
});

test("free text in any event is scrubbed of this page's room code on the way out", async () => {
  const { analytics, fake } = page({ search: "?room=ab42" });
  analytics.start({ role: "joiner", note: "room AB42" });
  analytics.track("Connect Failed", {
    status: "Room AB42: no link to https://fuse.example/?room=AB42",
    secondsWaiting: 20,
  });
  await settle();
  assert.deepEqual(fake.registered, [
    { role: "joiner", note: "room [redacted]" },
  ]);
  assert.deepEqual(fake.tracked[0]?.properties, {
    status: "Room [redacted]: no link to [url]",
    secondsWaiting: 20,
  });
  // A `room` parameter that is not a code is not treated as a secret to hunt for.
  const odd = page({ search: "?room=the+whole+sentence" });
  odd.analytics.start({});
  odd.analytics.track("Connect Failed", { status: "the link failed" });
  await settle();
  assert.equal(odd.fake.tracked[0]?.properties?.status, "the link failed");
});

test("the reason analytics is off is decided in a fixed order", () => {
  const base = { override: null, port: "", doNotTrack: false, optedOut: false };
  assert.equal(analyticsStatus(base), "on");
  assert.equal(analyticsStatus({ ...base, optedOut: true }), "optedOut");
  assert.equal(
    analyticsStatus({ ...base, optedOut: true, doNotTrack: true }),
    "doNotTrack",
  );
  assert.equal(
    analyticsStatus({
      ...base,
      port: "8831",
      optedOut: true,
      doNotTrack: true,
    }),
    "addressOff",
  );
  assert.equal(analyticsStatus({ ...base, override: "0" }), "flagOff");
  assert.equal(
    analyticsStatus({ ...base, override: "1", port: "8831", optedOut: true }),
    "optedOut",
    "?analytics=1 overrides the address, never the rider's own choice",
  );
});

test("Do Not Track is read exactly as Mixpanel's SDK reads it", () => {
  for (const on of [true, 1, "1", "yes"])
    assert.equal(doNotTrackOn([undefined, on]), true, String(on));
  for (const off of [undefined, null, "0", "no", "unspecified", 0, false])
    assert.equal(doNotTrackOn([off, off, off]), false, String(off));
});

test("SETTINGS says what is true for each status, and only offers a switch that does something", () => {
  assert.deepEqual(consentView("on"), {
    label: "ANALYTICS ON",
    on: true,
    locked: false,
    reason: "",
  });
  assert.deepEqual(consentView("optedOut"), {
    label: "ANALYTICS OFF",
    on: false,
    locked: false,
    reason: "Off on this device. Nothing is sent.",
  });
  for (const status of ["addressOff", "flagOff", "doNotTrack"] as const) {
    const view = consentView(status);
    assert.equal(view.label, "ANALYTICS OFF");
    assert.equal(view.locked, true, status);
    assert.match(view.reason, /Nothing is sent\.$/);
  }
  assert.match(ANALYTICS_NOTICE, /Mixpanel/);
  assert.ok(!ANALYTICS_NOTICE.includes("\n"), "one line");
});

test("a second tab stops sending when another tab opts out: at the next flush, and for good once the storage event arrives", async () => {
  const storage = createMemoryStorage(); // one browser, two tabs
  const tabA = page({ storage });
  const tabB = page({ storage });
  tabA.analytics.start({ role: "landing" });
  tabA.analytics.track("App Opened");
  await settle(); // accepted by A's SDK, waiting in A's batch
  tabB.analytics.start({ role: "landing" });
  await settle();

  tabB.analytics.setOptOut(true);
  await settle();
  // Before the browser has delivered the storage event, A's five-second timer fires: the hook re-reads storage.
  tabA.fake.flush();
  assert.equal(
    tabA.transport.length,
    0,
    "A's queued App Opened is dropped at the flush",
  );
  assert.equal(tabA.analytics.status(), "optedOut");

  let rendered = 0;
  tabA.analytics.onChange(() => (rendered += 1));
  tabA.analytics.track("Seat Taken"); // refused by our own gate
  tabA.storageEvent("some-other-key");
  await settle();
  assert.deepEqual(tabA.fake.calls, ["init"], "unrelated keys are ignored");
  tabA.storageEvent(OPT_OUT_KEY);
  await settle();
  assert.deepEqual(
    tabA.fake.calls,
    ["init", "opt_out"],
    "A's SDK is told, so its sender and unload flush stop",
  );
  assert.equal(rendered, 1, "A's SETTINGS rows re-render");
  tabA.fake.flush();
  assert.equal(tabA.transport.length, 0);
  assert.equal(tabB.transport.length, 0);

  // And the other way: B switches back on, A hears about it and resumes.
  tabB.analytics.setOptOut(false);
  tabA.storageEvent(OPT_OUT_KEY);
  await settle();
  tabA.analytics.track("Recap Reopened");
  await settle();
  tabA.fake.flush();
  assert.deepEqual(tabA.fake.calls, ["init", "opt_out", "clear_opt"]);
  assert.deepEqual(
    tabA.transport.map((hit) => hit.events),
    [["FlowRiders.Recap Reopened"]],
  );
  assert.equal(rendered, 2);

  // storage.clear() in another tab arrives as a null key and is a change like any other.
  storage.setItem(OPT_OUT_KEY, "1");
  tabA.storageEvent(null);
  await settle();
  assert.equal(tabA.fake.calls.at(-1), "opt_out");
});

test("a tab that loaded switched off starts late when another tab switches analytics back on", async () => {
  const storage = seededStorage({ [OPT_OUT_KEY]: "1" });
  const tab = page({ storage });
  tab.analytics.start({ role: "host" });
  await settle();
  assert.equal(tab.loads(), 0);
  storage.removeItem(OPT_OUT_KEY);
  tab.storageEvent(OPT_OUT_KEY);
  await settle();
  assert.equal(tab.loads(), 1);
  assert.deepEqual(tab.fake.registered, [{ role: "host" }]);
});

test("the SDK's stored batches are removed on opt-out, on a page load while opted out, and on switching back on", async () => {
  assert.deepEqual(SDK_QUEUE_KEYS, [
    "__mpq_b5022dd7fe5b3cd0396d84284ae647e6_ev",
    "__mpq_b5022dd7fe5b3cd0396d84284ae647e6_pp",
    "__mpq_b5022dd7fe5b3cd0396d84284ae647e6_gr",
  ]);
  const seeded = () =>
    Object.fromEntries(SDK_QUEUE_KEYS.map((key) => [key, '[{"id":"late"}]']));
  const left = (storage: SafeStorage) =>
    SDK_QUEUE_KEYS.filter((key) => storage.getItem(key) !== null);

  const optingOut = page({ storage: seededStorage(seeded()) });
  optingOut.analytics.start({ role: "landing" });
  assert.equal(
    left(optingOut.environment.storage).length,
    3,
    "untouched while analytics is on",
  );
  optingOut.analytics.setOptOut(true);
  assert.deepEqual(left(optingOut.environment.storage), []);

  const loadedOff = page({
    storage: seededStorage({ ...seeded(), [OPT_OUT_KEY]: "1" }),
  });
  loadedOff.analytics.start({ role: "landing" });
  assert.deepEqual(left(loadedOff.environment.storage), []);

  // An event the SDK enqueued a moment after the opt-out, found when switching back on: not replayed.
  for (const [key, value] of Object.entries(seeded()))
    loadedOff.environment.storage.setItem(key, value);
  loadedOff.analytics.setOptOut(false);
  assert.deepEqual(left(loadedOff.environment.storage), []);

  // Off for the address is not an opt-out: the deployed site's queue on the same browser is not this page's to clear.
  const local = page({ port: "8831", storage: seededStorage(seeded()) });
  local.analytics.start({ role: "landing" });
  assert.equal(left(local.environment.storage).length, 3);
});

test("SETTINGS rows hear about every change, can unsubscribe, and one that throws stops nothing", async () => {
  const { analytics, fake } = page();
  analytics.start({ role: "landing" });
  const heard: string[] = [];
  analytics.onChange(() => {
    throw new Error("row exploded");
  });
  const stop = analytics.onChange(() => heard.push(analytics.status()));
  analytics.setOptOut(true);
  analytics.setOptOut(false);
  stop();
  analytics.setOptOut(true);
  await settle();
  assert.deepEqual(heard, ["optedOut", "on"]);
  assert.ok(fake.calls.includes("opt_out"));
});

test("a browser with no storage event, or one that throws when asked for it, still has a working switch", async () => {
  const base = page().environment;
  const { onStorage: _none, ...silent } = base;
  for (const environment of [
    silent,
    {
      ...base,
      onStorage: () => {
        throw new DOMException("denied", "SecurityError");
      },
    },
  ] satisfies AnalyticsEnvironment[]) {
    const analytics = createAnalytics(environment);
    analytics.start({ role: "landing" });
    analytics.setOptOut(true);
    assert.equal(analytics.status(), "optedOut");
  }
  await settle();
});
