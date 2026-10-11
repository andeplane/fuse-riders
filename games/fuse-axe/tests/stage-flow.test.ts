import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SPECTATOR,
  type StreamEntries,
} from "fuse-netcode";
import {
  CLEAR_TICKS,
  CONTINUE,
  CONTINUE_TICKS,
  DEFAULT_SETTINGS,
  LAST_STAGE,
  PLAY,
  axeGame,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  isEntry,
  view,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { RIGHT, STAGE_1, seedOf } from "../src/engine/index.js";
import { HERO_HP, LIVES } from "../src/engine/tuning.js";
import { cleared, wiped } from "./fixtures/stage.js";

type Bodies = Record<string, readonly unknown[][]>;
let seq = 0;
/** Folds one log tick of `bodies`, every stream at generation 1, with `a` as the room's creator. */
function fold(room: Room, bodies: Bodies = {}): void {
  const tick = room.tick + 1,
    streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation: 1,
      entries: list.map((body) => [++seq, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
const run = (room: Room, ticks: number) => {
  for (let i = 0; i < ticks; i++) fold(room);
};
/** `a` (Rhea) and `b` (Brakka) seated, a bot in slot 2, Wes watching, and run `m1` started. */
function started(): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "rhea", 1],
      [JOIN, "b", "Bo", 1, "brakka", 1],
      [BOT, "add", "bot:1", "Ironhide", 2],
      [SPECTATOR, "join", "w", "Wes", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  return room;
}
const vote = (matchId = "m1", round = 1) => [CONTINUE, matchId, round];
/** The room survives its checkpoint whole: the same hash, the same view. */
function kept(room: Room): void {
  const back = decode(structuredClone(encode(room)), room.tick);
  assert.ok(back, `a ${room.stage} room restores`);
  assert.equal(hash(back), hash(room));
  assert.deepEqual(view(back), view(room));
}
/** The run with every hero out: the fold starts the countdown on the next tick. */
function countdown(room = started()): Room {
  room.world = wiped(room.world!);
  fold(room);
  assert.equal(room.until, room.tick + CONTINUE_TICKS);
  return room;
}

test("a cleared stage banks its tallies and shows them, then the run is won", () => {
  const room = started();
  fold(room, { b: [[PLAY, "m1", 1, RIGHT]] });
  // The heroes' tallies as a fight leaves them, and the stage won where it stands.
  room.world = cleared({
    ...room.world!,
    heroes: room.world!.heroes.map((hero, index) => ({
      ...hero,
      damage: 10 * (index + 1),
      knockdowns: index,
    })),
  });
  assert.deepEqual(
    view(room).tally.map((row) => [row.seat, row.stage, row.run]),
    [0, 1, 2].map((seat) => [
      seat,
      { damage: 10 * (seat + 1), knockdowns: seat },
      { damage: 10 * (seat + 1), knockdowns: seat },
    ]),
    "while the stage runs, its tallies are the run's",
  );
  fold(room);
  assert.equal(room.stage, "between");
  assert.equal(room.round, 1);
  assert.deepEqual(room.held, {}, "the stage's end lets go of the controls");
  assert.deepEqual(
    room.tally.map((row) => [row.seat, row.kind, row.damage, row.knockdowns]),
    [
      [0, "rhea", 10, 0],
      [1, "brakka", 20, 1],
      [2, "gorm", 30, 2],
    ],
    "banked in the room",
  );
  const shown = view(room);
  assert.deepEqual(
    [shown.countdown, shown.outcome, shown.lastStage, shown.world!.cleared],
    [CLEAR_TICKS, "", LAST_STAGE, true],
  );
  assert.deepEqual(
    shown.tally[1],
    {
      seat: 1,
      kind: "brakka",
      stage: { damage: 20, knockdowns: 1 },
      run: { damage: 20, knockdowns: 1 },
    },
    "banked once, not again on top of the stage's own",
  );
  kept(room);
  // The tally shows, the world holds still, and a CONTINUE or a PLAY changes nothing.
  const step = room.world!.step;
  run(room, CLEAR_TICKS - 2);
  fold(room, { a: [vote(), [PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual(
    [room.stage, view(room).countdown, room.world!.step, room.continued],
    ["between", 1, step, false],
  );
  kept(room);
  fold(room);
  // Stage 1 is the last, so far: the run is won.
  assert.deepEqual(
    [room.stage, room.outcome, room.until, room.round],
    ["over", "victory", 0, LAST_STAGE],
  );
  assert.equal(view(room).countdown, 0);
  assert.deepEqual(
    view(room).tally.map((row) => row.run.damage),
    [10, 20, 30],
  );
  kept(room);
});

test("every hero out starts the countdown; a hero's CONTINUE revives the party once, and the second wipe loses the run", () => {
  const room = started();
  // On a locked wave with ravagers about, so the stage has something to keep.
  room.world = { ...room.world!, camX: STAGE_1.waves[0]!.at };
  for (let i = 0; i < 80 && !room.world!.enemies.length; i++) fold(room);
  assert.ok(room.world!.locked && room.world!.enemies.length > 0);
  countdown(room);
  const shown = view(room);
  assert.deepEqual(
    [shown.stage, shown.countdown, shown.continued, shown.world!.defeated],
    ["running", CONTINUE_TICKS, false, true],
  );
  kept(room);
  // The world goes on while the clock runs: the ravagers are still about.
  run(room, 10);
  assert.equal(view(room).countdown, CONTINUE_TICKS - 10);
  const { camX, wave, waveStep, enemies } = room.world!;
  fold(room, { b: [vote(), vote()] });
  assert.deepEqual(
    [room.stage, room.until, room.continued],
    ["running", 0, true],
  );
  for (const hero of room.world!.heroes)
    assert.deepEqual(
      [hero.state, hero.lives, hero.hp],
      ["respawn", LIVES, HERO_HP[hero.kind]],
    );
  assert.deepEqual(
    [room.world!.camX, room.world!.wave, room.world!.waveStep],
    [camX, wave, waveStep],
    "the waves keep their progress",
  );
  assert.deepEqual(
    room.world!.enemies.map((enemy) => enemy.id),
    enemies.map((enemy) => enemy.id),
  );
  kept(room);
  // A late or repeated vote revives nobody again: the continue is spent.
  room.world = wiped(room.world!);
  fold(room, { a: [vote()] });
  assert.deepEqual(
    [room.stage, room.outcome, room.until],
    ["over", "defeat", 0],
    "the second wipe in the stage loses the run at once",
  );
  assert.deepEqual(room.held, {});
  assert.equal(room.tally.length, 3);
  kept(room);
  fold(room, { a: [vote()], b: [vote()] });
  assert.equal(room.stage, "over", "a vote after the end changes nothing");
});

test("the countdown runs out into game over, and a vote after it resurrects nothing", () => {
  const room = countdown();
  run(room, CONTINUE_TICKS - 1);
  assert.deepEqual([room.stage, view(room).countdown], ["running", 1]);
  kept(room);
  fold(room);
  assert.deepEqual([room.stage, room.outcome], ["over", "defeat"]);
  assert.equal(room.continued, false);
  kept(room);
  fold(room, { a: [vote()], b: [vote()] });
  assert.deepEqual([room.stage, room.outcome], ["over", "defeat"]);
  // A vote on the countdown's last tick still counts: it is folded before the clock is read.
  const last = countdown();
  run(last, CONTINUE_TICKS - 1);
  fold(last, { a: [vote()] });
  assert.deepEqual([last.stage, last.continued], ["running", true]);
});

test("only a present hero of this run and stage votes: not a watcher, a bot, a newcomer, an absent seat or an old run", () => {
  const room = countdown();
  fold(room, { a: [[JOIN, "c", "Cy", 3, "gorm", 1]] });
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  fold(room, {
    w: [vote()],
    "bot:1": [vote()],
    c: [vote()],
    b: [vote()],
    a: [vote("m0"), vote("m1", 2)],
  });
  assert.deepEqual(
    [room.until > 0, room.continued],
    [true, false],
    "nothing counted",
  );
  // A vote before the countdown is no vote: it neither revives nor spends the continue.
  const early = started();
  fold(early, { a: [vote()] });
  early.world = wiped(early.world!);
  fold(early, { a: [vote()] });
  assert.deepEqual([early.until > 0, early.continued], [true, false]);
  fold(early, { a: [vote()] });
  assert.equal(early.continued, true);
});

test("the countdown holds the seats of a run: with every human gone it runs out into game over, and one who returns in time still votes", () => {
  const gone = countdown();
  fold(gone, { a: [[LEAVE, "a"], [LEAVE, "b"], vote()] });
  // A run keeps its seats for the absent (only the lobby, camp and game over give them up), so nobody votes.
  assert.deepEqual(
    [...gone.seats.values()].map((seat) => [seat.id, seat.connected]),
    [
      ["a", false],
      ["b", false],
      ["bot:1", true],
      ["w", true],
    ],
  );
  assert.equal(gone.until, gone.tick - 1 + CONTINUE_TICKS, "the clock runs");
  kept(gone);
  fold(gone, { a: [vote()], b: [vote()] });
  assert.equal(gone.continued, false, "an absent seat has no vote");
  run(gone, CONTINUE_TICKS);
  assert.deepEqual([gone.stage, gone.outcome], ["over", "defeat"]);
  kept(gone);
  // One back before the clock runs out is a present hero again.
  const back = countdown();
  fold(back, {
    a: [
      [LEAVE, "a"],
      [LEAVE, "b"],
    ],
  });
  run(back, 50);
  fold(back, { a: [[JOIN, "b", "Bo", 1, "brakka", 1]] });
  fold(back, { b: [vote()] });
  assert.deepEqual(
    [back.stage, back.until, back.continued],
    ["running", 0, true],
  );
  kept(back);
});

test("a seat that leaves between stages is dropped, and the tally and the win stand", () => {
  const room = started();
  room.world = cleared({
    ...room.world!,
    heroes: room.world!.heroes.map((hero) => ({ ...hero, damage: 7 })),
  });
  fold(room);
  assert.equal(room.stage, "between");
  fold(room, { a: [[LEAVE, "b"]] });
  assert.equal(room.seats.has("b"), false, "camp gives the seat up");
  assert.equal(room.stage, "between");
  assert.deepEqual(
    room.tally.map((row) => [row.seat, row.damage]),
    [
      [0, 7],
      [1, 7],
      [2, 7],
    ],
    "the run's tallies keep the hero that left",
  );
  kept(room);
  run(room, CLEAR_TICKS);
  assert.deepEqual([room.stage, room.outcome], ["over", "victory"]);
  kept(room);
  // The next run sets out with whoever is seated.
  fold(room, { a: [[ACTION, "rematch", "m2"]] });
  assert.deepEqual(
    [room.stage, room.world!.heroes.map((hero) => hero.seat)],
    ["running", [0, 2]],
  );
  assert.deepEqual(
    room.tally.map((row) => [row.seat, row.damage]),
    [
      [0, 0],
      [2, 0],
    ],
  );
});

test("a stage cleared as the last hero falls is won; the lobby ends a countdown", () => {
  const room = started();
  room.world = wiped(cleared(room.world!));
  fold(room);
  assert.equal(room.stage, "between");
  const lobby = countdown();
  fold(lobby, { a: [[ACTION, "lobby", "m2"]] });
  assert.deepEqual(
    [lobby.stage, lobby.until, lobby.continued, lobby.outcome, lobby.tally],
    ["lobby", 0, false, "", []],
  );
  kept(lobby);
});

test("every replica folds the same vote however it arrives: duplicated, out of order or from two heroes at once", () => {
  const one = countdown(),
    other = countdown();
  fold(one, { a: [vote()], b: [vote()] });
  fold(other, { b: [vote(), vote()], a: [[PLAY, "m1", 1, 0], vote()] });
  assert.equal(hash(one), hash(other));
  run(one, 30);
  run(other, 30);
  assert.equal(hash(one), hash(other));
});

test("a vote is an entry for a run and a stage", () => {
  assert.ok(isEntry([1, 5, CONTINUE, "m1", 1]));
  assert.ok(!isEntry([1, 5, CONTINUE, "m1"]), "short");
  assert.ok(!isEntry([1, 5, CONTINUE, "m1", 1, 0]), "long");
  assert.ok(!isEntry([1, 5, CONTINUE, "", 1]), "a run id");
  assert.ok(!isEntry([1, 5, CONTINUE, "m1", -1]), "a stage");
  assert.equal(axeGame.text.rematchLater, "REMATCH opens once the run is over");
});

test("the checkpoint refuses a stage flow the fold cannot reach, without partial state", () => {
  const between = started();
  between.world = cleared(between.world!);
  fold(between);
  const counting = countdown(),
    lost = countdown();
  run(lost, CONTINUE_TICKS);
  const won = started();
  won.world = cleared(won.world!);
  fold(won);
  run(won, CLEAR_TICKS);
  const playing = started(),
    lobby = createRoom("m0", DEFAULT_SETTINGS);
  const rooms: Record<string, Room> = {
    playing,
    between,
    counting,
    lost,
    won,
    lobby,
  };
  for (const room of Object.values(rooms)) kept(room);
  const broken = (
    room: Room,
    change: (fields: unknown[]) => void,
  ): Room | undefined => {
    const fields = structuredClone(encode(room));
    change(fields);
    return decode(fields, room.tick);
  };
  const row = (f: unknown[], index = 0) => (f[10] as unknown[][])[index]!;
  const cases: [string, Room, (f: unknown[]) => void][] = [
    ["a clock that is no tick", playing, (f) => (f[7] = -1)],
    ["a continue that is no flag", playing, (f) => (f[8] = 1)],
    ["an unknown outcome", lost, (f) => (f[9] = "draw")],
    ["tallies not a list", playing, (f) => (f[10] = {})],
    ["six tallies", playing, (f) => (f[10] = Array(6).fill(row(f)))],
    ["a short tally", playing, (f) => row(f).pop()],
    ["a tally's seat", playing, (f) => (row(f)[0] = 5)],
    ["a tally's hero", playing, (f) => (row(f)[1] = "wizard")],
    ["a tally's damage", between, (f) => (row(f)[2] = -1)],
    ["a tally's knockdowns", between, (f) => (row(f)[3] = 1.5)],
    ["a tally for another hero", playing, (f) => (row(f)[1] = "gorm")],
    ["a tally in another seat", playing, (f) => (row(f)[0] = 3)],
    ["a tally missing", playing, (f) => (f[10] as unknown[]).pop()],
    ["a stage tallied before it ended", playing, (f) => (row(f)[2] = 1)],
    ["an ended stage not banked", between, (f) => (row(f)[3] = 9)],
    ["a clock in play with heroes standing", playing, (f) => (f[7] = 9)],
    ["no clock with every hero out", counting, (f) => (f[7] = 0)],
    ["a countdown already over", counting, (f) => (f[7] = counting.tick)],
    [
      "a countdown past its length",
      counting,
      (f) => (f[7] = counting.tick + CONTINUE_TICKS + 1),
    ],
    ["a countdown with the continue spent", counting, (f) => (f[8] = true)],
    ["an outcome in play", playing, (f) => (f[9] = "defeat")],
    ["a cleared stage still in play", playing, (f) => (f[2] = "between")],
    ["a tally with no clock", between, (f) => (f[7] = 0)],
    [
      "a tally past its length",
      between,
      (f) => (f[7] = between.tick + CLEAR_TICKS + 1),
    ],
    ["an outcome between stages", between, (f) => (f[9] = "victory")],
    ["a clock once over", won, (f) => (f[7] = won.tick + 1)],
    ["no outcome once over", won, (f) => (f[9] = "")],
    ["a win short of the stage's end", lost, (f) => (f[9] = "victory")],
    ["a loss with the stage won", won, (f) => (f[9] = "defeat")],
    ["a lobby with a clock", lobby, (f) => (f[7] = 1)],
    ["a lobby with the continue spent", lobby, (f) => (f[8] = true)],
    ["a lobby with an outcome", lobby, (f) => (f[9] = "defeat")],
    ["a lobby with tallies", lobby, (f) => (f[10] = [[0, "rhea", 0, 0]])],
  ];
  for (const [what, room, change] of cases)
    assert.equal(broken(room, change), undefined, what);
  // A loss with a hero still standing is no loss.
  const standing = { ...lost.world!, heroes: started().world!.heroes };
  assert.equal(
    decode(encode({ ...lost, world: standing }), lost.tick),
    undefined,
    "a loss with heroes standing",
  );
  // Every stage's world is seeded for its run and stage.
  assert.equal(won.world!.seed, seedOf("m1:1"));
});
