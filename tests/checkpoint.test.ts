import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeGameState,
  encodeGameState,
  MAX_CHECKPOINT_TRAILS,
} from "../src/engine/codec/checkpoint.js";
import {
  BOMB_BLAST_RANGE,
  COUNTDOWN_TICKS,
  GRAVITY_FIELD_TICKS,
  GRAVITY_MAX_RADIUS,
  MAX_GRAVITY_FIELDS,
  SLOT_COLORS,
  addPlayer,
  createGame,
  startMatch,
  step,
  type GameState,
} from "../src/engine/game.js";
import { BOMB_FLIGHT_TICKS } from "../src/engine/bomb-launch.js";
import { MAX_PORTAL_PAIRS, createPortalPair } from "../src/engine/portal.js";
import { MOMENT_KINDS } from "../src/engine/moments.js";
import { classicSettings } from "./fixtures/classic-settings.js";

// The replica state a joiner installs comes from any peer, so decodeGameState is an untrusted boundary: every shape and
// cross-reference guard here is what keeps a corrupt or hostile snapshot from replacing a healthy world.
function playing(): GameState {
  const game = createGame("checkpoint", classicSettings());
  addPlayer(game, {
    id: "p0",
    name: "P0",
    slot: 0,
    color: SLOT_COLORS[0]!,
    connected: true,
  });
  addPlayer(game, {
    id: "p1",
    name: "P1",
    slot: 1,
    color: SLOT_COLORS[1]!,
    connected: true,
  });
  startMatch(game);
  for (let i = 0; i < COUNTDOWN_TICKS + 60; i++) step(game, new Map());
  return game;
}
const object = (value: unknown): Record<string, unknown> => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const list = (value: unknown): unknown[] => {
  assert.ok(Array.isArray(value));
  return value;
};
const mapped = (value: unknown): unknown[][] =>
  list(object(value).$map).map(list);
const corrupt = (
  game: GameState,
  change: (data: Record<string, unknown>) => void,
) => {
  const data = object(JSON.parse(encodeGameState(game)));
  change(data);
  return decodeGameState(JSON.stringify(data));
};
const rejected = (
  game: GameState,
  change: (data: Record<string, unknown>) => void,
  why: string,
) => assert.equal(corrupt(game, change), undefined, why);
const withBomb = (game: GameState) => {
  const { x, y } = game.players.get("p1")!;
  game.bombs.set(1, {
    id: 1,
    ownerId: "p1",
    launchX: x,
    launchY: y,
    x,
    y,
    placedTick: game.tick,
    launchedTick: game.tick,
    landsAtTick: game.tick + BOMB_FLIGHT_TICKS,
    explodeAtTick: game.tick + 40,
    blastRange: BOMB_BLAST_RANGE,
    flightPath: Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, () => ({
      x,
      y,
      angle: 0,
    })),
    shell: { vx: 10, vy: 0 },
  });
  game.nextBombId = 2;
  return game;
};
const gates = (game: GameState, index: number) =>
  createPortalPair({
    id: `portal-${index}`,
    tick: game.tick,
    bounds: { minX: 20, minY: 20, maxX: 1580, maxY: 880 },
    riderRadius: 7,
    random: (() => {
      let n = index;
      return () => (++n % 3) / 3;
    })(),
    isSafe: () => true,
  })!;

test("a state must carry its settings, whole: no fallback stands in for a missing rule (#253 A3)", () => {
  const game = playing();
  assert.deepEqual(
    decodeGameState(encodeGameState(game))?.settings,
    game.settings,
  );
  rejected(game, (data) => delete data.settings, "no settings at all");
  rejected(game, (data) => (data.settings = null), "null settings");
  // Each of these parses as a browser preference saved before the flag existed. A game is not a preference: the
  // simulation would read `undefined` where the parser's copy says `true`.
  for (const flag of ["chainReaction", "aimBounce", "map", "bombChargeTicks"])
    rejected(
      game,
      (data) => delete object(data.settings)[flag],
      `settings without ${flag}`,
    );
  rejected(
    game,
    (data) => (object(data.settings).extra = 1),
    "a key no settings have would enter the hash",
  );
  rejected(
    game,
    (data) => (object(data.settings).length = 21),
    "a value the parser refuses",
  );
});

test("a well-formed playing state with a bomb, a gravity field and two portal pairs round-trips exactly", () => {
  const game = withBomb(playing());
  game.gravityFields.push({
    x: 400,
    y: 400,
    radius: 190,
    expiresAtTick: game.tick + GRAVITY_FIELD_TICKS,
  });
  game.portalPairs = [gates(game, 0), gates(game, 1)];
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(
    restored,
    "the control fixture is valid, so every rejection below is a guard talking",
  );
  assert.equal(encodeGameState(restored), encodeGameState(game));
});

test("bombs, black holes and portal pairs must name issued bombs, seated owners, live ticks and sane geometry", () => {
  const game = withBomb(playing());
  rejected(
    game,
    (data) => {
      object(mapped(data.bombs)[0]![1]).ownerId = "ghost";
    },
    "a bomb from nobody",
  );
  rejected(
    game,
    (data) => {
      object(object(mapped(data.bombs)[0]![1]).shell).vx = 1e9;
    },
    "a shell faster than the guard allows",
  );
  assert.ok(
    corrupt(game, (data) => {
      object(mapped(data.bombs)[0]![1]).shot = 1;
    }),
    "a bomb naming its own pull restores",
  );
  assert.ok(
    corrupt(game, (data) => {
      delete object(mapped(data.bombs)[0]![1]).shot;
    }),
    "and one naming none still restores",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.bombs)[0]![1]).shot = 2;
    },
    "a bomb naming a pull issued after it",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.bombs)[0]![1]).shot = 0;
    },
    "a shot id no bomb ever had",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.bombs)[0]![1]).flightPath = [];
      object(mapped(data.bombs)[0]![1]).x = "here";
    },
    "a position that is not a number",
  );
  const field = (over: Record<string, unknown> = {}) => ({
    x: 400,
    y: 400,
    radius: 190,
    expiresAtTick: game.tick + GRAVITY_FIELD_TICKS,
    ...over,
  });
  assert.ok(
    corrupt(game, (data) => {
      list(data.gravityFields).push(field());
    }),
    "a live hole restores",
  );
  rejected(
    game,
    (data) => {
      list(data.gravityFields).push(field({ radius: GRAVITY_MAX_RADIUS + 1 }));
    },
    "a hole wider than the rules open",
  );
  rejected(
    game,
    (data) => {
      list(data.gravityFields).push(
        ...Array.from({ length: MAX_GRAVITY_FIELDS + 1 }, () => field()),
      );
    },
    "more holes than the cap",
  );
  rejected(
    game,
    (data) => {
      list(data.gravityFields).push(
        field({ expiresAtTick: game.tick + GRAVITY_FIELD_TICKS + 1 }),
      );
    },
    "a hole that outlasts its duration",
  );
  rejected(
    game,
    (data) => {
      list(data.gravityFields).push(field({ expiresAtTick: game.tick }));
    },
    "a field already expired",
  );
  const withPortals = playing();
  withPortals.portalPairs = [gates(withPortals, 0), gates(withPortals, 1)];
  rejected(
    withPortals,
    (data) => {
      object(list(object(list(data.portalPairs)[1]).gates)[0]).halfLength = 999;
    },
    "a gate longer than any wall",
  );
  rejected(
    withPortals,
    (data) => {
      object(list(data.portalPairs)[1]).id = "portal-0";
    },
    "duplicate pair ids would exempt a foreign wall from exit safety",
  );
  rejected(
    withPortals,
    (data) => {
      object(list(data.portalPairs)[1]).expiresAtTick = 0;
    },
    "an expired pair",
  );
  rejected(
    withPortals,
    (data) => {
      const pairs = list(data.portalPairs);
      while (pairs.length <= MAX_PORTAL_PAIRS)
        pairs.push({ ...object(pairs[0]), id: `extra-${pairs.length}` });
    },
    "more pairs than the cap",
  );
});

test("players, trails, history and statistics are bounded and internally consistent", () => {
  const game = playing();
  for (const key of [
    "players",
    "bombs",
    "pickups",
    "leaderboard",
    "roundParticipants",
    "matchStats",
    "randomState",
    "roundScored",
    "gravityFields",
    "portalPairs",
  ])
    rejected(
      game,
      (data) => {
        delete data[key];
      },
      `missing ${key}`,
    );
  for (const key of [
    "trail",
    "alive",
    "drunkHeadingOffset",
    "shielded",
    "avatarId",
    "nitroUntilTicks",
    "snailUntilTicks",
    "grip",
    "aimSlowTicks",
    "aimSlowSpentTicks",
  ])
    rejected(
      game,
      (data) => {
        delete object(mapped(data.players)[0]![1])[key];
      },
      `player without ${key}`,
    );
  for (const key of [
    "deathsByCause",
    "currentRoundSurvivalTicks",
    "distanceUnits",
  ])
    rejected(
      game,
      (data) => {
        delete object(mapped(data.matchStats)[0]![1])[key];
      },
      `stats without ${key}`,
    );
  rejected(
    game,
    (data) => {
      object(mapped(data.players)[0]![1]).trail = Array.from(
        { length: MAX_CHECKPOINT_TRAILS + 1 },
        () => ({
          x1: 1,
          y1: 1,
          x2: 2,
          y2: 2,
          createdTick: 1,
          expiresAtTick: 161,
        }),
      );
    },
    "more trail than the cap",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.players)[0]![1]).trail = [
        { x1: 1, y1: 1, x2: 2, y2: 2, createdTick: 99, expiresAtTick: 2 },
      ];
    },
    "a trail that expires before it was drawn",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.players)[0]![1]).id = "wrong-key";
    },
    "a player keyed under another id",
  );
  rejected(
    game,
    (data) => {
      const players = mapped(data.players);
      object(data.players).$map = [...players, players[0]!];
    },
    "duplicate map keys",
  );
  for (const tick of [1.5, -1, "now"])
    rejected(
      game,
      (data) => {
        data.tick = tick;
      },
      `tick ${String(tick)}`,
    );
  rejected(
    game,
    (data) => {
      object(mapped(data.players)[0]![1]).x = 1e6;
    },
    "a rider far outside the arena",
  );
  rejected(
    game,
    (data) => {
      let deep: unknown = 0;
      for (let i = 0; i < 20; i++) deep = { next: deep };
      object(mapped(data.players)[0]![1]).bombTarget = deep;
    },
    "nesting past the decoder budget",
  );
  rejected(
    game,
    (data) => {
      const sample = mapped(data.leaderboard)[0]![1];
      object(data.leaderboard).$map = Array.from({ length: 129 }, (_, i) => [
        `id-${i}`,
        { ...object(sample), id: `id-${i}` },
      ]);
    },
    "history beyond the cap",
  );
  rejected(
    game,
    (data) => {
      object(data.matchStats).$map = [];
    },
    "seated riders without statistics",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.roundParticipants)[0]![1]).eliminatedAtTick = 999999;
    },
    "an elimination in the future",
  );
  rejected(
    game,
    (data) => {
      object(data.bombs).$map = [[1]];
    },
    "a malformed map entry",
  );
  rejected(
    game,
    (data) => {
      object(data.bombs).extra = 1;
    },
    "a map with extra keys",
  );
});

test("every phase of a long match encodes to a state that decodes back to itself", () => {
  const game = playing();
  for (let tick = 0; tick < 2000; tick++) {
    step(game, new Map());
    if (tick % 17 === 0) {
      const restored = decodeGameState(encodeGameState(game));
      assert.ok(restored, `phase ${game.phase}, tick ${game.tick}`);
      assert.equal(encodeGameState(restored), encodeGameState(game));
    }
  }
});

test("highlight moments and shell bounces round-trip, and malformed ones are rejected (ADR 043)", () => {
  const game = withBomb(playing());
  const tick = game.tick;
  game.moments.push(
    {
      kind: "cutOff",
      round: 1,
      tick,
      elapsed: 1,
      playerId: "p0",
      targetIds: ["p1"],
      value: 5,
    },
    {
      kind: "ownGoal",
      round: 1,
      tick,
      elapsed: 1,
      playerId: "p1",
      targetIds: [],
      value: 1,
    },
  );
  game.bombs.get(1)!.shell = { vx: 450, vy: 0, bounces: 2 };
  assert.deepEqual(
    decodeGameState(encodeGameState(game))?.moments,
    game.moments,
  );
  assert.equal(
    decodeGameState(encodeGameState(game))?.bombs.get(1)?.shell?.bounces,
    2,
  );
  const first = (data: Record<string, unknown>) =>
    object(list(data.moments)[0]);
  rejected(
    game,
    (data) => {
      delete data.moments;
    },
    "the list is required",
  );
  rejected(
    game,
    (data) => {
      first(data).kind = "closeCall";
    },
    "unknown kind",
  );
  rejected(
    game,
    (data) => {
      first(data).tick = tick + 1;
    },
    "a moment from the future",
  );
  rejected(
    game,
    (data) => {
      first(data).elapsed = tick + 1;
    },
    "elapsed beyond its tick",
  );
  rejected(
    game,
    (data) => {
      first(data).round = 2;
    },
    "a round that has not happened",
  );
  rejected(
    game,
    (data) => {
      first(data).playerId = "nobody";
    },
    "an unknown protagonist",
  );
  rejected(
    game,
    (data) => {
      first(data).targetIds = ["nobody"];
    },
    "an unknown target",
  );
  rejected(
    game,
    (data) => {
      first(data).targetIds = ["p0"];
    },
    "the protagonist as its own target",
  );
  rejected(
    game,
    (data) => {
      first(data).targetIds = ["p1", "p1"];
    },
    "a duplicate target",
  );
  rejected(
    game,
    (data) => {
      first(data).value = 1.5;
    },
    "a fractional value",
  );
  rejected(
    game,
    (data) => {
      first(data).extra = true;
    },
    "an extra field",
  );
  rejected(
    game,
    (data) => {
      const moments = list(data.moments);
      moments.push(
        ...Array.from({ length: 8 }, () => ({ ...(moments[0] as object) })),
      );
    },
    "a ninth of one kind",
  );
  rejected(
    game,
    (data) => {
      list(data.moments).length = 0;
      list(data.moments).push(
        ...Array.from({ length: 65 }, (_, i) => ({
          kind: MOMENT_KINDS[i % MOMENT_KINDS.length],
          round: 1,
          tick,
          elapsed: 1,
          playerId: "p0",
          targetIds: [],
          value: 1,
        })),
      );
    },
    "more than every kind can keep",
  );
  rejected(
    game,
    (data) => {
      object(object(mapped(data.bombs)[0]![1]).shell).bounces = -1;
    },
    "a negative bounce count",
  );
  rejected(
    game,
    (data) => {
      object(object(mapped(data.bombs)[0]![1]).shell).bounces = 0;
    },
    "a zero the fold never writes",
  );
  const lobby = createGame("lobby-moments", classicSettings());
  addPlayer(lobby, {
    id: "p0",
    name: "P0",
    slot: 0,
    color: SLOT_COLORS[0]!,
    connected: true,
  });
  assert.ok(decodeGameState(encodeGameState(lobby)));
  rejected(
    lobby,
    (data) => {
      list(data.moments).push({
        kind: "ownGoal",
        round: 1,
        tick: 0,
        elapsed: 0,
        playerId: "p0",
        targetIds: [],
        value: 1,
      });
    },
    "a lobby carries no moments",
  );
});

test("the round shot log names issued pulls and seated riders, and kills each rider at most once", () => {
  const game = withBomb(playing());
  const shot = (over: Record<string, unknown> = {}) => ({
    shot: 1,
    shooterId: "p0",
    weapon: "gun",
    elapsed: 10,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    grip: false,
    kills: [],
    ...over,
  });
  assert.ok(
    corrupt(game, (data) => {
      list(data.shots).push(shot({ kills: [{ victimId: "p1", elapsed: 12 }] }));
    }),
    "a pull that killed restores",
  );
  assert.ok(
    corrupt(game, (data) => {
      list(data.shots).push(shot());
    }),
    "and so does a miss",
  );
  rejected(
    game,
    (data) => {
      delete data.shots;
    },
    "a state without its log",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ weapon: "railgun" }));
    },
    "a weapon the game does not have",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ shot: 2 }));
    },
    "a pull that was never issued",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot(), shot());
    },
    "the same pull twice",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ shooterId: "ghost" }));
    },
    "a pull by nobody",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ kills: [{ victimId: "p0", elapsed: 12 }] }));
    },
    "a rider killed by its own shot",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(
        shot({ kills: [{ victimId: "ghost", elapsed: 12 }] }),
      );
    },
    "a kill of nobody",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ kills: [{ victimId: "p1", elapsed: 9 }] }));
    },
    "a kill before its pull",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(
        shot({
          kills: [
            { victimId: "p1", elapsed: 12 },
            { victimId: "p1", elapsed: 13 },
          ],
        }),
      );
    },
    "a rider killed twice in a round",
  );
  // Distinct victims, so it is the four-kill cap that refuses this and not the killed-twice rule.
  rejected(
    game,
    (data) => {
      list(data.shots).push(
        shot({
          kills: ["a", "b", "c", "d", "e"].map((victimId) => ({
            victimId,
            elapsed: 12,
          })),
        }),
      );
    },
    "more kills than a pull can make",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ elapsed: -1 }));
    },
    "a pull before the round",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ bombs: 0 }));
    },
    "a pull that launched nothing",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ bombs: 99 }));
    },
    "a bigger volley than the game can fire",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ fuseLevel: 3 }));
    },
    "a fuse level past the cap",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ extraBombs: 9 }));
    },
    "more Extra Bombs than the cap",
  );
  rejected(
    game,
    (data) => {
      list(data.shots).push(shot({ grip: 1 }));
    },
    "a GRIP flag that is not a boolean",
  );
  rejected(
    game,
    (data) => {
      const entry = shot();
      delete (entry as Record<string, unknown>).power;
      list(data.shots).push(entry);
    },
    "a pull missing its upgrades",
  );
  const lobby = createGame("checkpoint-lobby", classicSettings());
  addPlayer(lobby, {
    id: "p0",
    name: "P0",
    slot: 0,
    color: SLOT_COLORS[0]!,
    connected: true,
  });
  assert.ok(
    decodeGameState(encodeGameState(lobby)),
    "the lobby control restores, so the rejection below is the log",
  );
  rejected(
    lobby,
    (data) => {
      list(data.shots).push(shot());
    },
    "a lobby carrying a round log",
  );
});

test("the decided round is held to its own consistency and the clock, and may outlive the riders it names", () => {
  const game = withBomb(playing());
  const pull = (over: Record<string, unknown> = {}) => ({
    shot: 3,
    shooterId: "p0",
    weapon: "shell",
    elapsed: 10,
    bombs: 1,
    power: 0,
    extraBombs: 0,
    fuseLevel: 0,
    grip: false,
    kills: [],
    ...over,
  });
  const decided = (over: Record<string, unknown> = {}) => ({
    matchId: game.matchId,
    round: 1,
    tick: game.tick,
    shots: [pull({ kills: [{ victimId: "p1", elapsed: 20 }] })],
    ...over,
  });
  assert.ok(
    corrupt(game, (data) => {
      data.decidedRound = decided();
    }),
    "a decided round restores",
  );
  assert.ok(
    corrupt(game, (data) => {
      data.decidedRound = decided({
        matchId: "an-earlier-match",
        round: 7,
        shots: [pull({ shooterId: "gone", shot: 99 })],
      });
    }),
    "including one from before a rematch or the lobby, naming riders and bomb ids that no longer exist",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = decided({ tick: game.tick + 1 });
    },
    "a round decided in the future",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = decided({ round: game.round + 1 });
    },
    "a round of this match that has not been played",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = decided({
        shots: [pull({ kills: [{ victimId: "p0", elapsed: 20 }] })],
      });
    },
    "a decided self-kill",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = decided({ shots: [pull(), pull()] });
    },
    "the same pull twice",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = decided({ shots: [pull({ weapon: "railgun" })] });
    },
    "an unknown weapon",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = { ...decided(), extra: 1 };
    },
    "an unexpected key",
  );
  rejected(
    game,
    (data) => {
      data.decidedRound = decided({ round: 0 });
    },
    "round zero",
  );
});

test("detached trail identity, schedule and ownership are validated before replacement", () => {
  const game = playing(),
    p = game.players.get("p0")!;
  game.nextTrailPieceId = 3;
  p.trail = [
    {
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 100,
      createdTick: 1,
      expiresAtTick: 81,
      detached: { id: 1, decayStartTick: 70 },
    },
    {
      x1: 200,
      y1: 100,
      x2: 300,
      y2: 100,
      createdTick: 2,
      expiresAtTick: 82,
      detached: { id: 1, decayStartTick: 70 },
    },
  ];
  assert.ok(decodeGameState(encodeGameState(game)));
  const segments = (data: Record<string, unknown>) =>
    list(object(mapped(data.players)[0]![1]).trail).map(object);
  for (const detached of [
    { id: 0, decayStartTick: 70 },
    { id: 3, decayStartTick: 70 },
    { id: 1, decayStartTick: 1 },
    { id: 1, decayStartTick: game.tick + 61 },
    { id: 1, decayStartTick: 70, mode: "unknown" },
    { id: 1 },
  ]) {
    rejected(
      game,
      (data) => {
        segments(data)[0]!.detached = detached;
      },
      "invalid lifecycle metadata",
    );
  }
  rejected(
    game,
    (data) => {
      object(segments(data)[1]!.detached).decayStartTick = 71;
    },
    "one clock per piece",
  );
  rejected(
    game,
    (data) => {
      segments(data)[1]!.x1 = 201;
    },
    "no gap within a detached run",
  );
  rejected(
    game,
    (data) => {
      segments(data)[1]!.createdTick = 1;
    },
    "ordered consecutive creation ticks",
  );
  rejected(
    game,
    (data) => {
      delete segments(data)[0]!.detached;
    },
    "active segments cannot precede detached pieces",
  );
  rejected(
    game,
    (data) => {
      object(mapped(data.players)[1]![1]).trail = structuredClone(
        segments(data),
      );
    },
    "piece ids cannot cross owners",
  );
  rejected(
    game,
    (data) => {
      delete data.nextTrailPieceId;
    },
    "older checkpoints cannot silently restore",
  );
  assert.ok(
    decodeGameState(encodeGameState(game)),
    "rejections leave the healthy world untouched",
  );
});

test("five riders at the total segment cap remain within checkpoint byte and parser budgets", () => {
  const game = createGame("max-trail-checkpoint", classicSettings());
  for (let slot = 0; slot < 5; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  game.tick = 2200;
  game.nextTrailPieceId = 6;
  for (const player of game.players.values())
    player.trail = Array.from({ length: MAX_CHECKPOINT_TRAILS }, (_, i) => ({
      x1: 100.12345678901234 + (i % 2),
      y1: 200.12345678901234,
      x2: 100.12345678901234 + ((i + 1) % 2),
      y2: 200.12345678901234,
      createdTick: i + 1,
      expiresAtTick: i + 1025,
      detached: { id: player.slot + 1, decayStartTick: 2200 },
    }));
  const encoded = encodeGameState(game);
  assert.ok(
    decodeGameState(encoded),
    `saturated checkpoint (${encoded.length} bytes) must restore`,
  );
});

test("combat detail survives checkpoint replay and rejects references outside the match", () => {
  const game = playing();
  const original = game.matchStats.get("p0")!.combat!;
  original.victims.p1 = 1;
  original.versus.human.kills.trail = 1;
  original.kills.trail = 1;
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  assert.deepEqual(restored.matchStats.get("p0")!.combat, original);
  const broken = structuredClone(game);
  broken.matchStats.get("p0")!.combat!.victims.outsider = 1;
  assert.equal(decodeGameState(encodeGameState(broken)), undefined);
  assert.deepEqual(
    game.matchStats.get("p0")!.combat,
    original,
    "rejection does not mutate healthy state",
  );
  for (let i = 0; i < 10; i++) {
    step(game, new Map());
    step(restored, new Map());
  }
  assert.deepEqual(encodeGameState(restored), encodeGameState(game));
});

test("round rating checkpoint standings reject duplicate and foreign identities atomically", () => {
  const game = playing();
  const rating = {
    finishers: ["p0", "p1"],
    standings: [
      {
        playerId: "p0",
        name: "P0",
        slot: 0,
        color: "#123456",
        place: 1,
        scoreUnits: 120,
      },
      {
        playerId: "p1",
        name: "P1",
        slot: 1,
        color: "#123456",
        place: 2,
        scoreUnits: 0,
      },
    ],
  };
  for (const bad of [
    { ...rating, finishers: ["foreign"] },
    { ...rating, finishers: ["p0", "p0"] },
    { ...rating, standings: [rating.standings[0], rating.standings[0]] },
    {
      ...rating,
      standings: [
        { ...rating.standings[0], color: "bad" },
        rating.standings[1],
      ],
    },
  ])
    rejected(
      game,
      (data) => {
        data.decidedRound = {
          matchId: game.matchId,
          round: 1,
          tick: game.tick,
          shots: [],
          rating: bad,
        };
      },
      "invalid round rating receipt",
    );
});
