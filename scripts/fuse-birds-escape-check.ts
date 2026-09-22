import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  advance,
  candidateVector,
  decodeState,
  encodeState,
  hashState,
  legalVector,
  traceShot,
  RULES,
  type Action,
  type Match,
  type Vector,
} from "fuse-birds-game";

interface Case {
  seed: number;
  count: number;
  tick: number;
  turn: number;
  target: string;
  checkpoint: Record<string, unknown> & {
    terrain: { bits: string; revisions: Record<string, number> };
  };
}
const input = JSON.parse(
  await readFile("/tmp/fuse-birds-continuing-check.json", "utf8"),
) as { rules: string; failures: Case[] };
if (input.rules !== RULES)
  throw new Error("Counterexamples use a different rules version");
function restore(item: Case): Match {
  const state = decodeState({
    ...item.checkpoint,
    terrain: {
      ...item.checkpoint.terrain,
      bits: Uint8Array.from(
        Buffer.from(item.checkpoint.terrain.bits, "base64"),
      ),
      revisions: Object.values(item.checkpoint.terrain.revisions),
    },
  });
  if (!state) throw new Error("Invalid counterexample checkpoint");
  return state;
}
const results: unknown[] = [];
type Entry = { tick: number; actions: Action[] };
function verifyRoute(initial: Match, targetId: string, entries: Entry[]) {
  const state = decodeState(encodeState(initial))!;
  const owner = state.players[state.active]!.id;
  const before = state.players.find((p) => p.id === targetId)!.hp;
  let damageBeforeWaterRise = false;
  const step = (actions: Action[] = []) => {
    const target = state.players.find((p) => p.id === targetId)!;
    const hp = target.hp,
      water = state.water,
      feet = target.y / 256 + 6;
    const facts = advance(state, actions);
    if (process.env.FUSE_BIRDS_WITNESS_TRACE && target.hp < hp)
      console.log(
        JSON.stringify({
          initialTurn: initial.turn,
          target: targetId,
          tick: state.tick,
          hp,
          after: target.hp,
          water,
          afterWater: state.water,
          feet,
          afterFeet: target.y / 256 + 6,
          facts,
        }),
      );
    // A shot may remove support and drop the target into existing water. Only
    // automatic water-rise damage is excluded from an excavation witness.
    if (
      target.hp < hp &&
      feet < Math.min(water, state.water) &&
      (state.water === water || target.y / 256 + 6 < state.water)
    )
      damageBeforeWaterRise = true;
  };
  let previous = state.tick;
  for (const entry of entries) {
    if (entry.tick <= previous || entry.tick > initial.tick + 20_000)
      throw new Error("Invalid witness tick order or length");
    while (state.tick < entry.tick - 1) step();
    if (state.phase !== "aiming")
      throw new Error("Witness acts outside aiming");
    for (const action of entry.actions) {
      const actor = state.players[state.active]!;
      if (
        action.actor !== actor.id ||
        action.round !== state.round ||
        action.turn !== state.turn ||
        action.ordinal !== actor.ordinal + 1 ||
        (action.type !== "pass" &&
          action.type !== "move" &&
          action.type !== "hop" &&
          (action.type !== "launch" || action.weapon !== "pebble"))
      )
        throw new Error("Witness contains an invalid or non-Pebble action");
    }
    step(entry.actions);
    previous = entry.tick;
  }
  const lastTurn = state.turn;
  for (
    let tick = 0;
    tick < 400 && state.turn === lastTurn && state.phase !== "over";
    tick++
  )
    step();
  const actor = state.players.find((p) => p.id === owner)!;
  const target = state.players.find((p) => p.id === targetId)!;
  if (actor.hp <= 0 || target.hp >= before || !damageBeforeWaterRise)
    throw new Error(
      `Replayed witness does not establish damage before water rise with a surviving shooter: turn ${initial.turn}, target ${targetId}, hp ${before}->${target.hp}, water ${initial.water}->${state.water}`,
    );
  return {
    hash: hashState(state),
    tick: state.tick,
    ownerHp: actor.hp,
    targetHp: target.hp,
  };
}
if (process.argv.includes("--late-comparison")) {
  const saved = JSON.parse(
    await readFile(
      new URL(
        "../games/fuse-birds/tests/fixtures/continuing-play-witnesses.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    results: {
      seed: number;
      count: number;
      turn: number;
      target: string;
      excavation?: Entry[];
    }[];
  };
  for (const [earlierTurn, lateTurn] of [
    [20, 32],
    [21, 33],
  ]) {
    const earlier = restore(
      input.failures.find(
        (item) =>
          item.seed === 3 && item.count === 4 && item.turn === earlierTurn,
      )!,
    );
    const late = restore(
      input.failures.find(
        (item) => item.seed === 3 && item.count === 4 && item.turn === lateTurn,
      )!,
    );
    const witness = saved.results.find(
      (item) =>
        item.seed === 3 && item.count === 4 && item.turn === earlierTurn,
    )!;
    assert.deepEqual(late.terrain.bits, earlier.terrain.bits);
    assert.equal(late.wind, earlier.wind);
    assert.deepEqual(
      late.players.map(({ id, x, y, hp }) => ({ id, x, y, hp })),
      earlier.players.map(({ id, x, y, hp }) => ({ id, x, y, hp })),
    );
    const earlierResult = verifyRoute(
      earlier,
      witness.target,
      witness.excavation!,
    );
    const beforeHash = hashState(late),
      startTick = late.tick;
    let launched = 0;
    const entries: Entry[] = [];
    for (const entry of witness.excavation!) {
      const due = startTick + entry.tick - earlier.tick;
      while (late.tick < due - 1 && late.phase !== "over") advance(late);
      if (late.phase === "over") break;
      const actor = late.players[late.active]!;
      assert.equal(actor.id, entry.actions[0]!.actor);
      const actions = entry.actions.map((action): Action => ({
        ...action,
        round: late.round,
        turn: late.turn,
        ordinal: actor.ordinal + 1,
      }));
      launched += actions.filter((action) => action.type === "launch").length;
      entries.push({ tick: late.tick + 1, actions });
      advance(late, actions);
    }
    for (let ticks = 0; ticks < 400 && late.phase !== "over"; ticks++)
      advance(late);
    const lowBird = late.players.find((p) => p.id === "p0")!;
    assert.equal(late.phase, "over");
    assert.equal(lowBird.hp, 0);
    assert.ok(lowBird.y / 256 + 6 >= late.water);
    assert.equal(
      launched,
      1,
      "water ends the game before the second excavation shot",
    );
    const result = {
      earlierTurn,
      lateTurn,
      sameTerrainPositionsHealthWind: true,
      earlierResult,
      beforeHash,
      finalHash: hashState(late),
      water: late.water,
      lowBirdFeet: lowBird.y / 256 + 6,
      launched,
      entries,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    "/tmp/fuse-birds-late-comparison.json",
    JSON.stringify({ rules: RULES, results }, null, 2),
  );
} else if (process.argv.includes("--late-movement")) {
  for (const item of input.failures.filter(
    (item) => item.seed === 3 && item.count === 4 && item.turn >= 32,
  )) {
    const initial = restore(item),
      owner = initial.players[initial.active]!.id;
    const queue = [{ state: initial, route: [] as Entry[] }],
      seen = new Set<string>();
    let found: Entry[] | undefined,
      checked = 0;
    for (
      let cursor = 0;
      cursor < queue.length && cursor < 2000 && !found;
      cursor++
    ) {
      const { state, route } = queue[cursor]!;
      const actor = state.players[state.active]!,
        target = state.players.find((p) => p.id === item.target)!;
      const key = `${actor.x}:${actor.y}:${state.movement}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checked++;
      for (let index = 0; index < 281 && !found; index++) {
        const candidate = candidateVector(actor, target, state.wind, index);
        if (!candidate) continue;
        for (const dx of [0, -16, 16, -32, 32])
          for (const dy of [0, -16, 16, -32, 32]) {
            const vector = { vx: candidate.vx + dx, vy: candidate.vy + dy };
            if (
              !legalVector(vector.vx, vector.vy) ||
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
              actor: owner,
              round: state.round,
              turn: state.turn,
              ordinal: actor.ordinal + 1,
              weapon: "pebble",
              ...vector,
            };
            const trial = [...route, { tick: state.tick + 1, actions: [shot] }];
            try {
              verifyRoute(initial, target.id, trial);
              found = trial;
              break;
            } catch {
              /* Candidate may lose to water or self damage during resolution. */
            }
          }
      }
      if (state.movement < 3 * 256) continue;
      for (const type of ["move", "hop"] as const)
        for (const direction of [-1, 1] as const) {
          const copy = decodeState(encodeState(state))!;
          const action: Action = {
            type,
            direction,
            actor: owner,
            round: state.round,
            turn: state.turn,
            ordinal: actor.ordinal + 1,
          };
          advance(copy, [action]);
          for (
            let ticks = 0;
            ticks < 100 &&
            !copy.players[copy.active]!.grounded &&
            copy.turn === initial.turn;
            ticks++
          )
            advance(copy);
          const bird = copy.players.find((p) => p.id === owner)!;
          if (
            copy.turn === initial.turn &&
            copy.phase === "aiming" &&
            bird.grounded &&
            bird.hp > 0 &&
            copy.movement < state.movement
          )
            queue.push({
              state: copy,
              route: [...route, { tick: state.tick + 1, actions: [action] }],
            });
        }
    }
    const result = {
      turn: item.turn,
      target: item.target,
      checked,
      queued: queue.length,
      found,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    "/tmp/fuse-birds-late-movement.json",
    JSON.stringify({ rules: RULES, results }, null, 2),
  );
} else if (process.argv.includes("--verify-saved")) {
  const saved = JSON.parse(
    await readFile(
      new URL(
        "../games/fuse-birds/tests/fixtures/continuing-play-witnesses.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    rules: string;
    results: {
      seed: number;
      count: number;
      tick: number;
      target: string;
      direct?: Vector;
      excavation?: Entry[];
      initialHash: string;
      verified?: ReturnType<typeof verifyRoute>;
    }[];
  };
  if (saved.rules !== RULES)
    throw new Error("Saved witnesses use different rules");
  const verified = saved.results.map((result) => {
    const item = input.failures.find(
      (item) =>
        item.seed === result.seed &&
        item.count === result.count &&
        item.tick === result.tick &&
        item.target === result.target,
    );
    if (!item) throw new Error("Unknown saved counterexample");
    const state = restore(item),
      actor = state.players[state.active]!;
    if (hashState(state) !== result.initialHash)
      throw new Error("Counterexample hash differs from retained witness");
    const route =
      result.excavation ??
      (result.direct
        ? [
            {
              tick: state.tick + 1,
              actions: [
                {
                  type: "launch" as const,
                  actor: actor.id,
                  round: state.round,
                  turn: state.turn,
                  ordinal: actor.ordinal + 1,
                  weapon: "pebble" as const,
                  ...result.direct,
                },
              ],
            },
          ]
        : undefined);
    const replayed = route
      ? verifyRoute(state, result.target, route)
      : undefined;
    if (result.verified && replayed?.hash !== result.verified.hash)
      throw new Error("Witness replay differs from retained final hash");
    return {
      ...result,
      verified: replayed,
    };
  });
  await writeFile(
    "/tmp/fuse-birds-escape-verified.json",
    JSON.stringify({ rules: RULES, results: verified }, null, 2),
  );
  const unresolved = verified.filter((item) => !item.verified).length;
  console.log(
    JSON.stringify({ verified: verified.length - unresolved, unresolved }),
  );
  process.exitCode = unresolved ? 1 : 0;
} else {
  function excavationRoute(
    initial: Match,
    targetId: string,
    local = false,
    firstChoice = 0,
  ): Entry[] | undefined {
    let state = decodeState(encodeState(initial))!;
    const owner = state.players[state.active]!.id,
      entries: Entry[] = [];
    for (let depth = 0; depth < 12; depth++) {
      const actor = state.players.find((p) => p.id === owner)!,
        target = state.players.find((p) => p.id === targetId)!;
      if (
        actor.hp <= 0 ||
        target.hp <= 0 ||
        state.phase !== "aiming" ||
        state.players[state.active]!.id !== owner
      )
        return;
      const branches: {
        state: Match;
        entries: Entry[];
        score: number;
        key: string;
      }[] = [];
      const vectors: Vector[] = [];
      for (let candidate = 0; candidate < 281; candidate += 5) {
        const vector = candidateVector(actor, target, state.wind, candidate);
        if (vector) vectors.push(vector);
      }
      const toward = Math.sign(target.x - actor.x) || 1;
      if (local)
        for (const vx of [64, 128, 256, 512, 768, 1024])
          for (const vy of [-2560, -1920, -1280, -768, -384])
            vectors.push({ vx: vx * toward, vy });
      for (const vector of vectors) {
        const copy = decodeState(encodeState(state))!;
        const shot: Action = {
          type: "launch",
          actor: owner,
          round: copy.round,
          turn: copy.turn,
          ordinal: actor.ordinal + 1,
          weapon: "pebble",
          ...vector,
        };
        const route: Entry[] = [{ tick: copy.tick + 1, actions: [shot] }];
        const direct = traceShot(
          state.terrain,
          state.players,
          actor,
          vector,
          state.wind,
          target.id,
        ).hit;
        const facts = advance(copy, [shot]);
        for (
          let ticks = 0;
          ticks < 400 && copy.turn === state.turn && copy.phase !== "over";
          ticks++
        )
          facts.push(...advance(copy));
        if (copy.players.find((p) => p.id === owner)!.hp <= 0) continue;
        if (
          (direct ||
            (copy.water === state.water &&
              copy.terrain.version > state.terrain.version)) &&
          copy.players.find((p) => p.id === targetId)!.hp < target.hp
        )
          return [...entries, ...route];
        if (
          copy.phase === "over" ||
          copy.terrain.version === state.terrain.version
        )
          continue;
        const blasts = facts.filter(
          (f) => f.type === "blast" && f.x !== undefined && f.y !== undefined,
        );
        if (!blasts.length) continue;
        // Prefer excavation toward the target, then retain health. Every candidate is an ordinary live shot.
        const distance = Math.min(
          ...blasts.map((f) =>
            Math.hypot(f.x! - target.x / 256, f.y! - target.y / 256),
          ),
        );
        const score =
          distance +
          (actor.hp - copy.players.find((p) => p.id === owner)!.hp) * 2;
        for (
          let ticks = 0;
          ticks < 1500 &&
          !["over", "fault"].includes(copy.phase) &&
          copy.players[copy.active]!.id !== owner;
          ticks++
        ) {
          const other = copy.players[copy.active]!;
          const actions: Action[] =
            copy.phase === "aiming"
              ? [
                  {
                    type: "pass",
                    actor: other.id,
                    round: copy.round,
                    turn: copy.turn,
                    ordinal: other.ordinal + 1,
                  },
                ]
              : [];
          if (actions.length) route.push({ tick: copy.tick + 1, actions });
          advance(copy, actions);
        }
        if (
          copy.phase !== "aiming" ||
          copy.players.find((p) => p.id === owner)!.hp <= 0
        )
          continue;
        const blast = blasts[0]!;
        const key = `${Math.round(blast.x! / 8)}:${Math.round(blast.y! / 8)}:${copy.players.find((p) => p.id === owner)!.hp}`;
        if (!branches.some((branch) => branch.key === key))
          branches.push({ state: copy, entries: route, score, key });
      }
      const best = branches.sort((a, b) => a.score - b.score)[
        depth === 0 ? firstChoice : 0
      ];
      if (!best) return;
      entries.push(...best.entries);
      state = best.state;
    }
  }
  for (const item of input.failures) {
    const state = restore(item),
      actor = state.players[state.active]!,
      target = state.players.find((p) => p.id === item.target)!;
    let found: Vector | undefined,
      tried = 0;
    const seen = new Set<string>();
    for (let index = 0; index < 281 && !found; index++) {
      const candidate = candidateVector(actor, target, state.wind, index);
      if (!candidate) continue;
      for (const dx of [0, -16, 16, -32, 32])
        for (const dy of [0, -16, 16, -32, 32]) {
          const vector = { vx: candidate.vx + dx, vy: candidate.vy + dy },
            key = `${vector.vx}:${vector.vy}`;
          if (seen.has(key) || !legalVector(vector.vx, vector.vy)) continue;
          seen.add(key);
          tried++;
          if (
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
          const copy = decodeState(encodeState(state))!;
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
          ) {
            found = vector;
            break;
          }
        }
    }
    let route: Entry[] | undefined;
    if (!found)
      for (const local of [false, true])
        for (let choice = 0; choice < 6 && !route; choice++)
          route = excavationRoute(state, target.id, local, choice);
    const result = {
      seed: item.seed,
      count: item.count,
      tick: item.tick,
      turn: item.turn,
      target: item.target,
      tried,
      direct: found,
      excavation: route,
      verified: route ? verifyRoute(state, target.id, route) : undefined,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(
    "/tmp/fuse-birds-escape-check.json",
    JSON.stringify({ rules: RULES, results }, null, 2),
  );
}
