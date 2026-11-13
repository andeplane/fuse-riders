import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_LEVEL_ORDER,
  HEIGHT,
  MAPS,
  MAP_IDS,
  NEUTRAL,
  TICK_HZ,
  WIDTH,
  arenaOf,
  botInput,
  cloneRound,
  createRound,
  hashRound,
  stepRound,
  type BotMind,
  type GameEvent,
  type Input,
  type MapId,
  type Round,
} from "../src/engine/index.js";
import {
  parseArgs,
  playGame,
  report,
  runSim,
} from "../../../scripts/killer-fuse-sim.js";
import { bare, ofType, unitOf } from "./engine-kit.js";

const MAX_SECONDS = 300;

/** What must hold on every step of any game, whatever the bots do. */
function assertSane(state: Round): void {
  const arena = arenaOf(state.mapId);
  const floor = arena.solids[0];
  assert.ok(floor);
  let riders = 0;
  for (const unit of state.units) {
    if (unit.dead) continue;
    const where = `slot ${unit.slot} at step ${state.step}`;
    assert.ok(unit.x >= 0 && unit.x < WIDTH, where);
    assert.ok(unit.y > 0 && unit.y <= floor.y, where);
    assert.ok(!unit.carrying || unit.kind === "worker", where);
    assert.ok(!unit.riding || unit.kind === "worker", where);
    if (unit.riding) riders += 1;
    if (unit.slot < 2) assert.equal(unit.kind, "queen", where);
  }
  assert.ok(riders <= 1);
  assert.equal(riders === 1, state.snail.rider >= 0);
  assert.ok(state.snail.x >= 0 && state.snail.x < WIDTH);
  for (const count of state.piles) assert.ok(count >= 0);
  for (const eggs of state.eggs) assert.ok(eggs >= 0 && eggs <= 3);
  for (const berry of state.loose)
    assert.ok(berry.y > 0 && berry.y <= HEIGHT, `berry at ${berry.y}`);
}

for (const mapId of MAP_IDS)
  for (const level of BOT_LEVEL_ORDER)
    test(`soak: ${level} bots finish games on map ${mapId} (${MAPS[mapId].name}) without breaking the world`, () => {
      for (const seed of [101, 202, 303]) {
        const state = createRound({ seed, mapId, botLevel: level });
        while (!state.winner && state.step < MAX_SECONDS * TICK_HZ) {
          stepRound(state, []);
          assertSane(state);
        }
        assert.ok(
          state.winner,
          `seed ${seed} is undecided after ${MAX_SECONDS} s`,
        );
        const last = state.events.at(-1);
        assert.deepEqual(last, { type: "victory", ...state.winner });
        // A finished round stays as it is.
        const hash = hashRound(state);
        stepRound(state, []);
        assert.deepEqual(state.events, []);
        assert.equal(hashRound(state), hash);
      }
    });

test("a bot only holds controls: its inputs fed to a person's slot play the identical game", () => {
  const bots = createRound({ seed: 77, botLevel: "hard" });
  const people = cloneRound(bots);
  people.humans = people.humans.map(() => true);
  for (let step = 0; step < 40 * TICK_HZ && !bots.winner; step += 1) {
    // What the bots press this step, taken on a copy so the real round still makes its own decisions.
    const copy = cloneRound(bots);
    const inputs: Input[] = copy.units.map((unit) => botInput(copy, unit.slot));
    for (const input of inputs)
      assert.deepEqual(Object.keys(input).sort(), Object.keys(NEUTRAL).sort());
    stepRound(bots, []);
    stepRound(people, inputs);
    assert.deepEqual(people.units, bots.units, `step ${bots.step}`);
    assert.deepEqual(people.events, bots.events, `step ${bots.step}`);
  }
  assert.deepEqual(people.holes, bots.holes);
  assert.deepEqual(people.snail, bots.snail);
  assert.deepEqual(people.eggs, bots.eggs);
  assert.ok(bots.step > 10 * TICK_HZ);
});

/** A round where one bot plays alone on an otherwise empty map. */
function solo(
  slot: number,
  plan: Partial<BotMind>,
  mapId: MapId = 1,
): { state: Round; events: GameEvent[] } {
  const state = bare(mapId);
  state.teamLevels = ["hard", "hard"];
  state.humans[slot] = false;
  const mind = state.bots[slot];
  assert.ok(mind);
  Object.assign(mind, { soldier: false, rider: false, ...plan });
  const unit = unitOf(state, slot);
  unit.dead = false;
  unit.respawn = 0;
  return { state, events: [] };
}

function play(
  game: { state: Round; events: GameEvent[] },
  seconds: number,
  until: (events: readonly GameEvent[]) => boolean = () => false,
): void {
  const end = game.state.step + seconds * TICK_HZ;
  while (game.state.step < end && !game.state.winner && !until(game.events)) {
    stepRound(game.state, []);
    game.events.push(...game.state.events);
  }
}

for (const mapId of MAP_IDS)
  test(`map ${mapId}: a lone Worker bot finds its way from pile to hive until the hive is full`, () => {
    for (const slot of [2, 5]) {
      const game = solo(slot, {}, mapId);
      play(game, 600);
      assert.deepEqual(game.state.winner, { team: slot % 2, kind: "economy" });
      assert.equal(ofType(game.events, "berryDeposit").length, 12);
    }
  });

test("a lone soldier Worker carries a berry into a warrior gate and comes out a Warrior that stays in the air", () => {
  const game = solo(3, { soldier: true });
  play(game, 60, (events) => ofType(events, "gateUse").length > 0);
  assert.deepEqual(
    ofType(game.events, "gateUse").map((event) => [event.slot, event.kind]),
    [[3, "warrior"]],
  );
  const unit = unitOf(game.state, 3);
  assert.equal(unit.kind, "warrior");
  play(game, 20);
  assert.equal(game.state.bots[3]?.goal, "guard");
  assert.ok(unit.x > WIDTH / 2, "over its own side");
  assert.equal(unit.ground, -1);
});

test("a lone rider bot mounts the snail and rides it home", () => {
  for (const mapId of [1, 2] as const) {
    const game = solo(4, { rider: true }, mapId);
    play(game, 90);
    assert.deepEqual(game.state.winner, { team: 0, kind: "snail" });
    assert.deepEqual(
      ofType(game.events, "snailMount").map((event) => event.slot),
      [4],
    );
  }
});

test("a lone Queen bot claims every gate on the map", () => {
  const game = solo(1, {});
  play(game, 90, (events) => ofType(events, "gateClaim").length >= 5);
  assert.ok(game.state.gates.every((gate) => gate.owner === 1));
  assert.equal(ofType(game.events, "gateClaim").length, MAPS[1].gates.length);
});

test("the level ladder: hard beats medium and medium beats easy in most games, from either side", () => {
  for (const [level, levelB] of [
    ["hard", "medium"],
    ["medium", "easy"],
  ] as const) {
    const summary = runSim({
      games: 40,
      level,
      levelB,
      map: 1,
      seed: 5000,
      maxSeconds: MAX_SECONDS,
      json: false,
    });
    assert.equal(summary.timeouts, 0);
    assert.equal(summary.decided, 40);
    assert.equal(summary.levelWins[0] + summary.levelWins[1], 40);
    assert.ok(
      summary.levelWins[0] >= 26,
      `${level} won ${summary.levelWins[0]} of 40 against ${levelB}`,
    );
    assert.equal(summary.deterministic, true);
    const text = report(summary);
    assert.match(
      text,
      new RegExp(`level wins: ${level} ${summary.levelWins[0]}`),
    );
    assert.match(text, new RegExp(`${levelB} won by: military`));
  }
});

test("the headless runner: one game is reproducible, a cut-off game is a timeout, and the report adds up", () => {
  const game = playGame(9, 1, ["hard", "hard"], MAX_SECONDS);
  assert.deepEqual(playGame(9, 1, ["hard", "hard"], MAX_SECONDS), game);
  assert.ok(game.winner);
  assert.match(game.hash, /^[0-9a-f]{16}$/);
  assert.ok(game.berries >= game.kickIns);
  const cut = playGame(9, 1, ["hard", "hard"], 2);
  assert.equal(cut.winner, null);
  assert.equal(cut.steps, 2 * TICK_HZ);

  const short = runSim({ ...parseArgs(["--games", "4"]), maxSeconds: 2 });
  assert.equal(short.timeouts, 4);
  assert.equal(short.decided, 0);
  assert.equal(short.medianSeconds, 0);
  assert.match(report(short), /decided 0, timeouts 4/);
  assert.match(report(short), /left \(team 0\) 0 \(-\)/);

  const summary = runSim(parseArgs(["--games", "12", "--map", "2"]));
  assert.equal(summary.decided + summary.timeouts, 12);
  assert.equal(summary.sideWins[0] + summary.sideWins[1], summary.decided);
  assert.equal(
    summary.kinds.military + summary.kinds.economy + summary.kinds.snail,
    summary.decided,
  );
  assert.ok(summary.medianSeconds <= summary.p90Seconds);
  const text = report(summary);
  assert.match(
    text,
    /^Killer Fuse, map 2: 12 games, hard against hard, seeds 1\.\.12/,
  );
  assert.doesNotMatch(text, /level wins/);
  assert.match(text, /determinism: every seed played twice/);
});

test("the headless runner reads its flags and refuses what it does not understand", () => {
  assert.deepEqual(parseArgs([]), {
    games: 200,
    level: "hard",
    levelB: "hard",
    map: 1,
    seed: 1,
    maxSeconds: 300,
    json: false,
  });
  assert.deepEqual(
    parseArgs([
      "--games",
      "7",
      "--level",
      "medium",
      "--level-b",
      "easy",
      "--map",
      "3",
      "--seed",
      "40",
      "--max-seconds",
      "90",
      "--json",
    ]),
    {
      games: 7,
      level: "medium",
      levelB: "easy",
      map: 3,
      seed: 40,
      maxSeconds: 90,
      json: true,
    },
  );
  assert.equal(parseArgs(["--level", "easy"]).levelB, "easy");
  for (const [argv, message] of [
    [["--games"], /--games needs a value/],
    [["--games", "many"], /--games must be a whole number/],
    [["--games", "-3"], /--games must be a whole number/],
    [["--level", "expert"], /--level must be one of easy, medium, hard/],
    [["--map", "4"], /--map must be 1, 2 or 3/],
    [["--speed", "2"], /unknown flag --speed/],
    [["fast"], /unexpected argument fast/],
  ] as const)
    assert.throws(() => parseArgs(argv), message);
});
