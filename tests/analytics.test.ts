import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsEnabled,
  analyticsOverride,
  matchEndedProps,
  matchStartKey,
  decidedRoundReport,
  roundShotEvents,
} from "../src/online/analytics.js";
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
