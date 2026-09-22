import {
  advance,
  candidateVector,
  createMatch,
  decodeState,
  encodeState,
  hashState,
  RULES,
  traceShot,
  type Action,
  type Match,
} from "fuse-birds-game";
/** Verification driver only: ordinary public inputs, only launch/pass, no state mutation. */
export function nextReplayActions(state: Match): Action[] {
  if (state.phase !== "aiming") return [];
  const player = state.players[state.active]!;
  const scope = {
    actor: player.id,
    round: state.round,
    turn: state.turn,
    ordinal: player.ordinal + 1,
  };
  for (const target of state.players.filter(
    (p) => p.id !== player.id && p.hp > 0,
  )) {
    for (let candidate = 0; candidate < 201; candidate++) {
      const vector = candidateVector(player, target, state.wind, candidate);
      if (
        vector &&
        traceShot(
          state.terrain,
          state.players,
          player,
          vector,
          state.wind,
          target.id,
        ).hit
      ) {
        const action: Action = {
          ...scope,
          type: "launch",
          weapon:
            player.ammo > 0 && state.turn % 3 === 0 ? "scatter" : "pebble",
          ...vector,
        };
        return [action, { ...action }]; // A duplicate release is part of the replay contract.
      }
    }
  }
  return [{ ...scope, type: "pass" }];
}
export function replayFixture(seed: number, count: number) {
  let state = createMatch(
    "cross-runtime",
    seed,
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `Bird ${i}`,
    })),
  );
  const hashes: string[] = [],
    events: Record<string, number> = {};
  let positions: { id: string; x: number; y: number }[] | undefined;
  for (
    let tick = 0;
    tick < 20_000 && state.phase !== "over" && state.phase !== "fault";
    tick++
  ) {
    for (const event of advance(state, nextReplayActions(state)))
      events[event.type] = (events[event.type] ?? 0) + 1;
    if (state.phase !== "preparing") {
      positions ??= state.players.map(({ id, x, y }) => ({ id, x, y }));
      if (
        positions.some((position, index) => {
          const player = state.players[index]!;
          return (
            player.id !== position.id ||
            player.x !== position.x ||
            player.y !== position.y
          );
        })
      )
        throw new Error(`A stationary bird moved at tick ${state.tick}`);
    }
    const hash = hashState(state);
    hashes.push(hash);
    if (tick % 19 === 0) {
      const restored = decodeState(encodeState(state));
      if (!restored || hashState(restored) !== hash)
        throw new Error(`Checkpoint mismatch at tick ${state.tick}`);
      state = restored;
    }
  }
  if (state.phase !== "over")
    throw new Error(`Replay did not finish: ${state.phase} at ${state.tick}`);
  return {
    rules: RULES,
    seed,
    count,
    hashes,
    final: {
      hash: hashState(state),
      ticks: state.tick,
      winner: state.winner,
      terrainVersion: state.terrain.version,
      generationWork: state.preparation.work,
      events,
    },
  };
}
