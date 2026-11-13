import test from "node:test";
import assert from "node:assert/strict";
import type { Frame, FrameTiming } from "fuse-netcode";
import type { RoundView } from "../src/engine/index.js";
import { view, type Room, type View } from "../src/online/index.js";
import { ArenaDriver } from "../src/app/arena.js";
import type { ArenaOptions, ArenaView } from "../src/render/api.js";
import { fold, lobby, started, toPlay } from "./fixtures/room.js";

type Call =
  | { kind: "create"; options: ArenaOptions }
  | { kind: "advance"; step: number }
  | { kind: "render"; from: number; to: number; alpha: number }
  | { kind: "update"; options: Partial<ArenaOptions> }
  | { kind: "resize" }
  | { kind: "destroy" };

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
      advance: (world: RoundView) =>
        void calls.push({ kind: "advance", step: world.step }),
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
  const driver = new ArenaDriver({
    create: renderer.create,
    host: HOST,
    artUrl: "/killer-fuse/art/",
    timing: () => timing,
  });
  return {
    ...renderer,
    driver,
    time(next: FrameTiming<View> | undefined) {
      timing = next;
    },
  };
}

test("the arena opens with the first game, hears each frame once, and closes in the lobby", () => {
  const { calls, hosts, driver } = rig();
  const waiting = lobby();
  driver.update({ names: ["Ada", "Bo"], localSlot: 0, muted: true });
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
      },
    },
    { kind: "advance", step: 0 },
  ]);
  driver.feed(first, true);
  assert.equal(calls.length, 2, "the same frame is not fed twice");
  toPlay(room);
  fold(room);
  const second = frame(room);
  driver.feed(second, true);
  assert.deepEqual(calls.at(-1), { kind: "advance", step: 3 });
  // A rollback hands over a new frame for the same tick: the renderer dedupes its effects itself.
  driver.feed(frame(room), true);
  assert.deepEqual(calls.at(-1), { kind: "advance", step: 3 });
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
    },
  });
  const look = { names: ["Ada", ""], localSlot: 0, muted: false };
  driver.update(look);
  driver.update({ ...look, names: [...look.names] });
  driver.update({ ...look, muted: true });
  assert.deepEqual(calls.slice(2), [
    { kind: "update", options: look },
    { kind: "update", options: { ...look, muted: true } },
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
