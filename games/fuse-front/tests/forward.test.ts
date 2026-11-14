import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN } from "fuse-netcode";
import {
  STEPS_PER_TICK,
  TILE,
  viewOf,
  type Command,
  type WorldView,
} from "../src/engine/index.js";
import {
  COUNTDOWN_TICKS,
  DEFAULT_SETTINGS,
  MOVE,
  createRoom,
  foldTick,
  mapOf,
  type Entry,
  type FrontEvent,
  type Room,
} from "../src/online/game.js";
import {
  createForward,
  createSmoother,
  type Lead,
} from "../src/app/forward.js";

type Log = Map<string, unknown[][]>;
function log(room: Room, entries: Log, id: string, ...body: unknown[]): void {
  if (!entries.has(id)) entries.set(id, []);
  const stream = entries.get(id)!;
  stream.push([stream.length + 1, room.tick + 1, ...body]);
}
function fold(room: Room, entries: Log, ticks = 1): FrontEvent[] {
  const events: FrontEvent[] = [];
  for (let t = 0; t < ticks; t++)
    events.push(
      ...foldTick(
        room,
        "host",
        new Map(
          [...entries].map(([id, list]) => [
            id,
            { generation: 1, entries: list as Entry[] },
          ]),
        ),
      ),
    );
  return events;
}
/** The host in slot 0 against a bot, the match a few ticks past its countdown. */
function match() {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  const entries: Log = new Map();
  log(room, entries, "host", JOIN, "host", "Host", 0, "brick", 1);
  fold(room, entries);
  log(room, entries, "host", ACTION, "start", "match-1");
  fold(room, entries, 1 + COUNTDOWN_TICKS + 5);
  return { room, entries };
}
/** A view without its events: a tick's are its steps' together, a forward step's are its own. */
const still = (view: WorldView): WorldView => ({ ...view, events: [] });
const folded = (room: Room) => still(viewOf(mapOf(room), room.world!));
const hero = (view: WorldView, seat = 0) =>
  view.heroes.find((each) => each.seat === seat)!;

test("a whole tick played forward is the tick the fold produces, bots included, and the room's world is left alone", () => {
  const { room, entries } = match();
  const forward = createForward(),
    world = room.world!,
    before = JSON.stringify(world);
  const one = forward(room, 1, 0, [])!,
    two = forward(room, 2, 0, [])!;
  assert.equal(JSON.stringify(world), before);
  assert.equal(room.world, world);
  assert.equal(one.t, 1);
  fold(room, entries);
  assert.deepEqual(still(one.world), folded(room));
  fold(room, entries);
  assert.deepEqual(still(two.world), folded(room));
});

test("an order this device logged shows at once, and is what the fold then does with it", () => {
  const { room, entries } = match();
  const forward = createForward(),
    from = hero(viewOf(mapOf(room), room.world!));
  const tile = {
    x: Math.floor(from.x / TILE) + 3,
    y: Math.floor(from.y / TILE),
  };
  const order: Command = { seat: 0, type: "move", ...tile };
  const idle = forward(room, 0.5, 0, [])!,
    sent = forward(room, 0.5, 0, [order])!;
  assert.equal(hero(idle.world).x, from.x, "nothing ordered, nothing moves");
  assert.notEqual(hero(sent.world).x, from.x, "the hero is on its way");
  // Half a tick is one of its two steps; a quarter is half of that step, drawn between two worlds.
  const part = forward(room, 0.25, 0, [order])!;
  assert.equal(part.world, sent.world);
  assert.equal(part.before, forward(room, 0, 0, [order])!.world);
  assert.equal(part.t, 0.5);
  const whole = forward(room, 1, 0, [order])!;
  log(room, entries, "host", MOVE, "match-1", tile.x, tile.y);
  fold(room, entries);
  assert.deepEqual(still(whole.world), folded(room));
});

test("a frame takes only the steps no earlier frame took, and hands the renderer the same worlds", () => {
  const { room } = match();
  const forward = createForward();
  const first = forward(room, 0.9, 0, [])!,
    again = forward(room, 0.95, 0, [])!;
  assert.equal(again.world, first.world);
  assert.equal(again.before, first.before);
  assert.ok(again.t > first.t);
  // A rollback (a new revision) or a new order is another run.
  assert.notEqual(forward(room, 0.9, 1, [])!.world, first.world);
  assert.notEqual(
    forward(room, 0.9, 1, [{ seat: 0, type: "steer", dx: 1, dy: 0 }])!.world,
    forward(room, 0.9, 1, [])!.world,
  );
});

test("nothing is played before the countdown ends or outside a running match", () => {
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  const entries: Log = new Map();
  const forward = createForward();
  assert.equal(forward(room, 1, 0, []), undefined);
  log(room, entries, "host", JOIN, "host", "Host", 0, "brick", 1);
  fold(room, entries);
  log(room, entries, "host", ACTION, "start", "match-1");
  fold(room, entries, 3);
  assert.equal(room.stage, "running");
  assert.equal(forward(room, 1, 0, []), undefined);
});

test("what the room decides is shown when the room folds it, never on a guess", () => {
  const { room, entries } = match();
  const forward = createForward();
  // The bot's hero, a shot from falling, stands beside the host's.
  const world = room.world!,
    mine = world.heroes.find((each) => each.seat === 0)!;
  room.world = {
    ...world,
    heroes: world.heroes.map((each) =>
      each.seat === 1 ? { ...each, hp: 1, x: mine.x + TILE, y: mine.y } : each,
    ),
  };
  for (let tick = 0; tick < 200; tick++) {
    const lead = forward(room, 2, 0, [])!;
    const event = fold(room, entries).find(
      (each) => each.event.type === "heroDeath",
    );
    if (!event) continue;
    assert.ok(
      lead.world.step < event.step,
      `the fall of step ${event.step} was not drawn early`,
    );
    assert.ok(lead.world.step >= event.step - STEPS_PER_TICK * 2);
    assert.ok(hero(lead.world, 1).hp > 0);
    return;
  }
  assert.fail("no hero fell");
});

test("a rollback's correction to another hero is spread over a few frames; this device's own never is", () => {
  const { room } = match();
  const base = viewOf(mapOf(room), room.world!),
    smoother = createSmoother(3 * TILE);
  const at = (x: number, mine: number): Lead => ({
    world: {
      ...base,
      heroes: base.heroes.map((each) =>
        each.seat === 0 ? { ...each, x: mine } : { ...each, x },
      ),
    },
    before: undefined,
    t: 1,
  });
  const key = "match-1";
  const plain = at(1000, 500);
  assert.equal(
    smoother.apply(plain, key, 1, 0, 0, 1, new Map()),
    plain,
    "left as it is",
  );
  smoother.apply(at(1010, 500), key, 1, 16, 0, 1, new Map());
  const jumped = smoother.apply(at(1100, 560), key, 2, 32, 0, 1, new Map());
  assert.equal(hero(jumped.world, 0).x, 560, "the local hero is where it is");
  assert.equal(hero(jumped.world, 1).x, 1020, "the other carries on as drawn");
  let last = jumped;
  for (let ms = 48; ms < 600; ms += 16)
    last = smoother.apply(at(1100, 560), key, 2, ms, 0, 1, new Map());
  assert.equal(hero(last.world, 1).x, 1100, "and ends where the room has it");
  // A new fold in which the other hero was given another order is a wrong guess too, with no rollback.
  const told = (order: string) => new Map([[1, order]]);
  smoother.apply(at(1100, 560), key, 2, 600, 0, 2, told("east"));
  smoother.apply(at(1110, 560), key, 2, 616, 0, 2, told("east"));
  const turned = smoother.apply(at(1080, 560), key, 2, 632, 0, 4, told("west"));
  assert.equal(hero(turned.world, 1).x, 1120);
  for (let ms = 648; ms < 1200; ms += 16)
    last = smoother.apply(at(1080, 560), key, 2, ms, 0, 4, told("west"));
  assert.equal(hero(last.world, 1).x, 1080);
  // A jump across the map (a respawn, a BLINK) is shown as it is.
  const far = smoother.apply(
    at(1100 + 10 * TILE, 560),
    key,
    3,
    1216,
    0,
    4,
    told("west"),
  );
  assert.equal(hero(far.world, 1).x, 1100 + 10 * TILE);
});
