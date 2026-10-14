export interface SteeringInput {
  epochAt: number;
  left: boolean;
  right: boolean;
  sent: boolean;
  steeringChanged: boolean;
  matchId: string;
  round: number;
}
export interface ControlSample {
  epochAt: number;
  matchId: string;
  round: number;
  phase: string;
  players: Array<{
    id: string;
    alive: boolean;
    heldMotion?: { left: boolean; right: boolean };
  }>;
}
/** Match the requested control transition in its match/round and before its next steering edge.
 * Missing/slow responses are explicit timeouts, never dropped from a percentile silently. */
export function responseLatencies(
  inputs: readonly SteeringInput[],
  own: readonly ControlSample[],
  observed: readonly ControlSample[],
  id: string,
  deadlineMs = 2000,
): { press: number[]; release: number[]; timedOut: number; eligible: number } {
  const result = {
    press: [] as number[],
    release: [] as number[],
    timedOut: 0,
    eligible: 0,
  };
  const transitions: ControlSample[] = [];
  let previous:
    { sample: ControlSample; left: boolean; right: boolean } | undefined;
  for (const sample of observed) {
    const player = sample.players.find((player) => player.id === id);
    const controls = player?.heldMotion;
    if (sample.phase !== "playing" || !player?.alive || !controls) {
      previous = undefined;
      continue;
    }
    if (
      previous &&
      previous.sample.matchId === sample.matchId &&
      previous.sample.round === sample.round &&
      (previous.left !== controls.left || previous.right !== controls.right)
    )
      transitions.push(sample);
    previous = { sample, ...controls };
  }
  const edges = inputs.filter((input) => input.sent && input.steeringChanged);
  for (const [index, input] of edges.entries()) {
    const before = own
      .filter((sample) => sample.epochAt <= input.epochAt)
      .at(-1);
    if (
      !before ||
      before.phase !== "playing" ||
      before.matchId !== input.matchId ||
      before.round !== input.round ||
      !before.players.some((player) => player.id === id && player.alive)
    )
      continue;
    result.eligible++;
    const end = Math.min(
      input.epochAt + deadlineMs,
      edges[index + 1]?.epochAt ?? Infinity,
    );
    const seen = transitions.find(
      (sample) =>
        sample.epochAt >= input.epochAt &&
        sample.epochAt < end &&
        sample.matchId === input.matchId &&
        sample.round === input.round &&
        sample.phase === "playing" &&
        sample.players.some(
          (player) =>
            player.id === id &&
            player.alive &&
            player.heldMotion?.left === input.left &&
            player.heldMotion?.right === input.right,
        ),
    );
    if (!seen) result.timedOut++;
    else
      result[input.left || input.right ? "press" : "release"].push(
        seen.epochAt - input.epochAt,
      );
  }
  return result;
}

export function withinLatencyBudget(run: {
  playingRider: boolean;
  ownInputs: number;
  eligible: number;
  timedOut: number;
  p95: number | null;
}): boolean {
  return (
    !run.playingRider ||
    (run.ownInputs >= 2 &&
      run.eligible > 0 &&
      run.timedOut / run.eligible <= 0.2 &&
      run.p95 !== null &&
      run.p95 < 600)
  );
}
