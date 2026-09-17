// From the third adversarial review of the P2P pull request (#180): a returning page must replay its previous generation's
// entries that the peer's snapshot predates, or it reconstructs a different world from everyone else.
import test from "node:test";
import assert from "node:assert/strict";
import { World, type Frame } from "../src/online/rollback.js";
import { createRoomState, RULES } from "../src/shared/apply-tick.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { JOIN, ACTION, STEER, PRESENCE } from "../src/shared/input-log.js";
import { encodeSnapshot } from "../src/online/snapshot.js";
import { roomHash } from "../src/online/packet.js";
import {
  RoomRuntime,
  type TransportEvents,
  type RoomTransport,
} from "../src/online/room-runtime.js";

test("returning runtime replays its own retired stream from the peer snapshot", () => {
  const settings = defaultRoomSettings();
  const source = new World(
    createRoomState("m", settings),
    "creator",
    "creator",
  );
  for (const id of ["creator", "guest", "other"]) source.stream(id, 1);
  const creator = source.streams.get("creator")!;
  ["creator", "guest", "other"].forEach((id, slot) =>
    creator.append(1, [JOIN, id, id, slot, "fox", 1]),
  );
  creator.append(2, [ACTION, "start", "m"]);
  source.streams.get("guest")!.append(68, [STEER, 1]);
  for (const [id, through] of [
    ["creator", 100],
    ["guest", 100],
    ["other", 64],
  ] as const)
    source.receive(id, [], source.streams.get(id)!.lastSeq, through, through);
  source.advance(70);
  source.stream("guest", 2, { seq: 0, tick: 70 });
  source.receive("guest", [], 0, 100, 100);
  creator.append(72, [PRESENCE, "guest", true, 2]);
  source.advance(74);
  assert.equal(source.servable().tick, 64);
  let events!: TransportEvents,
    tickLoop!: () => void,
    now = 0,
    frame: Frame | undefined;
  const sent: unknown[] = [];
  const runtime = new RoomRuntime(
    "AB42",
    settings,
    {
      state: (f) => {
        frame = f;
      },
      event: () => {},
      status: () => {},
      ready: () => {},
    },
    {
      dependencies: {
        now: () => now,
        hidden: () => false,
        token: () => "token",
        generation: () => 2,
        schedule: (cb) => {
          tickLoop = cb;
          return () => {};
        },
        onVisibilityChange: () => () => {},
      },
      transport: (e) => {
        events = e;
        const transport: RoomTransport = {
          id: "guest",
          hostId: "creator",
          sentBytes: 0,
          connect: () => {},
          close: () => {},
          send: (_id, data) => {
            sent.push(data);
            return true;
          },
          sendFast: () => true,
          linked: () => true,
          explain: () => "fake",
          stats: async () => ({ direct: 2, relayed: 0, buffered: 0 }),
        };
        return transport;
      },
    },
  );
  runtime.start();
  events.welcome("guest", "creator");
  for (const id of ["creator", "other"]) {
    events.peer(id, true);
    events.message(id, {
      type: "hello",
      generation: 1,
      full: true,
      rules: RULES,
      world: true,
    });
  }
  events.link("creator", true);
  assert.ok(
    sent.some((v) => (v as { type?: string }).type === "snapshotRequest"),
  );
  for (const chunk of encodeSnapshot(source, roomHash("AB42:creator")))
    events.message("creator", chunk);
  assert.equal(runtime.tick, 64);
  for (let i = 0; i < 10; i++) {
    now += 50;
    tickLoop();
  }
  assert.equal(runtime.tick, 74);
  const expected = source.view()[0].players.find((p) => p.id === "guest");
  const actual = frame!.players.find((p) => p.id === "guest");
  assert.equal(
    actual!.angle,
    expected!.angle,
    "runtime must replay its own retired steering before the generation transition",
  );
  runtime.stop();
});
