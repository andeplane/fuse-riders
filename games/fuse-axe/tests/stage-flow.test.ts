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
import { RIGHT, STAGE_1, seedOf, type World } from "../src/engine/index.js";
import { CAMP_STEPS, HERO_HP, LIVES } from "../src/engine/tuning.js";
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
/** Camp, its imps left alone (a bot may kick them), until it is over: the next stage (or the lobby) begins. */
function breakCamp(room: Room): void {
  assert.equal(room.world?.camp, true, "camp follows the tally");
  for (let i = 0; i < CAMP_STEPS && room.world?.camp; i++) fold(room);
  assert.notEqual(room.world?.camp, true);
}
/** The run with every hero out: the fold starts the countdown on the next tick. */
function countdown(room = started()): Room {
  room.world = wiped(room.world!);
  fold(room);
  assert.equal(room.until, room.tick + CONTINUE_TICKS);
  return room;
}

test("a cleared stage banks its tallies and shows them, then camp, then the next stage begins", () => {
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
  // Camp: its own world after stage 1, seeded for the run and its camp, between the stages with no clock of the room's.
  assert.deepEqual(
    [room.stage, room.round, room.until, room.continued, room.outcome],
    ["between", 1, 0, false, ""],
  );
  assert.deepEqual(
    [room.world!.camp, room.world!.stage, room.world!.seed, room.world!.step],
    [true, 1, seedOf("m1:1:camp"), 0],
  );
  assert.equal(view(room).countdown, CAMP_STEPS / 3);
  kept(room);
  breakCamp(room);
  // Wyrmbone Pass sets out: its own world, seeded for the run and the stage, with nothing of it tallied yet.
  assert.deepEqual(
    [room.stage, room.outcome, room.until, room.round, room.continued],
    ["running", "", 0, 2, false],
  );
  assert.deepEqual(
    [room.world!.stage, room.world!.seed, room.world!.step, room.world!.wave],
    [2, seedOf("m1:2"), 0, 0],
  );
  assert.deepEqual(view(room).world!.stage, 2);
  assert.deepEqual(
    view(room).tally.map((row) => [row.stage.damage, row.run.damage]),
    [
      [0, 10],
      [0, 20],
      [0, 30],
    ],
  );
  kept(room);
  // Stage 1's controls are stale now: only this stage's count.
  fold(room, { b: [[PLAY, "m1", 1, RIGHT]] });
  assert.equal(room.held.b, undefined);
  fold(room, { b: [[PLAY, "m1", 2, RIGHT]] });
  assert.equal(room.held.b, RIGHT);
});

/** The run taken past Stage 1's tally and camp into Stage 2, as play does. */
function second(room = started()): Room {
  room.world = cleared(room.world!);
  fold(room);
  run(room, CLEAR_TICKS);
  breakCamp(room);
  assert.deepEqual([room.stage, room.round], ["running", 2]);
  return room;
}

test("camp and the next stage carry each hero's lives, pots and health, one that went out back with one at full health, and a fresh continue", () => {
  // The continue spent in stage 1, and the heroes as its fight leaves them.
  const room = countdown();
  fold(room, { a: [vote()] });
  assert.equal(room.continued, true);
  const [rhea, brakka, gorm] = room.world!.heroes;
  const as = { state: "idle", timer: 0, z: 0, vz: 0 } as const;
  room.world = cleared({
    ...room.world!,
    heroes: [
      { ...rhea!, ...as, hp: 9, lives: 1, pots: 5 },
      { ...brakka!, ...as, state: "out", hp: 0, lives: 0, pots: 2 },
      { ...gorm!, ...as, hp: 30, lives: 3, pots: 3 },
    ],
  });
  fold(room);
  assert.equal(room.stage, "between");
  kept(room);
  run(room, CLEAR_TICKS);
  const carried = (world: World) =>
    world.heroes.map((h) => [h.seat, h.kind, h.lives, h.pots, h.hp]);
  assert.deepEqual(
    [room.stage, room.world!.camp, room.continued, carried(room.world!)],
    [
      "between",
      true,
      false,
      [
        [0, "rhea", 1, 5, 9],
        [1, "brakka", 1, 2, HERO_HP.brakka],
        [2, "gorm", 3, 3, 30],
      ],
    ],
  );
  kept(room);
  // Out of camp with what it left them (the bot may have kicked its imps for meat and pots).
  let camp = room.world!;
  for (let i = 0; i < CAMP_STEPS && room.world!.camp; i++) {
    camp = room.world!;
    fold(room);
  }
  assert.deepEqual(
    [room.stage, room.round, room.continued, room.until],
    ["running", 2, false, 0],
  );
  assert.deepEqual(carried(room.world!), carried(camp));
  assert.ok(room.world!.heroes.every((h) => h.state === "idle"));
  kept(room);
  // The continue is fresh: every hero out starts the countdown again, and only this stage's vote counts.
  room.world = wiped(room.world!);
  fold(room);
  assert.equal(room.until, room.tick + CONTINUE_TICKS);
  fold(room, { a: [vote("m1", 1)] });
  assert.equal(room.continued, false, "a vote for stage 1");
  kept(room);
  fold(room, { a: [vote("m1", 2)] });
  assert.deepEqual([room.stage, room.continued], ["running", true]);
  kept(room);
});

test("the last stage cleared shows its tally, then the run is won with every stage's tallies", () => {
  const room = started();
  const fought = (world: World, damage: number) => ({
    ...world,
    heroes: world.heroes.map((hero, index) => ({
      ...hero,
      damage: damage * (index + 1),
      knockdowns: index,
    })),
  });
  room.world = cleared(fought(room.world!, 10));
  fold(room);
  run(room, CLEAR_TICKS);
  breakCamp(room);
  const worn = fought(room.world!, 1);
  room.world = cleared({
    ...worn,
    heroes: worn.heroes.map((h, i) => ({ ...h, lives: 1 + i, pots: i, hp: 9 + i })), // prettier-ignore
  });
  fold(room);
  // Stage 2 cleared short of the last: camp, then the Drowned Crypt, each hero carrying its lives, pots and health.
  run(room, CLEAR_TICKS);
  assert.deepEqual([room.stage, room.world!.camp], ["between", true]);
  breakCamp(room);
  assert.deepEqual([room.stage, room.round, room.world!.stage], ["running", 3, 3]); // prettier-ignore
  // The players' heroes stood at camp; the bot's (Ironhide) kicked its imps, so may have eaten.
  const [ada, bo, bot] = room.world!.heroes;
  assert.deepEqual(
    [ada, bo].map((h) => [h!.lives, h!.pots, h!.hp]),
    [
      [1, 0, 9],
      [2, 1, 10],
    ],
  );
  assert.ok(bot!.lives === 3 && bot!.pots >= 2 && bot!.hp >= 11);
  kept(room);
  room.world = cleared(fought(room.world!, 100));
  fold(room);
  // The Drowned Crypt cleared: camp once more, then Vorhal's Keep, the last stage.
  run(room, CLEAR_TICKS);
  breakCamp(room);
  assert.deepEqual([room.stage, room.round, room.world!.stage], ["running", 4, 4]); // prettier-ignore
  room.world = cleared(fought(room.world!, 1000));
  fold(room);
  assert.equal(LAST_STAGE, 4);
  assert.deepEqual(
    [room.stage, room.round, view(room).countdown, room.world!.stage],
    ["between", LAST_STAGE, CLEAR_TICKS, 4],
  );
  assert.deepEqual(
    view(room).tally.map((row) => [row.stage.damage, row.run]),
    [
      [1000, { damage: 1111, knockdowns: 0 }],
      [2000, { damage: 2222, knockdowns: 4 }],
      [3000, { damage: 3333, knockdowns: 8 }],
    ],
  );
  kept(room);
  run(room, CLEAR_TICKS);
  assert.deepEqual(
    [room.stage, room.outcome, room.until, room.round],
    ["over", "victory", 0, LAST_STAGE],
  );
  assert.equal(view(room).countdown, 0);
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

test("a seat that leaves between stages is dropped: its hero stays behind, and the tally and the win stand", () => {
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
  // Camp, then stage 2, set out with the heroes whose seats are still here; the one that left keeps its row.
  assert.deepEqual(
    room.world!.heroes.map((hero) => hero.seat),
    [0, 2],
  );
  kept(room);
  breakCamp(room);
  assert.deepEqual(
    [room.stage, room.round, room.world!.heroes.map((hero) => hero.seat)],
    ["running", 2, [0, 2]],
  );
  assert.deepEqual(
    view(room).tally.map((row) => [row.seat, row.stage.damage, row.run.damage]),
    [
      [0, 0, 7],
      [1, 0, 7],
      [2, 0, 7],
    ],
  );
  kept(room);
  room.world = cleared(room.world!);
  fold(room);
  kept(room);
  run(room, CLEAR_TICKS);
  breakCamp(room);
  assert.deepEqual(
    [room.round, room.world!.stage, room.world!.heroes.map((h) => h.seat)],
    [3, 3, [0, 2]],
  );
  room.world = cleared(room.world!);
  fold(room);
  run(room, CLEAR_TICKS);
  breakCamp(room);
  assert.deepEqual([room.round, room.world!.stage], [4, 4]);
  room.world = cleared(room.world!);
  fold(room);
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

test("only a seat still playing its hero goes on: not a newcomer in a freed slot or a removed bot, and with nobody left the room is an empty lobby", () => {
  const room = started();
  room.world = cleared(room.world!);
  fold(room);
  // Bo leaves and Cy takes the slot with another hero, the bot is taken off, and Ada steps away (her seat is kept).
  fold(room, {
    a: [
      [LEAVE, "b"],
      [BOT, "remove", "bot:1"],
    ],
  });
  fold(room, {
    a: [
      [JOIN, "c", "Cy", 1, "gorm", 1],
      [PRESENCE, "a", false, 1],
    ],
  });
  kept(room);
  run(room, CLEAR_TICKS);
  breakCamp(room);
  assert.deepEqual(
    [room.stage, room.world!.heroes.map((hero) => [hero.seat, hero.kind])],
    ["running", [[0, "rhea"]]],
  );
  assert.equal(room.tally.length, 3);
  kept(room);
  // Nobody of the run is left in camp: the room is an empty lobby again.
  const empty = started();
  empty.world = cleared(empty.world!);
  fold(empty);
  fold(empty, {
    a: [
      [LEAVE, "a"],
      [LEAVE, "b"],
      [BOT, "remove", "bot:1"],
    ],
  });
  run(empty, CLEAR_TICKS);
  assert.deepEqual(
    [empty.stage, empty.round, empty.world, empty.tally],
    ["lobby", 0, null, []],
  );
  kept(empty);
});

test("a hero belongs to its slot: a newcomer or a bot in the freed slot playing the same hero carries it on, tallies and all", () => {
  const room = started();
  room.world = cleared({
    ...room.world!,
    heroes: room.world!.heroes.map((hero) => ({
      ...hero,
      damage: 7,
      lives: hero.seat === 1 ? 2 : hero.lives,
      pots: hero.seat === 1 ? 4 : hero.pots,
    })),
  });
  fold(room);
  // Bo leaves, and Cy takes Brakka's slot with Brakka; the bot's slot is taken by another bot (Ironhide's own hero).
  fold(room, {
    a: [
      [LEAVE, "b"],
      [JOIN, "c", "Cy", 1, "brakka", 1],
      [BOT, "remove", "bot:1"],
      [BOT, "add", "bot:2", "Flint", 2],
    ],
  });
  kept(room);
  run(room, CLEAR_TICKS);
  // Camp sets out with them (and the new bot may kick its imps for pots on the way to stage 2).
  assert.deepEqual(
    room.world!.heroes.map((hero) => [hero.seat, hero.kind, hero.lives, hero.pots]),
    [
      [0, "rhea", LIVES, 0],
      [1, "brakka", 2, 4],
      [2, "gorm", LIVES, 0],
    ],
  ); // prettier-ignore
  breakCamp(room);
  assert.deepEqual(
    room.world!.heroes.map((hero) => [hero.seat, hero.kind, hero.lives]),
    [
      [0, "rhea", LIVES],
      [1, "brakka", 2],
      [2, "gorm", LIVES],
    ],
  );
  assert.deepEqual(
    view(room).tally.map((row) => [row.seat, row.run.damage]),
    [
      [0, 7],
      [1, 7],
      [2, 7],
    ],
  );
  kept(room);
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
  const won = second();
  for (const camps of [true, true, false]) {
    won.world = cleared(won.world!);
    fold(won);
    run(won, CLEAR_TICKS);
    if (camps) breakCamp(won);
  }
  const later = second(),
    ended = second();
  ended.world = cleared({
    ...ended.world!,
    heroes: ended.world!.heroes.map((hero) => ({ ...hero, damage: 5 })),
  });
  fold(ended);
  const playing = started(),
    lobby = createRoom("m0", DEFAULT_SETTINGS),
    camp = started();
  camp.world = cleared(camp.world!);
  fold(camp);
  run(camp, CLEAR_TICKS + 40);
  fold(camp, { a: [[PLAY, "m1", 1, RIGHT]] });
  assert.deepEqual([camp.world!.camp, camp.held], [true, { a: RIGHT }]);
  const rooms: Record<string, Room> = {
    playing,
    between,
    camp,
    counting,
    lost,
    won,
    later,
    ended,
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
    [
      "a win short of the last stage",
      between,
      (f) => ([f[2], f[7], f[9]] = ["over", 0, "victory"]),
    ],
    ["a stage past the last", later, (f) => (f[1] = LAST_STAGE + 1)],
    ["a world of another stage", later, (f) => ((f[6] as unknown[])[16] = 1)],
    ["a later tally out of seat order", later, (f) => (f[10] as []).reverse()],
    ["a later tally missing a hero", later, (f) => (f[10] as []).pop()],
    ["a later tally for another hero", later, (f) => (row(f)[1] = "gorm")],
    ["a later stage banked short", ended, (f) => (row(f)[2] = 4)],
    ["held bits over a tally", between, (f) => (f[5] = [["a", RIGHT]])],
    ["a camp in play", camp, (f) => (f[2] = "running")],
    ["a camp once over", camp, (f) => ([f[2], f[9]] = ["over", "victory"])],
    ["a camp with a clock", camp, (f) => (f[7] = camp.tick + 5)],
    ["a camp with the continue spent", camp, (f) => (f[8] = true)],
    [
      "a camp after the last stage",
      camp,
      (f) => {
        const world = f[6] as unknown[];
        [f[1], world[16]] = [LAST_STAGE, LAST_STAGE];
        world[0] = seedOf(`m1:${LAST_STAGE}:camp`);
      },
    ],
    ["a camp seeded as a stage", camp, (f) => ((f[6] as number[])[0] = seedOf("m1:1"))],
    ["a stage seeded as a camp", playing, (f) => ((f[6] as number[])[0] = seedOf("m1:1:camp"))],
    ["a camp's world as a stage's", camp, (f) => ((f[6] as unknown[])[17] = false)],
    ["a tally's world as a camp's", between, (f) => ((f[6] as unknown[])[17] = true)],
    ["held bits for no hero", camp, (f) => (f[5] = [["w", RIGHT]])],
    ["held bits for a bot", camp, (f) => (f[5] = [["bot:1", RIGHT]])],
  ]; // prettier-ignore
  for (const [what, room, change] of cases)
    assert.equal(broken(room, change), undefined, what);
  // A loss with a hero still standing is no loss, and a run has a hero.
  const standing = { ...lost.world!, heroes: started().world!.heroes };
  assert.equal(
    decode(encode({ ...lost, world: standing }), lost.tick),
    undefined,
    "a loss with heroes standing",
  );
  const nobody = { ...later.world!, heroes: [] };
  assert.equal(
    decode(encode({ ...later, world: nobody }), later.tick),
    undefined,
  );
  // Every stage's world is seeded for its run and stage, and is of that stage.
  assert.deepEqual(
    [won.world!.seed, won.world!.stage, won.outcome],
    [seedOf("m1:4"), 4, "victory"],
  );
});
