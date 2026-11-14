import test from "node:test";
import assert from "node:assert/strict";
import type { Frame, FrameTiming } from "fuse-netcode";
import type { GameEvent, RoundView } from "../src/engine/index.js";
import { view, type Room, type View } from "../src/online/index.js";
import { ArenaDriver, EventQueue, QUEUE_LIMIT } from "../src/app/arena.js";
import type {
  ArenaOptions,
  ArenaView,
  EventFeed,
  TickEvents,
} from "../src/render/api.js";
import { fold, lobby, started, toPlay } from "./fixtures/room.js";

type Call =
  | { kind: "create"; options: ArenaOptions }
  | { kind: "advance"; step: number; feed: EventFeed }
  | { kind: "render"; from: number; to: number; alpha: number }
  | { kind: "update"; options: Partial<ArenaOptions> }
  | { kind: "resize" }
  | { kind: "destroy" };

/** The feed a frame carries when nothing was queued for it: its own events, nothing confirmed. */
const own = (frame: Frame<View>, confirmed = -1): EventFeed => ({
  ticks: [{ tick: frame.tick, events: frame.world?.events ?? [] }],
  confirmed,
});

/** A renderer that only writes down what it was asked. */
function fake(ready: Promise<void> = Promise.resolve()) {
  const calls: Call[] = [];
  const hosts: Host[] = [];
  const create = (host: Host, options: ArenaOptions): ArenaView => {
    hosts.push(host);
    calls.push({ kind: "create", options });
    const arena: ArenaView = {
      ready,
      render: (previous: RoundView, current: RoundView, alpha: number) =>
        void calls.push({
          kind: "render",
          from: previous.step,
          to: current.step,
          alpha,
        }),
      advance: (world: RoundView, feed: EventFeed) =>
        void calls.push({ kind: "advance", step: world.step, feed }),
      update: (options) => void calls.push({ kind: "update", options }),
      resize: () => void calls.push({ kind: "resize" }),
      destroy: () => void calls.push({ kind: "destroy" }),
    };
    return arena;
  };
  return { calls, hosts, create };
}
const frame = (room: Room): Frame<View> => ({ ...view(room), managerId: "a" });
/** Where the arena goes; the driver only hands it through. */
interface Host {
  id: string;
}
const HOST: Host = { id: "stage" };

function rig(ready?: Promise<void>) {
  const renderer = fake(ready);
  let timing: FrameTiming<View> | undefined;
  let confirmed = -1;
  const driver = new ArenaDriver({
    create: renderer.create,
    host: HOST,
    artUrl: "/killer-fuse/art/",
    timing: () => timing,
    confirmed: () => confirmed,
  });
  return {
    ...renderer,
    driver,
    time(next: FrameTiming<View> | undefined) {
      timing = next;
    },
    confirm(tick: number) {
      confirmed = tick;
    },
  };
}
const fed = (calls: Call[]): EventFeed[] =>
  calls.flatMap((call) => (call.kind === "advance" ? [call.feed] : []));

test("the arena opens with the first game, hears each frame once, and closes in the lobby", () => {
  const { calls, hosts, driver } = rig();
  const waiting = lobby();
  driver.update({
    names: ["Ada", "Bo"],
    localSlot: 0,
    muted: true,
    highlight: false,
  });
  driver.feed(frame(waiting), true);
  driver.draw();
  driver.resize();
  assert.equal(calls.length, 0, "no game, no arena");
  assert.equal(driver.open, false);

  const room = started();
  const first = frame(room);
  driver.feed(first, true);
  assert.equal(driver.open, true);
  assert.equal(hosts[0], HOST);
  assert.deepEqual(calls, [
    {
      kind: "create",
      options: {
        artUrl: "/killer-fuse/art/",
        names: ["Ada", "Bo"],
        localSlot: 0,
        muted: true,
        highlight: false,
      },
    },
    { kind: "advance", step: 0, feed: own(first) },
  ]);
  driver.feed(first, true);
  assert.equal(calls.length, 2, "the same frame is not fed twice");
  toPlay(room);
  fold(room);
  const second = frame(room);
  driver.feed(second, true);
  assert.deepEqual(calls.at(-1), {
    kind: "advance",
    step: 3,
    feed: own(second),
  });
  // A rollback hands over a new frame for the same tick: the renderer dedupes its effects itself.
  driver.feed(frame(room), true);
  assert.deepEqual(calls.at(-1), {
    kind: "advance",
    step: 3,
    feed: own(second),
  });
  assert.equal(calls.length, 4);
  driver.resize();
  assert.deepEqual(calls.at(-1), { kind: "resize" });

  driver.feed(frame(waiting), true);
  assert.deepEqual(calls.at(-1), { kind: "destroy" });
  assert.equal(driver.open, false);
  driver.close();
  assert.equal(calls.filter((call) => call.kind === "destroy").length, 1);
  driver.feed(second, true);
  assert.deepEqual(
    calls.slice(-2).map((call) => call.kind),
    ["create", "advance"],
    "the next set gets a fresh arena, and its frame is fed again",
  );
});

test("events the runtime delivers between frames reach the arena with the frame that carries their tick", () => {
  const { calls, driver, confirm } = rig();
  const room = started();
  toPlay(room);
  fold(room);
  const first = frame(room);
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const pickup: GameEvent = { type: "berryPickup", slot: 2, pile: 0 };
  const regrow: GameEvent = { type: "berryRegrow" };
  // Three ticks folded at once: the runtime says each tick's events, then publishes the newest frame.
  driver.event(kill, first.matchId, first.round, first.tick + 3);
  driver.event(pickup, first.matchId, first.round, first.tick + 3);
  driver.event(regrow, first.matchId, first.round, first.tick + 6);
  fold(room);
  fold(room);
  fold(room);
  const fourth = frame(room);
  assert.equal(fourth.tick, first.tick + 9);
  // What the fold says of the newest tick is the frame's own list, not the queue's.
  driver.event(kill, fourth.matchId, fourth.round, fourth.tick);
  confirm(first.tick + 3);
  driver.feed(fourth, true);
  assert.deepEqual(fed(calls), [
    {
      ticks: [
        { tick: first.tick + 3, events: [kill, pickup] },
        { tick: first.tick + 6, events: [regrow] },
        { tick: fourth.tick, events: fourth.world?.events ?? [] },
      ],
      confirmed: first.tick + 3,
    },
  ]);
  // A rollback re-runs the last ticks and adds what a late attack did; the new frame carries it, once.
  const late: GameEvent = { type: "attack", slot: 0 };
  driver.event(late, fourth.matchId, fourth.round, first.tick + 6);
  const replaced = frame(room);
  confirm(fourth.tick);
  driver.feed(replaced, true);
  assert.deepEqual(fed(calls).at(-1), {
    ticks: [
      { tick: first.tick + 6, events: [late] },
      { tick: fourth.tick, events: fourth.world?.events ?? [] },
    ],
    confirmed: fourth.tick,
  });
  fold(room);
  const fifth = frame(room);
  driver.feed(fifth, true);
  assert.deepEqual(fed(calls).at(-1), own(fifth, fourth.tick), "all taken");
});

test("the queue keeps only the game being shown, holds what no frame has reached, and is bounded", () => {
  const queue = new EventQueue();
  const room = started();
  toPlay(room);
  fold(room);
  const now = frame(room);
  const kill: GameEvent = { type: "kill", victim: 1, killer: 3 };
  const regrow: GameEvent = { type: "berryRegrow" };
  queue.add(kill, "m0", 1, now.tick - 3);
  queue.add(regrow, now.matchId, now.round, now.tick - 3);
  assert.equal(queue.size, 1, "another game's events are dropped");
  queue.add(kill, now.matchId, now.round, now.tick + 3);
  const ticks: TickEvents[] = queue.take(now, [kill]);
  assert.deepEqual(ticks, [
    { tick: now.tick - 3, events: [regrow] },
    { tick: now.tick, events: [kill] },
  ]);
  assert.equal(queue.size, 1, "a tick the frame has not reached waits");
  assert.deepEqual(queue.take({ ...now, round: 2 }, []), [
    { tick: now.tick, events: [] },
  ]);
  assert.equal(queue.size, 0, "the next game starts clean");
  for (let tick = 0; tick < QUEUE_LIMIT + 5; tick += 1)
    queue.add(regrow, now.matchId, now.round, tick * 3);
  assert.equal(queue.size, QUEUE_LIMIT, "the oldest are dropped");
  queue.clear();
  assert.equal(queue.size, 0);
});

test("closing the arena forgets the events queued for it", () => {
  const { calls, driver } = rig();
  const room = started();
  toPlay(room);
  fold(room);
  const first = frame(room);
  driver.feed(first, true);
  driver.event({ type: "berryRegrow" }, first.matchId, first.round, first.tick);
  driver.close();
  fold(room);
  const next = frame(room);
  driver.feed(next, true);
  assert.deepEqual(fed(calls).at(-1), own(next));
});

test("a controller phone never opens the arena, and leaves it when the room turns shared", () => {
  const { calls, driver } = rig();
  const room = started();
  driver.feed(frame(room), false);
  assert.equal(calls.length, 0);
  driver.feed(frame(room), true);
  driver.feed(frame(room), false);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["create", "advance", "destroy"],
  );
});

test("the renderer hears of a change of names, seat or sound, and only of a change", () => {
  const { calls, driver } = rig();
  driver.feed(frame(started()), true);
  assert.deepEqual(calls[0], {
    kind: "create",
    options: {
      artUrl: "/killer-fuse/art/",
      names: [],
      localSlot: -1,
      muted: false,
      highlight: false,
    },
  });
  const look = {
    names: ["Ada", ""],
    localSlot: 0,
    muted: false,
    highlight: false,
  };
  driver.update(look);
  driver.update({ ...look, names: [...look.names] });
  driver.update({ ...look, muted: true });
  driver.update({ ...look, muted: true, highlight: true });
  assert.deepEqual(calls.slice(2), [
    { kind: "update", options: look },
    { kind: "update", options: { ...look, muted: true } },
    {
      kind: "update",
      options: { ...look, muted: true, highlight: true },
    },
  ]);
});

test("a display frame blends the two newest frames of one game at the presentation tick", () => {
  const { calls, driver, time } = rig();
  const room = started();
  toPlay(room);
  fold(room);
  const older = frame(room);
  fold(room);
  const newer = frame(room);
  driver.draw();
  assert.equal(calls.length, 0, "nothing to draw on before the arena is open");
  driver.feed(newer, true);
  calls.length = 0;
  driver.draw();
  assert.equal(calls.length, 0, "no frame timing yet");

  const renders = () => calls.filter((call) => call.kind === "render");
  time({ newer, tick: newer.tick, lead: 0 });
  driver.draw();
  assert.deepEqual(renders().at(-1), {
    kind: "render",
    from: 6,
    to: 6,
    alpha: 1,
  });
  time({ older, newer, tick: older.tick + 1.5, lead: 0 });
  driver.draw();
  assert.deepEqual(renders().at(-1), {
    kind: "render",
    from: 3,
    to: 6,
    alpha: 0.5,
  });
  time({ older, newer, tick: newer.tick + 4, lead: 0 });
  driver.draw();
  assert.equal(renders().at(-1)?.alpha, 1, "never past the newest frame");
  time({ older, newer, tick: older.tick - 4, lead: 0 });
  driver.draw();
  assert.equal(renders().at(-1)?.alpha, 0);

  // Frames of different games, or out of order, are not blended.
  time({ older: { ...older, round: 9 }, newer, tick: newer.tick, lead: 0 });
  driver.draw();
  assert.deepEqual(renders().at(-1), {
    kind: "render",
    from: 6,
    to: 6,
    alpha: 1,
  });
  time({
    older: { ...older, matchId: "m9" },
    newer,
    tick: newer.tick,
    lead: 0,
  });
  driver.draw();
  assert.equal(renders().at(-1)?.from, 6);
  time({ older: newer, newer, tick: newer.tick, lead: 0 });
  driver.draw();
  assert.equal(renders().at(-1)?.from, 6);
  time({ older: { ...older, world: null }, newer, tick: newer.tick, lead: 0 });
  driver.draw();
  assert.equal(renders().at(-1)?.from, 6);
  const count = renders().length;
  time({ newer: { ...newer, world: null }, tick: newer.tick, lead: 0 });
  driver.draw();
  assert.equal(renders().length, count, "the lobby's frame has no world");
});

test("art that fails to load leaves the page standing", async () => {
  const failed = Promise.reject(new Error("404"));
  const { driver, calls } = rig(failed);
  driver.feed(frame(started()), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0]?.kind, "create");
  assert.equal(driver.open, true);
});
