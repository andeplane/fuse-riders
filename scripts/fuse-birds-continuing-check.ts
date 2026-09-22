import { writeFile } from "node:fs/promises";
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
  if (!actor.grounded || actor.hp <= 0 || state.phase !== "aiming") return;
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
  // Bounded ordinary walking/hop alternatives; failed branches never alter the tested state.
  for (const direction of [-1, 1] as const)
    for (const hopping of [false, true]) {
      const copy = copies(state),
        entries: Entry[] = [];
      for (let move = 0; move < 16; move++) {
        const actor = copy.players[copy.active]!;
        if (
          copy.turn !== state.turn ||
          copy.phase !== "aiming" ||
          actor.hp <= 0
        )
          break;
        const action: Action = {
          type: hopping && move === 0 ? "hop" : "move",
          direction,
          actor: actor.id,
          round: copy.round,
          turn: copy.turn,
          ordinal: actor.ordinal + 1,
        };
        entries.push({ tick: copy.tick + 1, actions: [action] });
        advance(copy, [action]);
        for (
          let tick = 0;
          tick < 80 && !actor.grounded && copy.turn === state.turn;
          tick++
        )
          advance(copy);
        const shot = hitWitness(copy, targetId);
        if (shot) return [...entries, { tick: copy.tick + 1, actions: [shot] }];
      }
    }
}
const matches: unknown[] = [],
  failures: unknown[] = [];
let checked = 0,
  movementWitnesses = 0;
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
    while (
      state.tick < 10_000 &&
      state.phase !== "over" &&
      state.phase !== "fault"
    ) {
      if (
        state.phase === "aiming" &&
        state.terrain.version > 0 &&
        sampledTurn !== state.turn &&
        state.players[state.active]!.grounded
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
            if (route.length > 1) movementWitnesses++;
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
    }
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
  movementWitnesses,
  failures,
  limits:
    "Finite reachable post-destruction corpus: ordinary replay actions, current wind, surviving Pebble hits and bounded walk/hop alternatives. Not exhaustive geometry/launch enumeration; a failed search is a replayable counterexample to investigate, not proof no excavation path exists.",
};
await writeFile(
  "/tmp/fuse-birds-continuing-check.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    rules: RULES,
    matches: matches.length,
    checked,
    movementWitnesses,
    failures: failures.length,
  }),
);
if (failures.length) process.exitCode = 1;
