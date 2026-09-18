import assert from "node:assert/strict";
import test from "node:test";
import { defaultRoomSettings } from "../src/engine/room-settings.ts";
import { BOMB_FLIGHT_TICKS } from "../src/engine/bomb-launch.ts";
import {
  BOXED_IN_LOOKBACK_TICKS,
  CUT_OFF_MAX_AGE_TICKS,
  DODGE_LOOKBACK_TICKS,
  MAX_MOMENTS_PER_KIND,
  MOMENT_KINDS,
  REPLAY_PAUSE_TICKS,
  TRICK_SHOT_MAX_AGE_TICKS,
  pushMoment,
  roundHasMoment,
  type Moment,
} from "../src/engine/moments.ts";
import {
  COUNTDOWN_TICKS,
  MATCH_WINNER_TICKS,
  ROUND_OVER_TICKS,
  SLOT_COLORS,
  addPlayer,
  createGame,
  eliminatePlayer,
  resetMatch,
  returnToLobby,
  startMatch,
  step,
  toView,
  type BombState,
  type GameState,
} from "../src/engine/game.ts";
import { classicSettings } from "./fixtures/classic-settings.ts";

const fixedFlightPath = (x: number, y: number) =>
  Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({ x, y, angle: 0 }));
const farAway = [
  [1200, 700],
  [1300, 150],
  [300, 750],
] as const;

/** A playing round with every trail cleared and every rider beyond the first `active` parked far from the action. */
function scene(count = 3, active = 2): GameState {
  const state = createGame("moments", classicSettings());
  for (let slot = 0; slot < count; slot += 1)
    addPlayer(state, {
      id: `p${slot}`,
      name: `Rider ${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(state);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) step(state, new Map());
  assert.equal(state.phase, "playing");
  for (const player of state.players.values()) player.trail = [];
  for (let slot = active; slot < count; slot += 1) {
    const [x, y] = farAway[slot - active]!;
    const player = state.players.get(`p${slot}`)!;
    player.x = x;
    player.y = y;
  }
  return state;
}
function place(
  state: GameState,
  id: string,
  x: number,
  y: number,
  angle = 0,
): void {
  const player = state.players.get(id)!;
  player.x = x;
  player.y = y;
  player.angle = angle;
}
/** A bomb already on the ground that goes off on the next step. */
function dueBomb(
  state: GameState,
  ownerId: string,
  x: number,
  y: number,
  id = 99,
  blastRange = 90,
): void {
  state.bombs.set(id, {
    id,
    ownerId,
    launchX: x - 200,
    launchY: y,
    x,
    y,
    placedTick: state.tick - 20,
    launchedTick: state.tick - 20,
    landsAtTick: state.tick,
    explodeAtTick: state.tick + 1,
    blastRange,
    flightPath: fixedFlightPath(x, y),
  });
}
function shell(
  state: GameState,
  ownerId: string,
  x: number,
  y: number,
  vx: number,
  extra: Partial<NonNullable<BombState["shell"]>> = {},
  age = 20,
): void {
  state.bombs.set(77, {
    id: 77,
    ownerId,
    launchX: x,
    launchY: y,
    x,
    y,
    placedTick: state.tick + 1 - age,
    launchedTick: state.tick + 1 - age,
    landsAtTick: Number.MAX_SAFE_INTEGER,
    explodeAtTick: Number.MAX_SAFE_INTEGER,
    blastRange: 0,
    flightPath: [],
    shell: { vx, vy: 0, ...extra },
  });
}
const kinds = (state: GameState) => state.moments.map((moment) => moment.kind);
const only = (state: GameState, kind: Moment["kind"]): Moment => {
  const matches = state.moments.filter((moment) => moment.kind === kind);
  assert.equal(
    matches.length,
    1,
    `expected exactly one ${kind}, got ${JSON.stringify(state.moments)}`,
  );
  return matches[0]!;
};

test("a bomb that lands on a head is a direct hit, unless the head was starred or shielded", () => {
  for (const protection of ["none", "star", "shield"] as const) {
    const state = scene();
    place(state, "p1", 1080, 450);
    const victim = state.players.get("p1")!;
    victim.invulnerableUntilTick = protection === "star" ? state.tick + 20 : 0;
    victim.shielded = protection === "shield";
    place(state, "p0", 500, 450);
    state.bombs.set(99, {
      id: 99,
      ownerId: "p0",
      launchX: 500,
      launchY: 450,
      x: 1100,
      y: 450,
      placedTick: state.tick,
      launchedTick: state.tick,
      landsAtTick: state.tick + 1,
      explodeAtTick: state.tick + 40,
      blastRange: 90,
      flightPath: fixedFlightPath(1100, 450),
    });
    const before = state.tick;
    step(state, new Map());
    if (protection === "none") {
      assert.equal(victim.alive, false);
      assert.deepEqual(only(state, "directHit"), {
        kind: "directHit",
        round: 1,
        tick: before + 1,
        elapsed: before + 1 - state.roundStartedTick!,
        playerId: "p0",
        targetIds: ["p1"],
        value: 1,
      });
      assert.deepEqual(kinds(state), ["directHit"]);
    } else {
      assert.equal(victim.alive, true);
      assert.deepEqual(state.moments, [], protection);
    }
  }
});

test("a shell that bounced before hitting is a trick shot; a fresh, stray or gun kill is not", () => {
  const cases: Array<
    [string, Partial<NonNullable<BombState["shell"]>>, number, boolean]
  > = [
    ["one bounce", { bounces: 1 }, 20, true],
    [
      "three bounces at the age limit",
      { bounces: 3 },
      TRICK_SHOT_MAX_AGE_TICKS,
      true,
    ],
    ["no bounce", {}, 20, false],
    [
      "a stray past the age limit",
      { bounces: 2 },
      TRICK_SHOT_MAX_AGE_TICKS + 1,
      false,
    ],
  ];
  for (const [label, extra, age, expected] of cases) {
    const state = scene();
    place(state, "p1", 465, 450);
    place(state, "p0", 900, 800);
    shell(state, "p0", 500, 450, -450, extra, age);
    step(state, new Map());
    assert.equal(state.players.get("p1")!.alive, false, label);
    if (expected)
      assert.deepEqual(
        only(state, "trickShot"),
        {
          kind: "trickShot",
          round: 1,
          tick: state.tick,
          elapsed: state.tick - state.roundStartedTick!,
          playerId: "p0",
          targetIds: ["p1"],
          value: extra.bounces,
        },
        label,
      );
    else assert.deepEqual(state.moments, [], label);
  }
  const gun = scene();
  place(gun, "p1", 465, 450);
  place(gun, "p0", 900, 800);
  Object.assign(gun.players.get("p0")!, {
    x: 600,
    y: 450,
    angle: Math.PI,
    gunArmed: true,
  });
  step(
    gun,
    new Map([
      [
        "p0",
        {
          left: false,
          right: false,
          bomb: true,
          bombCommands: [{ action: "press" }],
        },
      ],
    ]),
  );
  assert.equal(gun.players.get("p1")!.alive, false, "the bullet hits");
  assert.deepEqual(gun.moments, [], "a gun bullet never banks");
});

test("a shell that comes back for its owner is an own goal", () => {
  const state = scene();
  place(state, "p0", 465, 450);
  place(state, "p1", 900, 800);
  shell(state, "p0", 500, 450, -450, { bounces: 1 });
  step(state, new Map());
  assert.equal(state.players.get("p0")!.alive, false);
  assert.deepEqual(kinds(state), ["ownGoal"]);
  assert.deepEqual(only(state, "ownGoal").targetIds, []);
});

test("dying on a fresh trail is a cut-off; on an older one, or on your own, it is not", () => {
  const wall = (state: GameState, ownerId: string, age: number) => {
    state.players.get(ownerId)!.trail = [
      {
        x1: 503,
        y1: 300,
        x2: 503,
        y2: 400,
        createdTick: state.tick + 1 - age,
        expiresAtTick: state.tick + 200,
      },
    ];
  };
  const fresh = scene();
  place(fresh, "p0", 500, 350);
  place(fresh, "p1", 900, 800);
  wall(fresh, "p1", 5);
  step(fresh, new Map());
  assert.equal(fresh.players.get("p0")!.alive, false);
  assert.deepEqual(only(fresh, "cutOff"), {
    kind: "cutOff",
    round: 1,
    tick: fresh.tick,
    elapsed: fresh.tick - fresh.roundStartedTick!,
    playerId: "p1",
    targetIds: ["p0"],
    value: 5,
  });
  assert.deepEqual(kinds(fresh), ["cutOff"]);
  const limit = scene();
  place(limit, "p0", 500, 350);
  place(limit, "p1", 900, 800);
  wall(limit, "p1", CUT_OFF_MAX_AGE_TICKS);
  step(limit, new Map());
  assert.equal(only(limit, "cutOff").value, CUT_OFF_MAX_AGE_TICKS);
  const old = scene();
  place(old, "p0", 500, 350);
  place(old, "p1", 900, 800);
  wall(old, "p1", CUT_OFF_MAX_AGE_TICKS + 1);
  step(old, new Map());
  assert.equal(old.players.get("p0")!.alive, false);
  assert.deepEqual(old.moments, []);
  const own = scene();
  place(own, "p0", 500, 350);
  place(own, "p1", 900, 800);
  wall(own, "p0", 15);
  step(own, new Map());
  assert.equal(own.players.get("p0")!.alive, false);
  assert.deepEqual(
    own.moments,
    [],
    "own trail past grace kills without a moment",
  );
});

test("a rider that travelled far but got nowhere before dying on a trail was boxed in, unless drunk", () => {
  const setup = (originX: number, drunk = false) => {
    const state = scene();
    place(state, "p0", 500, 350);
    place(state, "p1", 900, 800);
    state.players.get("p1")!.trail = [
      {
        x1: 503,
        y1: 300,
        x2: 503,
        y2: 400,
        createdTick: state.tick - 30,
        expiresAtTick: state.tick + 200,
      },
    ];
    const victim = state.players.get("p0")!;
    victim.trail = [
      {
        x1: originX,
        y1: 350,
        x2: originX + 7,
        y2: 350,
        createdTick: state.tick + 1 - BOXED_IN_LOOKBACK_TICKS,
        expiresAtTick: state.tick + 200,
      },
    ];
    if (drunk) victim.drunkUntilTick = state.tick + 50;
    step(state, new Map());
    assert.equal(victim.alive, false);
    return state;
  };
  const boxed = setup(480);
  // Already touching the trail at tick start: measure the highlight from the fatal contact pose.
  assert.equal(boxed.players.get("p0")!.x, 500);
  assert.deepEqual(only(boxed, "boxedIn"), {
    kind: "boxedIn",
    round: 1,
    tick: boxed.tick,
    elapsed: boxed.tick - boxed.roundStartedTick!,
    playerId: "p1",
    targetIds: ["p0"],
    value: 20,
  });
  assert.deepEqual(
    kinds(boxed),
    ["boxedIn"],
    "a 30-tick-old trail is no cut-off",
  );
  assert.deepEqual(
    setup(300).moments,
    [],
    "a rider that came from far away was not boxed in",
  );
  assert.deepEqual(
    setup(480, true).moments,
    [],
    "beer weaving is not being boxed in",
  );
});

test("one blast taking two riders is a double tap; a shield or a second owner breaks it", () => {
  const setup = () => {
    const state = scene(3, 3);
    place(state, "p0", 900, 700);
    place(state, "p1", 500, 450);
    place(state, "p2", 520, 450);
    return state;
  };
  const double = setup();
  dueBomb(double, "p0", 510, 450);
  step(double, new Map());
  assert.deepEqual(only(double, "multiKill"), {
    kind: "multiKill",
    round: 1,
    tick: double.tick,
    elapsed: double.tick - double.roundStartedTick!,
    playerId: "p0",
    targetIds: ["p1", "p2"],
    value: 2,
  });
  assert.deepEqual(kinds(double), ["multiKill"]);
  const shielded = setup();
  shielded.players.get("p2")!.shielded = true;
  dueBomb(shielded, "p0", 510, 450);
  step(shielded, new Map());
  assert.equal(shielded.players.get("p1")!.alive, false);
  assert.equal(shielded.players.get("p2")!.alive, true);
  assert.deepEqual(shielded.moments, []);
  const shared = setup();
  dueBomb(shared, "p0", 510, 450);
  dueBomb(shared, "p1", 505, 450, 98);
  step(shared, new Map());
  assert.equal(shared.players.get("p2")!.alive, false);
  assert.deepEqual(shared.moments, [], "two owners, no credit");
});

test("everybody dying in one tick is mutual destruction, on top of whatever each death was", () => {
  const headOn = scene(2, 2);
  place(headOn, "p0", 500, 350, 0);
  place(headOn, "p1", 512, 350, Math.PI);
  step(headOn, new Map());
  assert.equal(
    [...headOn.players.values()].filter((player) => player.alive).length,
    0,
  );
  assert.deepEqual(only(headOn, "mutualDestruction"), {
    kind: "mutualDestruction",
    round: 1,
    tick: headOn.tick,
    elapsed: headOn.tick - headOn.roundStartedTick!,
    playerId: "p0",
    targetIds: ["p1"],
    value: 2,
  });
  assert.deepEqual(kinds(headOn), ["mutualDestruction"]);
  const ownBlast = scene(2, 2);
  place(ownBlast, "p0", 500, 350);
  place(ownBlast, "p1", 520, 350);
  dueBomb(ownBlast, "p0", 510, 350);
  step(ownBlast, new Map());
  assert.deepEqual(kinds(ownBlast).sort(), ["mutualDestruction", "ownGoal"]);
  const survivor = scene(3, 2);
  place(survivor, "p0", 500, 350, 0);
  place(survivor, "p1", 512, 350, Math.PI);
  step(survivor, new Map());
  assert.deepEqual(
    survivor.moments,
    [],
    "a third rider still standing means nobody wiped the grid",
  );
  const walls = scene(2, 2);
  place(walls, "p0", 1570, 350, 0);
  place(walls, "p1", 30, 600, Math.PI);
  step(walls, new Map());
  assert.equal(
    [...walls.players.values()].filter((player) => player.alive).length,
    0,
  );
  assert.deepEqual(
    walls.moments,
    [],
    "two idle riders reaching opposite walls together did nothing to each other",
  );
});

test("leaving a blast zone in the last half second is a dodge; owners, immune riders and bystanders are not", () => {
  const setup = (
    originX: number,
    options: { owner?: string; immune?: boolean; origin?: boolean } = {},
  ) => {
    const state = scene();
    place(state, "p1", 500, 350);
    place(state, "p0", 900, 800);
    const dodger = state.players.get("p1")!;
    if (options.origin !== false)
      dodger.trail = [
        {
          x1: originX - 7,
          y1: 350,
          x2: originX,
          y2: 350,
          createdTick: state.tick + 1 - DODGE_LOOKBACK_TICKS,
          expiresAtTick: state.tick + 200,
        },
      ];
    if (options.immune) dodger.invulnerableUntilTick = state.tick + 50;
    dueBomb(state, options.owner ?? "p0", 400, 350);
    step(state, new Map());
    assert.equal(dodger.alive, true);
    return state;
  };
  const dodge = setup(450);
  assert.deepEqual(only(dodge, "bombDodge"), {
    kind: "bombDodge",
    round: 1,
    tick: dodge.tick,
    elapsed: dodge.tick - dodge.roundStartedTick!,
    playerId: "p1",
    targetIds: ["p0"],
    value: 11,
  });
  assert.deepEqual(kinds(dodge), ["bombDodge"]);
  assert.deepEqual(
    setup(450, { owner: "p1" }).moments,
    [],
    "walking away from your own bomb is not a dodge",
  );
  assert.deepEqual(
    setup(450, { immune: true }).moments,
    [],
    "a starred rider had nothing to dodge",
  );
  assert.deepEqual(
    setup(300).moments,
    [],
    "a rider that was never in the zone did not leave it",
  );
  assert.deepEqual(
    setup(450, { origin: false }).moments,
    [],
    "no record of where the rider was, no dodge",
  );
});

test("a Target Bomb resolved in the launch tick feeds the same detector", () => {
  // The victims ride on separate rows: on the launch tick they have already laid a trail each.
  const state = scene(3, 3);
  place(state, "p0", 900, 700);
  place(state, "p1", 500, 450);
  place(state, "p2", 520, 480);
  const thrower = state.players.get("p0")!;
  thrower.targetBombArmed = true;
  step(
    state,
    new Map([
      [
        "p0",
        {
          left: false,
          right: false,
          bomb: true,
          bombCommands: [
            {
              action: "press",
              aim: { x: 510 / state.width, y: 450 / state.height },
            },
          ],
        },
      ],
    ]),
  );
  step(
    state,
    new Map([
      [
        "p0",
        {
          left: false,
          right: false,
          bomb: false,
          bombCommands: [
            {
              action: "release",
              aim: { x: 510 / state.width, y: 450 / state.height },
            },
          ],
        },
      ],
    ]),
  );
  assert.equal(state.players.get("p1")!.alive, false);
  assert.equal(state.players.get("p2")!.alive, false);
  assert.deepEqual(only(state, "multiKill").targetIds, ["p1", "p2"]);
});

test("each kind keeps its first entries and no more", () => {
  const state = scene();
  for (let index = 0; index < MAX_MOMENTS_PER_KIND; index += 1)
    assert.equal(
      pushMoment(state, {
        kind: "ownGoal",
        round: 1,
        tick: index + 1,
        elapsed: index + 1,
        playerId: "p0",
        targetIds: [],
        value: 1,
      }),
      true,
    );
  assert.equal(
    pushMoment(state, {
      kind: "ownGoal",
      round: 1,
      tick: 99,
      elapsed: 99,
      playerId: "p0",
      targetIds: [],
      value: 1,
    }),
    false,
  );
  assert.equal(
    pushMoment(state, {
      kind: "cutOff",
      round: 1,
      tick: 99,
      elapsed: 99,
      playerId: "p0",
      targetIds: ["p1"],
      value: 1,
    }),
    true,
    "another kind has its own room",
  );
  place(state, "p0", 500, 350);
  dueBomb(state, "p0", 500, 350);
  step(state, new Map());
  assert.equal(state.players.get("p0")!.alive, false);
  assert.equal(
    state.moments.filter((moment) => moment.kind === "ownGoal").length,
    MAX_MOMENTS_PER_KIND,
    "a ninth own goal is dropped",
  );
  assert.equal(MOMENT_KINDS.length, 8);
});

test("moments travel only in the match-over snapshot, detached, and clear with the match statistics", () => {
  const state = scene(2, 2);
  place(state, "p0", 500, 350);
  dueBomb(state, "p0", 500, 350);
  step(state, new Map());
  assert.deepEqual(kinds(state), ["ownGoal"]);
  assert.equal(state.phase, "roundOver");
  assert.deepEqual(
    toView(state).moments,
    [],
    "nothing leaks before the match is over",
  );
  state.settings = { ...defaultRoomSettings(), match: "rounds", length: 1 };
  const decided = scene(2, 2);
  decided.settings = { ...defaultRoomSettings(), match: "rounds", length: 1 };
  place(decided, "p0", 500, 350);
  place(decided, "p1", 900, 800);
  dueBomb(decided, "p0", 500, 350);
  step(decided, new Map());
  assert.equal(decided.phase, "matchOver");
  const snapshot = toView(decided);
  assert.deepEqual(snapshot.moments, decided.moments);
  snapshot.moments[0]!.targetIds.push("tampered");
  assert.deepEqual(decided.moments[0]!.targetIds, []);
  resetMatch(decided, "rematch");
  assert.deepEqual(decided.moments, []);
  const lobby = scene(2, 2);
  place(lobby, "p0", 500, 350);
  dueBomb(lobby, "p0", 500, 350);
  step(lobby, new Map());
  assert.equal(lobby.moments.length, 1);
  returnToLobby(lobby, "fresh");
  assert.deepEqual(lobby.moments, []);
});

test("an eliminated rider outside the sweep records nothing and the detector stays deterministic", () => {
  const state = scene();
  eliminatePlayer(state, "p1");
  step(state, new Map());
  assert.deepEqual(state.moments, []);
  const runs = [0, 1].map(() => {
    const game = createGame("same-seed", classicSettings());
    for (let slot = 0; slot < 3; slot += 1)
      addPlayer(game, {
        id: `p${slot}`,
        name: `Rider ${slot}`,
        slot,
        color: SLOT_COLORS[slot]!,
      });
    startMatch(game);
    for (let tick = 0; tick < 400; tick += 1) {
      step(
        game,
        new Map([
          [
            "p0",
            {
              left: tick % 24 < 7,
              right: false,
              bomb: tick % 90 === 70,
              bombCommands:
                tick % 90 === 70
                  ? [{ action: "press" }]
                  : tick % 90 === 74
                    ? [{ action: "release" }]
                    : [],
            },
          ],
          [
            "p1",
            {
              left: false,
              right: tick % 31 < 5,
              bomb: false,
              bombCommands:
                tick % 70 === 30
                  ? [{ action: "press" }]
                  : tick % 70 === 33
                    ? [{ action: "release" }]
                    : [],
            },
          ],
          ["p2", { left: tick % 40 > 34, right: false, bomb: false }],
        ]),
      );
    }
    return game.moments;
  });
  assert.deepEqual(runs[0], runs[1]);
});

test("a detected moment is also an event of its tick, and a round with a moment pauses longer for the replay", () => {
  const quiet = scene(3, 3);
  place(quiet, "p0", 900, 700);
  place(quiet, "p1", 500, 450);
  place(quiet, "p2", 1300, 150);
  eliminatePlayer(quiet, "p1");
  eliminatePlayer(quiet, "p2");
  const plain = step(quiet, new Map());
  assert.equal(quiet.phase, "roundOver");
  assert.equal(
    plain.events.some((event) => event.type === "moment"),
    false,
  );
  assert.equal(
    quiet.phaseEndsAtTick,
    quiet.tick + ROUND_OVER_TICKS,
    "no moment, the ordinary pause",
  );
  const loud = scene(3, 3);
  place(loud, "p0", 900, 700);
  place(loud, "p1", 500, 450);
  place(loud, "p2", 520, 480);
  dueBomb(loud, "p0", 510, 450);
  const result = step(loud, new Map());
  const events = result.events.filter((event) => event.type === "moment");
  assert.deepEqual(events, [
    { type: "moment", moment: only(loud, "multiKill") },
  ]);
  assert.notEqual(
    (events[0] as { moment: Moment }).moment.targetIds,
    loud.moments[0]!.targetIds,
    "the event carries its own copy",
  );
  assert.equal(loud.phase, "roundOver");
  assert.equal(
    loud.phaseEndsAtTick,
    loud.tick + ROUND_OVER_TICKS + REPLAY_PAUSE_TICKS,
    "a highlight round pauses long enough to replay",
  );
  assert.equal(roundHasMoment(loud), true);
  const final = scene(2, 2);
  final.settings = { ...defaultRoomSettings(), match: "rounds", length: 1 };
  place(final, "p0", 500, 350);
  place(final, "p1", 900, 800);
  dueBomb(final, "p0", 500, 350);
  step(final, new Map());
  assert.equal(final.phase, "matchOver");
  assert.equal(
    final.phaseEndsAtTick,
    final.tick + ROUND_OVER_TICKS + REPLAY_PAUSE_TICKS + MATCH_WINNER_TICKS,
    "so does the final-round pause before the recap",
  );
  const capped = scene();
  for (let index = 0; index < MAX_MOMENTS_PER_KIND; index += 1)
    pushMoment(capped, {
      kind: "ownGoal",
      round: 1,
      tick: index + 1,
      elapsed: index + 1,
      playerId: "p0",
      targetIds: [],
      value: 1,
    });
  place(capped, "p0", 500, 350);
  dueBomb(capped, "p0", 500, 350);
  assert.equal(
    step(capped, new Map()).events.some((event) => event.type === "moment"),
    false,
    "a dropped ninth own goal is no event either",
  );
});
