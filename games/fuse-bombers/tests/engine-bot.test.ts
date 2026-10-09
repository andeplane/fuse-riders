import test from "node:test";
import assert from "node:assert/strict";
import {
  createBot,
  ghostOf,
  isGhostLoaded,
  isLoaded,
  TICK_HZ,
  type BotDifficulty,
  type RoundState,
} from "../src/engine/index.js";
import { fingerprint, playOut } from "./engine-helpers.js";

// Headless bot checks. Bots press the same one button as humans; these pin that the difficulties
// are ordered, that bot-only rounds finish, and that bots behave (deterministic, no wasted presses).

/** An input script where castle `id` is played by a bot of `kinds[id]`. */
function botInputs(seed: number, kinds: readonly BotDifficulty[]) {
  const bots = kinds.map((difficulty, playerId) =>
    createBot({ difficulty, playerId, seed }),
  );
  const log = { presses: 0, pressedWhileBusy: 0 };
  const inputs = (state: RoundState): boolean[] =>
    bots.map((bot, id) => {
      const press = bot(state);
      if (press) {
        log.presses++;
        // An eliminated bot presses for its ghost bomber.
        const ghost = ghostOf(state, id);
        const ready = ghost
          ? isGhostLoaded(ghost)
          : isLoaded(state.castles[id] ?? state.castles[0]!);
        if (!ready) log.pressedWhileBusy++;
      }
      return press;
    });
  return { inputs, log };
}

test("hard bots clearly beat easy bots head to head", () => {
  let hardWins = 0;
  const rounds = 12;
  for (let seed = 1; seed <= rounds; seed++) {
    const hard = seed % 2; // swap sides every round
    const kinds: BotDifficulty[] = hard ? ["easy", "hard"] : ["hard", "easy"];
    const s = playOut({ seed, playerCount: 2 }, botInputs(seed, kinds).inputs);
    if (s.result?.winner === hard) hardWins++;
  }
  assert.ok(hardWins >= 9, `hard won only ${hardWins}/${rounds}`);
});

test("bot-only 6-player rounds end within the time limit", () => {
  const mixes: BotDifficulty[][] = [
    ["hard", "hard", "hard", "hard", "hard", "hard"],
    ["easy", "normal", "hard", "easy", "normal", "hard"],
  ];
  for (const [i, kinds] of mixes.entries()) {
    const seed = 40 + i;
    const s = playOut({ seed, playerCount: 6 }, botInputs(seed, kinds).inputs);
    assert.ok(s.result, `mix ${i} did not end`);
    assert.notEqual(s.result.reason, "timeout", `mix ${i} hit the hard stop`);
    assert.ok(s.result.tick / TICK_HZ <= 180);
  }
});

test("bots only press when loaded, and fire regularly", () => {
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    const { inputs, log } = botInputs(5, [difficulty, difficulty, difficulty]);
    const s = playOut({ seed: 5, playerCount: 3 }, inputs);
    assert.equal(log.pressedWhileBusy, 0, `${difficulty} pressed while busy`);
    const volleys = s.castles.reduce(
      (n, c) => n + c.stats.volleys + c.stats.ghostBombs,
      0,
    );
    assert.equal(volleys, log.presses, `${difficulty}: a press did not fire`);
    // Reload is 2.6 s; a purposeful bot still fires at least every ~6 s on average.
    for (const c of s.castles.filter((c) => c.alive)) {
      const seconds = s.tick / TICK_HZ;
      assert.ok(
        c.stats.volleys >= seconds / 6,
        `${difficulty}: ${c.stats.volleys} volleys in ${seconds}s`,
      );
    }
  }
});

test("bots are deterministic given the seed", () => {
  const kinds: BotDifficulty[] = ["hard", "normal", "easy"];
  const a = playOut({ seed: 9, playerCount: 3 }, botInputs(9, kinds).inputs);
  const b = playOut({ seed: 9, playerCount: 3 }, botInputs(9, kinds).inputs);
  assert.equal(fingerprint(a), fingerprint(b));
});

const ALL: readonly BotDifficulty[] = ["easy", "normal", "hard"];

/** A frozen deep copy of the state, as an app handing out snapshots might pass it. */
function snapshot(state: RoundState): RoundState {
  const freeze = (o: unknown): void => {
    if (typeof o !== "object" || o === null || ArrayBuffer.isView(o)) return;
    Object.freeze(o);
    for (const v of Object.values(o)) freeze(v);
  };
  const copy = structuredClone(state);
  freeze(copy);
  return copy;
}

/** Plays rounds back to back with one set of bots, each fed `view(state)`; returns fingerprints. */
function playMatch(
  rounds: readonly number[],
  kinds: readonly BotDifficulty[],
  view: (state: RoundState) => RoundState = (s) => s,
) {
  const bots = kinds.map((difficulty, playerId) =>
    createBot({ difficulty, playerId, seed: 3 }),
  );
  const presses = kinds.map(() => 0);
  const prints = rounds.map((seed) =>
    fingerprint(
      playOut({ seed, playerCount: kinds.length }, (state) => {
        const v = view(state);
        return bots.map((bot, id) => {
          const press = bot(v);
          if (press) presses[id]!++;
          return press;
        });
      }),
    ),
  );
  return { prints, presses };
}

test("bots handed a fresh copy of the view every tick play exactly as with the live state", () => {
  // Round 2 has a new seed; round 3 repeats it, so only the tick going backwards marks it as new.
  const rounds = [11, 12, 12];
  const live = playMatch(rounds, ALL);
  const copied = playMatch(rounds, ALL, snapshot);
  for (const [id, n] of copied.presses.entries())
    assert.ok(n > 0, `${ALL[id]} bot never pressed on copied views`);
  assert.deepEqual(copied.presses, live.presses, "press counts differ");
  assert.deepEqual(copied.prints, live.prints, "rounds differ");
});

test("bots never mutate the state they are shown", () => {
  const kinds: BotDifficulty[] = ["easy", "normal", "hard", "hard"];
  const bots = kinds.map((difficulty, playerId) =>
    createBot({ difficulty, playerId, seed: 4 }),
  );
  playOut({ seed: 4, playerCount: kinds.length }, (state) => {
    const before = fingerprint(state);
    const pressed = bots.map((bot) => bot(state));
    assert.equal(fingerprint(state), before, `mutated at tick ${state.tick}`);
    return pressed;
  });
});

test("a bot reused across rounds plays each round like a fresh bot", () => {
  const kinds: BotDifficulty[] = ["hard", "easy"];
  // New seed, and the same seed again (the reset must then come from the tick going backwards).
  for (const [first, second] of [
    [1, 2],
    [2, 2],
  ] as const) {
    const reused = playMatch([first, second], kinds).prints[1];
    const fresh = playMatch([second], kinds).prints[0];
    assert.equal(reused, fresh, `round ${first} leaked into round ${second}`);
  }
});
