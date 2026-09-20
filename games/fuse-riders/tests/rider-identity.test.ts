import test from "node:test";
import assert from "node:assert/strict";
import { applyTick, createRoomState } from "../src/engine/apply-tick.js";
import { BotController } from "../src/engine/bot-controller.js";
import {
  AVATAR,
  BOT,
  COLOR,
  JOIN,
  LEAVE,
  isEntry,
  type Entry,
} from "../src/engine/input-log.js";
import { RIDER_COLORS } from "../src/engine/tuning.js";
import {
  decodeGameState,
  encodeGameState,
} from "../src/engine/codec/checkpoint.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { fuseGame } from "../src/online/fuse-game.js";

/**
 * A rider's colour and head are its own and unique in the room (rules `fuse-p2p-48`). These cover the fold that keeps
 * them so: who gets what at a join, what a later choice does when someone already holds it, and how a restored room is
 * refused when it breaks the rule.
 */
function fixture() {
  const state = createRoomState("colour-room", classicSettings());
  const bots = new BotController();
  const tick = (streams: Record<string, Entry[]> = {}, generation = 0) =>
    applyTick(
      state,
      "host",
      new Map(
        Object.entries(streams).map(([id, entries]) => [
          id,
          {
            generation,
            entries: entries.map(
              (entry) => [entry[0], state.tick + 1, ...entry.slice(2)] as Entry,
            ),
          },
        ]),
      ),
      bots,
    );
  const join = (
    seq: number,
    id: string,
    name: string,
    slot: number,
    avatarId = "robot",
  ): Entry => [seq, 1, JOIN, id, name, slot, avatarId as never, 0];
  const colorOf = (id: string) => state.game.players.get(id)?.color;
  const headOf = (id: string) => state.game.players.get(id)?.avatarId;
  return { state, tick, join, colorOf, headOf };
}

test("a COLOR entry carries a palette index and nothing else", () => {
  assert.ok(isEntry([1, 1, COLOR, 0]));
  assert.ok(isEntry([1, 1, COLOR, RIDER_COLORS.length - 1]));
  // One past the palette, a negative, a non-integer and the wrong arity are all refused at the wire.
  assert.equal(isEntry([1, 1, COLOR, RIDER_COLORS.length]), false);
  assert.equal(isEntry([1, 1, COLOR, -1]), false);
  assert.equal(isEntry([1, 1, COLOR, 1.5]), false);
  assert.equal(isEntry([1, 1, COLOR]), false);
  assert.equal(isEntry([1, 1, COLOR, 0, 0]), false);
});

test("the palette keeps the five seat colours first, so an ordinary room looks unchanged", () => {
  const { tick, join, colorOf } = fixture();
  assert.equal(RIDER_COLORS.length, 10);
  assert.equal(new Set(RIDER_COLORS).size, 10);
  tick({
    host: [
      join(1, "a", "Ada", 0),
      join(2, "b", "Bo", 1),
      join(3, "c", "Cy", 2),
      join(4, "d", "Di", 3),
      join(5, "e", "Ed", 4),
    ],
  });
  // Seats are claimed lowest-first and each join takes the lowest free colour, so the room wears exactly what the old
  // seat palette gave it, in the same order.
  assert.deepEqual(
    ["a", "b", "c", "d", "e"].map(colorOf),
    RIDER_COLORS.slice(0, 5),
  );
});

test("a rider takes a free colour and is refused one another rider wears", () => {
  const { tick, join, colorOf } = fixture();
  tick({ host: [join(1, "a", "Ada", 0), join(2, "b", "Bo", 1)] });
  // A free colour is taken.
  tick({ a: [[2, 0, COLOR, 7]] });
  assert.equal(colorOf("a"), RIDER_COLORS[7]);
  // The colour Ada just left is free again, so Bo may have it.
  tick({ b: [[2, 0, COLOR, 0]] });
  assert.equal(colorOf("b"), RIDER_COLORS[0]);
  // Ada asking for the colour Bo now wears is a no-op: Ada keeps what it had, and Bo is untouched.
  tick({ a: [[3, 0, COLOR, 0]] });
  assert.deepEqual(
    [colorOf("a"), colorOf("b")],
    [RIDER_COLORS[7], RIDER_COLORS[0]],
  );
});

test("two riders reaching for one colour in a tick resolve by seat, the same way everywhere", () => {
  const { tick, join, colorOf } = fixture();
  tick({ host: [join(1, "a", "Ada", 0), join(2, "b", "Bo", 1)] });
  // Both ask for amber in the same tick. Player entries fold in seat order, so seat 0 takes it and seat 1 keeps its
  // own colour — and every replica folds the same log in the same order, so they all agree.
  tick({
    a: [[2, 0, COLOR, 5]],
    b: [[2, 0, COLOR, 5]],
  });
  assert.equal(colorOf("a"), RIDER_COLORS[5]);
  assert.equal(colorOf("b"), RIDER_COLORS[1]);
});

test("a colour is freed when its rider leaves, and the next joiner may take it", () => {
  const { state, tick, join, colorOf } = fixture();
  tick({ host: [join(1, "a", "Ada", 0), join(2, "b", "Bo", 1)] });
  tick({ a: [[2, 0, COLOR, 9]] });
  assert.equal(colorOf("a"), RIDER_COLORS[9]);
  tick({ host: [[3, 0, LEAVE, "a"]] });
  assert.equal(state.game.players.has("a"), false);
  tick({ b: [[3, 0, COLOR, 9]] });
  assert.equal(colorOf("b"), RIDER_COLORS[9]);
});

test("a join repairs a head another rider already wears, and keeps a free one", () => {
  const { tick, join, headOf } = fixture();
  tick({
    host: [
      join(1, "a", "Ada", 0, "fox"),
      // Bo asks for the fox Ada wears and is seated in the next free head a rider may have. That is the `cat` rather
      // than the `robot` in front of it: the robot is the AI's, and handing it to whoever joined first is what put a
      // person and an AI in the same head (rules `fuse-p2p-51`).
      join(2, "b", "Bo", 1, "fox"),
      join(3, "c", "Cy", 2, "owl"),
    ],
  });
  assert.equal(headOf("a"), "fox");
  assert.equal(headOf("b"), "cat");
  assert.equal(headOf("c"), "owl");
  assert.equal(new Set(["a", "b", "c"].map(headOf)).size, 3);
});

test("the robot is never given to a rider, and never taken by one", () => {
  const { tick, join, headOf } = fixture();
  // Asking for it outright: refused, and the rider is seated in the first head it may have instead.
  tick({ host: [join(1, "a", "Ada", 0, "robot")] });
  assert.equal(headOf("a"), "cat");
  // Reaching for it once seated: refused too, even with no AI in the room to be confused with yet.
  tick({ a: [[2, 0, AVATAR, "robot"]] });
  assert.equal(headOf("a"), "cat");
  // The rest of the grid still applies, so this is the one head withheld rather than the feature blocked.
  tick({ a: [[3, 0, AVATAR, "mushroom"]] });
  assert.equal(headOf("a"), "mushroom");
  // Filling every seat never reaches it either: five riders take five of the ten a rider may wear.
  const { tick: t2, join: j2, headOf: h2 } = fixture();
  t2({
    host: [0, 1, 2, 3, 4].map((slot) =>
      j2(slot + 1, `p${slot}`, `P${slot}`, slot, "fox"),
    ),
  });
  const heads = [0, 1, 2, 3, 4].map((slot) => h2(`p${slot}`));
  assert.equal(new Set(heads).size, 5, "five riders, five heads");
  assert.equal(heads.includes("robot"), false, "and none of them the AI's");
});

test("an AVATAR entry for a head another rider wears is a no-op", () => {
  const { tick, join, headOf } = fixture();
  tick({ host: [join(1, "a", "Ada", 0, "fox"), join(2, "b", "Bo", 1, "owl")] });
  tick({ b: [[2, 0, AVATAR, "fox"]] });
  assert.equal(headOf("b"), "owl");
  // A free head still applies, so the rule blocks clashes rather than the feature.
  tick({ b: [[3, 0, AVATAR, "dragon"]] });
  assert.equal(headOf("b"), "dragon");
});

test("an AI rider takes a free colour, keeps its own head, and makes robot read as taken", () => {
  const { state, tick, join, colorOf, headOf } = fixture();
  tick({ host: [join(1, "a", "Ada", 0, "fox")] });
  tick({
    host: [
      [2, 0, BOT, "add", "bot:1", "Ada AI", 1],
      [3, 0, BOT, "add", "bot:2", "Turing AI", 2],
    ],
  });
  assert.equal(colorOf("bot:1"), RIDER_COLORS[1]);
  assert.equal(colorOf("bot:2"), RIDER_COLORS[2]);
  // Several AI riders share the head they are drawn with; they are exempt from the rule among themselves.
  assert.deepEqual([headOf("bot:1"), headOf("bot:2")], ["robot", "robot"]);
  assert.equal(state.bots.size, 2);
  // A human may not take it while one sits.
  tick({ a: [[2, 0, AVATAR, "robot"]] });
  assert.equal(headOf("a"), "fox");
});

test("every seated rider wears a different colour, however the room filled up", () => {
  const { state, tick, join } = fixture();
  tick({
    host: [
      join(1, "a", "Ada", 0),
      join(2, "b", "Bo", 1),
      [3, 0, BOT, "add", "bot:1", "Ada AI", 2],
      join(4, "d", "Di", 3),
      [5, 0, BOT, "add", "bot:2", "Turing AI", 4],
    ],
  });
  tick({ a: [[2, 0, COLOR, 8]], d: [[2, 0, COLOR, 8]] });
  const colors = [...state.game.players.values()].map((p) => p.color);
  assert.equal(colors.length, 5);
  assert.equal(new Set(colors).size, 5);
});

test("a restored room seating two riders in one colour is refused", () => {
  const { state, tick, join } = fixture();
  tick({ host: [join(1, "a", "Ada", 0), join(2, "b", "Bo", 1)] });
  // A healthy room round-trips with the colours it folded.
  const restored = decodeGameState(encodeGameState(state.game));
  assert.equal(restored?.players.get("a")?.color, RIDER_COLORS[0]);
  assert.equal(restored?.players.get("b")?.color, RIDER_COLORS[1]);
  // A payload that puts both riders in one colour never folded from a log this build would produce, so the decoder
  // refuses it rather than restoring a room whose riders cannot be told apart.
  const bo = state.game.players.get("b")!;
  bo.color = RIDER_COLORS[0];
  assert.equal(decodeGameState(encodeGameState(state.game)), undefined);
  // So is a colour that is not in the palette at all.
  bo.color = "#123456";
  assert.equal(decodeGameState(encodeGameState(state.game)), undefined);
  // And the healthy room still decodes once it is put back, so the refusals above are the clash and nothing else.
  bo.color = RIDER_COLORS[1];
  assert.ok(decodeGameState(encodeGameState(state.game)));
});

test("a restored room in which two humans wear one head is refused", () => {
  const { state, tick, join } = fixture();
  tick({ host: [join(1, "a", "Ada", 0, "fox"), join(2, "b", "Bo", 1, "owl")] });
  const snapshot = () => fuseGame.checkpoint.encode(state);
  assert.ok(fuseGame.checkpoint.decode(snapshot(), state.tick));
  // Heads are checked where the room's bot list is in hand, because the rule exempts the AI riders.
  state.game.players.get("b")!.avatarId = "fox";
  assert.equal(fuseGame.checkpoint.decode(snapshot(), state.tick), undefined);
  // Two AI riders sharing `robot` is the exemption, not a clash, so that room still decodes.
  state.game.players.get("b")!.avatarId = "owl";
  tick({
    host: [
      [3, 0, BOT, "add", "bot:1", "Ada AI", 2],
      [4, 0, BOT, "add", "bot:2", "Turing AI", 3],
    ],
  });
  assert.equal(state.game.players.get("bot:1")?.avatarId, "robot");
  assert.equal(state.game.players.get("bot:2")?.avatarId, "robot");
  assert.ok(fuseGame.checkpoint.decode(snapshot(), state.tick));
});

test("a join for a rider the room already seats renames it, and moves nothing else", () => {
  const { state, tick, join, colorOf, headOf } = fixture();
  tick({ host: [join(1, "a", "Ada", 0, "fox"), join(2, "b", "Bo", 1, "owl")] });
  tick({ a: [[2, 0, COLOR, 6]] });
  const before = {
    slot: state.game.players.get("a")!.slot,
    color: colorOf("a"),
    head: headOf("a"),
  };
  // The same entry that used to be a plain reconnection now carries the name the rider means to wear.
  tick({ host: [[3, 0, JOIN, "a", "Ada Lovelace", 0, "fox", 0]] });
  const after = state.game.players.get("a")!;
  assert.equal(after.name, "Ada Lovelace");
  assert.deepEqual(
    { slot: after.slot, color: after.color, head: after.avatarId },
    before,
    "the seat, colour and head it already held are untouched",
  );
  // The leaderboard follows the name, so a rider that renames mid-match is named the same in the standings.
  assert.equal(state.game.leaderboard.get("a")?.name, "Ada Lovelace");
  // Names are not kept unique: two friends called Bo are two riders called Bo, told apart by colour and head.
  tick({ host: [[4, 0, JOIN, "a", "Bo", 0, "fox", 0]] });
  assert.equal(state.game.players.get("a")?.name, "Bo");
  assert.equal(state.game.players.get("b")?.name, "Bo");
  assert.notEqual(colorOf("a"), colorOf("b"));
  assert.notEqual(headOf("a"), headOf("b"));
});

test("a name that trims away leaves the rider named as it was", () => {
  const { state, tick, join } = fixture();
  tick({ host: [join(1, "a", "Ada", 0)] });
  // Defence rather than a live case: `loggedRiderName` refuses a whitespace-only name at `isEntry`, so this entry
  // cannot arrive over the wire. It pins that the fold leaves a rider named rather than blanking it, whatever reaches
  // the branch — a rename is the one place a name could be taken away.
  assert.equal(isEntry([1, 1, JOIN, "a", "   ", 0, "robot", 0]), false);
  tick({ host: [[2, 0, JOIN, "a", "   ", 0, "robot", 0]] });
  assert.equal(state.game.players.get("a")?.name, "Ada");
});
