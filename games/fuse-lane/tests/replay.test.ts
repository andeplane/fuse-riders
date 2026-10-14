import test from "node:test";
import assert from "node:assert/strict";
import {
  JOBHUB,
  STREETS,
  TRAIL_WALKS,
  createPlayer,
  decodePlayer,
  doorOf,
  walkTo,
} from "../src/game/index.js";
import { LocalMatch } from "../src/app/local.js";
import { boardModel, replayAt, type Viewer } from "../src/app/presenter.js";
import { route } from "../src/app/layout.js";

const LOCAL: Viewer = {
  me: "",
  host: true,
  solo: true,
  display: false,
  shared: false,
  local: true,
};

test("a walk is written to the week's trail: when it set off, from where, and to which place; at most TRAIL_WALKS", () => {
  const player = createPlayer([50, 50, 50, 50]);
  const from = player.pos;
  walkTo(player, JOBHUB);
  assert.deepEqual(player.trail, [player.time, from, JOBHUB]);
  for (let k = 0; k < TRAIL_WALKS + 5; k++) {
    player.dest = -1;
    player.inside = -1;
    player.time = 0;
    walkTo(player, k % 2 ? JOBHUB : 0);
  }
  assert.equal(player.trail.length, TRAIL_WALKS * 3);
});

test("a checkpoint keeps the trail, starts it empty for a save from before it, and rejects a broken one", () => {
  const player = createPlayer([50, 50, 50, 50]);
  walkTo(player, JOBHUB);
  const raw = JSON.parse(JSON.stringify(player)) as Record<string, unknown>;
  assert.deepEqual(decodePlayer(raw, 0)?.trail, player.trail);
  const { trail: _trail, ...old } = raw;
  assert.deepEqual(decodePlayer(old, 0)?.trail, []);
  for (const bad of [
    [1, 2],
    [0, STREETS.size, 0],
    [0, 0, 99],
    [-1, 0, 0],
  ])
    assert.equal(decodePlayer({ ...raw, trail: bad }, 0), undefined, `${bad}`);
});

test("a replay walks the trail step by step and then waits in the place it reached", () => {
  const from = STREETS.start,
    path = route(from, doorOf(JOBHUB), JOBHUB, STREETS.size)!;
  const trail = [10, from, JOBHUB];
  assert.equal(replayAt(trail, 5), undefined);
  assert.deepEqual(replayAt(trail, 10), {
    pos: from,
    dest: JOBHUB,
    inside: -1,
  });
  assert.deepEqual(replayAt(trail, 12), {
    pos: path[2],
    dest: JOBHUB,
    inside: -1,
  });
  assert.deepEqual(replayAt(trail, 10 + path.length + 50), {
    pos: doorOf(JOBHUB),
    dest: -1,
    inside: JOBHUB,
  });
});

test("while you play your week, a rival who already played walks theirs on the board, hour for hour", () => {
  const match = LocalMatch.create({
    humans: [{ name: "Ada", avatar: "fox" }],
    bots: 1,
    level: 2,
    goals: [60, 40, 30, 70],
    weekSeconds: 45,
    seed: "replay-1",
  });
  let view = match.view();
  for (let n = 0; n < 200 && !(view.part === "week" && view.current); n++) {
    match.step();
    view = match.view();
  }
  const you = view.players.find((player) => !player.bot)!;
  const from = STREETS.start,
    path = route(from, doorOf(JOBHUB), JOBHUB, STREETS.size)!;
  // A rival that has played: it walked from the start to the Job Hub at 3 h and ended its week somewhere else.
  const rival = (trail: number[], done = true) => ({
    ...view,
    players: view.players.map((player) =>
      player.bot
        ? {
            ...player,
            state: { ...player.state, done, trail, pos: 0, inside: -1 },
          }
        : player,
    ),
  });
  const at = (seen: typeof view, timeLeft: number, yours = 0) =>
    boardModel(
      {
        ...seen,
        timerTicks: Math.round(seen.partTicks * timeLeft),
        players: seen.players.map((player) =>
          player.id === you.id
            ? { ...player, state: { ...player.state, time: yours } }
            : player,
        ),
      },
      LOCAL,
    ).players.find((player) => player.id !== you.id)!;
  const played = rival([45, from, JOBHUB]);
  // Before its first walk it stays where it is; then it walks, step by step, by the real seconds or your hours.
  assert.equal(at(played, 1).pos, 0);
  const walking = at(played, 1 - 48 / 900);
  assert.ok(path.slice(1, 5).includes(walking.pos), `${walking.pos}`);
  assert.deepEqual([walking.dest, walking.done], [JOBHUB, false]);
  assert.equal(at(played, 1, 47).pos, path[2]);
  const there = at(played, 0.2);
  assert.deepEqual([there.inside, there.done], [JOBHUB, true]);
  // A rival still to play, or anyone outside the week, is drawn where it is.
  assert.equal(at(rival([45, from, JOBHUB], false), 0.2).pos, 0);
  assert.equal(
    boardModel({ ...played, part: "briefing" }, LOCAL).players.find(
      (player) => player.id !== you.id,
    )!.pos,
    0,
  );
});
