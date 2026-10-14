import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  advance,
  candidateVector,
  createMatch,
  decodeState,
  encodeState,
  hashState,
  traceShot,
  RULES,
  type Action,
  type Match,
} from "fuse-birds-game";
import { nextReplayActions } from "./lib/fuse-birds-replay.js";

type Entry = { tick: number; actions: Action[] };
const copies = (state: Match) => decodeState(encodeState(state))!;
function hitWitness(state: Match, targetId: string): Action | undefined {
  const actor = state.players[state.active]!,
    target = state.players.find((p) => p.id === targetId)!;
  if (actor.hp <= 0 || state.phase !== "aiming") return;
  for (let index = 0; index < 201; index++) {
    const vector = candidateVector(actor, target, state.wind, index);
    if (
      !vector ||
      !traceShot(
        state.terrain,
        state.players,
        actor,
        vector,
        state.wind,
        target.id,
      ).hit
    )
      continue;
    const shot: Action = {
      type: "launch",
      actor: actor.id,
      round: state.round,
      turn: state.turn,
      ordinal: actor.ordinal + 1,
      weapon: "pebble",
      ...vector,
    };
    const copy = copies(state);
    advance(copy, [shot]);
    for (
      let tick = 0;
      tick < 400 && copy.turn === state.turn && copy.phase !== "over";
      tick++
    )
      advance(copy);
    if (
      copy.players.find((p) => p.id === actor.id)!.hp > 0 &&
      copy.players.find((p) => p.id === target.id)!.hp < target.hp
    )
      return shot;
  }
}
function witness(state: Match, targetId: string): Entry[] | undefined {
  const direct = hitWitness(state, targetId);
  if (direct) return [{ tick: state.tick + 1, actions: [direct] }];
}
const matches: unknown[] = [],
  failures: unknown[] = [];
let checked = 0;
for (let seed = 1; seed <= 10; seed++)
  for (const count of [2, 3, 4, 5]) {
    const state = createMatch(
      "continuing-check",
      seed,
      Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        name: `Bird ${i}`,
      })),
    );
    const actions: Entry[] = [],
      witnesses: unknown[] = [];
    let sampledTurn = -1;
    let positions: { id: string; x: number; y: number }[] | undefined;
    while (
      state.tick < 10_000 &&
      state.phase !== "over" &&
      state.phase !== "fault"
    ) {
      if (
        state.phase === "aiming" &&
        state.terrain.version > 0 &&
        sampledTurn !== state.turn
      ) {
        sampledTurn = state.turn;
        for (const target of state.players.filter(
          (p) => p.hp > 0 && p.id !== state.players[state.active]!.id,
        )) {
          checked++;
          const route = witness(state, target.id);
          const sample = {
            tick: state.tick,
            turn: state.turn,
            hash: hashState(state),
            target: target.id,
            route,
          };
          if (route) {
            witnesses.push(sample);
          } else
            failures.push({
              seed,
              count,
              ...sample,
              checkpoint: {
                ...encodeState(state),
                terrain: {
                  ...state.terrain,
                  revisions: [...state.terrain.revisions],
                  bits: Buffer.from(state.terrain.bits).toString("base64"),
                },
              },
            });
        }
      }
      const next = nextReplayActions(state);
      if (next.length) actions.push({ tick: state.tick + 1, actions: next });
      advance(state, next);
      if (state.phase !== "preparing") {
        positions ??= state.players.map(({ id, x, y }) => ({ id, x, y }));
        assert.deepEqual(
          state.players.map(({ id, x, y }) => ({ id, x, y })),
          positions,
          `bird moved: seed ${seed}, players ${count}, tick ${state.tick}`,
        );
      }
    }
    assert.equal(state.phase, "over", "each corpus match must finish");
    matches.push({
      seed,
      count,
      ticks: state.tick,
      phase: state.phase,
      actions,
      witnesses,
    });
  }
const report = {
  rules: RULES,
  matches,
  checked,
  failures,
  limits:
    "Finite post-destruction corpus: launch/pass replay actions, current wind and surviving Pebble hits from the current position. No walking or hopping. Not exhaustive geometry/launch enumeration; a failed search is a replayable counterexample to investigate, not proof no excavation path exists.",
};
assert.ok(
  checked > 0,
  "the corpus must exercise post-destruction reachability",
);
if (process.argv.includes("--verify-saved")) {
  const saved = JSON.parse(
    await readFile(
      new URL(
        "../games/fuse-birds/tests/fixtures/fixed-position-reachability.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    report,
    saved,
    "fixed-position action logs and shot witnesses changed",
  );
}
await writeFile(
  "/tmp/fuse-birds-continuing-check.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    rules: RULES,
    matches: matches.length,
    checked,
    failures: failures.length,
  }),
);
if (failures.length) process.exitCode = 1;
