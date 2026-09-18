import test from "node:test";
import assert from "node:assert/strict";
import {
  SNAPSHOT_INTERVAL,
  SNAPSHOTS_RETAINED,
  STALL_TICKS,
  World,
} from "../src/online/rollback.js";
import {
  PACKET_ENTRIES,
  ROLLBACK_TICKS,
  StreamLog,
} from "../src/online/stream.js";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  PRESS,
  RELEASE,
  STEER,
  type Entry,
} from "../src/shared/input-log.js";
import { createRoomState, hashRoomState } from "../src/shared/apply-tick.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { COUNTDOWN_TICKS } from "../src/shared/game.js";

const settings = defaultRoomSettings();
const members = ["creator", "b", "c", "d", "e", "f"];
function world(self = "creator", humans = ["creator", "b"]): World {
  const w = new World(createRoomState("room", settings), "creator", self);
  for (const id of humans) w.stream(id, 1);
  const creator = w.streams.get("creator")!;
  // At most five riders: a sixth member is a display without a seat.
  humans
    .slice(0, 5)
    .forEach((id, index) =>
      creator.append(1, [JOIN, id, id.toUpperCase(), index, "fox", 1]),
    );
  creator.append(2, [ACTION, "start", "match-1"]);
  return w;
}
const playing = (w: World) => {
  for (const stream of w.streams.values()) stream.through = COUNTDOWN_TICKS + 2;
  w.advance(COUNTDOWN_TICKS + 2);
  assert.equal(w.state.game.phase, "playing");
};
const guest = (w: World) => w.state.game.players.get("b")!;

test("advance folds every stream, snapshots every fourth tick and emits each event once", () => {
  const w = world();
  playing(w);
  const b = w.streams.get("b")!;
  b.receive(
    [[1, w.tick + 1, PRESS, 1] as Entry],
    1,
    w.tick + 1,
    w.tick + 1,
    w.tick,
  );
  b.through = w.tick + 5;
  w.streams.get("creator")!.through = w.tick + 5;
  const first = w.advance(w.tick + 5);
  assert.equal(guest(w).bombChargeStartedTick, COUNTDOWN_TICKS + 3);
  assert.deepEqual(first.events, []);
  assert.equal(
    w.hashAt(Math.floor(w.tick / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL)!
      .length,
    16,
  );
  assert.equal(w.hashAt(w.tick + 1), undefined);
  b.receive(
    [[2, w.tick + 1, RELEASE, 1] as Entry],
    2,
    w.tick + 1,
    w.tick + 1,
    w.tick,
  );
  b.through = w.tick + 1;
  w.streams.get("creator")!.through = w.tick + 1;
  const fired = w.advance(w.tick + 1);
  assert.equal(fired.events.length, 1);
  assert.equal(fired.events[0]!.event.type, "bombPlaced");
  assert.equal(fired.events[0]!.tick, w.tick);
  assert.equal(w.view().length, 2);
  assert.equal(w.view()[0]!.tick, w.tick);
  assert.equal(w.view()[1]!.tick, w.tick - 1);
  assert.equal(w.view()[0]!.matchId, "room");
});

test("a late entry rolls back N ticks, re-simulates from the nearest snapshot and does not repeat emitted events", () => {
  const w = world();
  playing(w);
  const b = w.streams.get("b")!;
  b.through = w.tick + 30;
  w.streams.get("creator")!.through = w.tick + 30;
  w.advance(w.tick + 30);
  const straight = { x: guest(w).x, y: guest(w).y },
    tickBefore = w.tick;
  const late = w.receive(
    "b",
    [[1, w.tick - 10, STEER, 1]],
    1,
    b.through,
    w.tick,
  );
  assert.equal(late.status, "accepted");
  assert.equal(late.rollbackTo, tickBefore - 10);
  assert.ok(
    late.rollbackTicks >= 10 && late.rollbackTicks < 10 + SNAPSHOT_INTERVAL,
  );
  assert.equal(w.tick, tickBefore);
  assert.notDeepEqual({ x: guest(w).x, y: guest(w).y }, straight);
  assert.equal(w.rollbacks, 1);
  const reference = world();
  playing(reference);
  reference.streams
    .get("b")!
    .receive(
      [[1, tickBefore - 10, STEER, 1] as Entry],
      1,
      tickBefore,
      tickBefore,
      reference.tick,
    );
  reference.streams.get("b")!.through = tickBefore;
  reference.streams.get("creator")!.through = tickBefore;
  reference.advance(tickBefore);
  assert.equal(
    hashRoomState(w.state),
    hashRoomState(reference.state),
    "rollback converges on the straight-line fold",
  );
  assert.equal(
    w.receive(
      "b",
      [[2, w.tick - ROLLBACK_TICKS - 5, STEER, 0]],
      2,
      b.through,
      w.tick,
    ).status,
    "invalid",
    "ticks go backwards within a stream",
  );
  assert.equal(w.receive("zzz", [], 0, 0, w.tick).status, "invalid");
  const old = new World(
    createRoomState("room", settings),
    "creator",
    "creator",
  );
  old.stream("creator", 1);
  old.stream("b", 1);
  old.streams.get("creator")!.through = 300;
  old.streams.get("b")!.through = 300;
  old.advance(300);
  assert.equal(
    old.receive("b", [[1, 100, STEER, 1]], 1, 300, 300).status,
    "unrepairable",
  );
});

test("late reordered steering replays a close pass without false double elimination", () => {
  const fixture = world();
  playing(fixture);
  Object.assign(fixture.state.game.players.get("creator")!, {
    x: 500,
    y: 350,
    angle: 0,
    trail: [],
  });
  Object.assign(guest(fixture), { x: 514, y: 362, angle: 0, trail: [] });
  const start = fixture.tick,
    end = start + 3;
  const entries: Entry[] = [
    [1, start + 1, STEER, 1],
    [2, start + 2, STEER, 0],
  ];
  const replica = () => {
    // Seed through the public constructor so rollback snapshots include the close-pass fixture.
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end, end);
  reference.advance(end);
  const delayed = replica();
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  const repaired = delayed.receive("b", [entries[0]!], 2, end, end);
  assert.equal(repaired.status, "accepted");
  assert.ok(repaired.rollbackTicks > 0);
  assert.ok(
    [...delayed.state.game.players.values()].every((player) => player.alive),
  );
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  const duplicate = delayed.receive("b", entries, 2, end, end);
  assert.deepEqual(duplicate.events, []);
  assert.equal(duplicate.rollbackTicks, 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
});

test("all arrival orders of the same entries converge to one hash", () => {
  const entries: Entry[] = [
    [1, 70, STEER, 1],
    [2, 72, PRESS, 1],
    [3, 75, STEER, 2],
    [4, 80, RELEASE, 1],
    [5, 84, STEER, 0],
  ];
  const hashes = new Set<string>();
  const orders = [
    [0, 1, 2, 3, 4],
    [4, 3, 2, 1, 0],
    [2, 0, 4, 1, 3],
    [1, 3, 0, 4, 2],
    [3, 4, 0, 1, 2],
  ];
  for (const order of orders) {
    const w = world();
    playing(w);
    w.streams.get("creator")!.through = 100;
    w.streams.get("b")!.through = 100;
    for (const index of order) {
      w.advance(Math.min(100, w.tick + 7));
      assert.notEqual(
        w.receive("b", [entries[index]!], 5, 100, 100).status,
        "invalid",
      );
    }
    w.advance(100);
    hashes.add(hashRoomState(w.state));
  }
  const direct = world();
  playing(direct);
  direct.streams.get("b")!.receive(entries, 5, 100, 100, direct.tick);
  direct.streams.get("b")!.through = 100;
  direct.streams.get("creator")!.through = 100;
  direct.advance(100);
  hashes.add(hashRoomState(direct.state));
  assert.equal(hashes.size, 1);
});

test("the world stalls 40 ticks past a connected rider whose stream is incomplete, and resumes on presence(false), leave or completeness", () => {
  const w = world();
  playing(w);
  w.streams.get("creator")!.through = 500;
  const result = w.advance(500);
  assert.equal(w.tick, COUNTDOWN_TICKS + 2 + STALL_TICKS);
  assert.equal(result.waitingFor, "B");
  assert.deepEqual(w.stallBound(), {
    tick: COUNTDOWN_TICKS + 2 + STALL_TICKS,
    waitingFor: "B",
  });
  const b = w.streams.get("b")!;
  b.receive([[2, w.tick + 3, STEER, 1] as Entry], 2, 200, w.tick, w.tick);
  assert.equal(
    w.stallBound().tick,
    w.tick + 2 + STALL_TICKS,
    "a gap caps completeness before the first waiting entry",
  );
  b.receive([[1, w.tick + 1, STEER, 2] as Entry], 2, 200, w.tick, w.tick);
  assert.equal(w.advance(500).waitingFor, "B");
  assert.equal(w.tick, 200 + STALL_TICKS);
  const creator = w.streams.get("creator")!;
  creator.append(w.tick + 3, [PRESENCE, "b", false, 1]);
  assert.equal(w.advance(500).waitingFor, undefined);
  assert.equal(w.tick, 500);
  assert.equal(
    w.state.game.players.has("b"),
    false,
    "the round ended and pruned the disconnected rider",
  );
  creator.append(w.tick + 1, [JOIN, "b", "B", 1, "fox", 2]);
  w.stream("b", 2, { seq: 0, tick: w.tick });
  assert.equal(w.advance(600).waitingFor, "B");
  assert.equal(w.tick, 500 + STALL_TICKS);
  creator.append(w.tick + 1, [LEAVE, "b"]);
  assert.equal(w.advance(600).waitingFor, undefined);
  assert.equal(
    w.tick,
    600,
    "the stall is re-evaluated after every applied tick",
  );
  const solo = world("creator", ["creator"]);
  solo.streams.get("creator")!.append(3, [BOT, "add", "bot:1", "AI Ada", 1]);
  solo.streams.get("creator")!.through = 0;
  assert.deepEqual(solo.stallBound(), { tick: Infinity });
  solo.advance(200);
  assert.equal(
    solo.tick,
    200,
    "bots and the local member never stall the world",
  );
});

test("retention drops old snapshots, applied entries and event keys while a fresh install resets everything", () => {
  const w = world();
  playing(w);
  const b = w.streams.get("b")!;
  b.receive(
    [[1, w.tick + 1, STEER, 1] as Entry],
    1,
    w.tick + 200,
    w.tick,
    w.tick,
  );
  w.streams.get("creator")!.through = w.tick + 200;
  w.advance(w.tick + 200);
  assert.equal(
    w.oldestSnapshotTick,
    Math.floor(w.tick / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL -
      (SNAPSHOTS_RETAINED - 1) * SNAPSHOT_INTERVAL,
  );
  assert.equal(
    b.entries.size,
    0,
    "entries older than the oldest snapshot are pruned",
  );
  assert.equal(b.contiguous, 1);
  const state = createRoomState("fresh", settings);
  state.game.tick = 999;
  w.install(state);
  assert.equal(w.tick, 999);
  assert.equal(w.streams.size, 0);
  assert.equal(w.view().length, 1);
  assert.equal(w.hashAt(999)!.length, 16);
  assert.equal(w.stream("x", 4, { seq: 2, tick: 999 }).contiguous, 2);
  assert.equal(
    w.stream("x", 4).contiguous,
    2,
    "same generation keeps the stream",
  );
  assert.equal(w.stream("x", 5).contiguous, 0);
});

test("six replicas on a deterministic lossy, reordering network agree on every retained tick", () => {
  const seedRandom = (() => {
    let a = 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
  })();
  const replicas = new Map(members.map((id) => [id, world(id, members)]));
  const gestures = new Map(members.map((id) => [id, 0]));
  interface Delivery {
    at: number;
    to: string;
    from: string;
    entries: Entry[];
    lastSeq: number;
    through: number;
  }
  const queue: Delivery[] = [];
  const send = (from: string, to: string, entries: Entry[], now: number) => {
    if (seedRandom() < 0.05) return;
    queue.push({
      at: now + 1 + Math.floor(seedRandom() * 3),
      to,
      from,
      entries,
      lastSeq: replicas.get(from)!.streams.get(from)!.lastSeq,
      through: now,
    });
  };
  let unrepairable = 0,
    invalid = 0;
  for (let now = 1; now <= 400; now++) {
    for (const [id, w] of replicas) {
      const own = w.streams.get(id)!;
      if (now > COUNTDOWN_TICKS + 2 && seedRandom() < 0.2)
        own.append(now + 1, [STEER, Math.floor(seedRandom() * 4)]);
      if (now > COUNTDOWN_TICKS + 2 && seedRandom() < 0.05) {
        const gesture = gestures.get(id)! + 1;
        gestures.set(id, gesture);
        own.append(now + 1, [PRESS, gesture]);
        if (seedRandom() < 0.5) own.append(now + 2, [RELEASE, gesture]);
      }
      own.through = now;
      for (const to of members)
        if (to !== id) send(id, to, own.packetEntries(), now);
      for (const [from, stream] of w.streams) {
        const missing = stream.firstMissing();
        if (missing !== undefined && from !== id && seedRandom() < 0.5) {
          const owner = replicas.get(from)!.streams.get(from)!;
          queue.push({
            at: now + 2,
            to: id,
            from,
            entries: owner.repairEntries(missing),
            lastSeq: owner.lastSeq,
            through: owner.through,
          });
        }
      }
    }
    for (const delivery of queue
      .filter((item) => item.at <= now)
      .sort(() => seedRandom() - 0.5)) {
      queue.splice(queue.indexOf(delivery), 1);
      const result = replicas
        .get(delivery.to)!
        .receive(
          delivery.from,
          delivery.entries,
          delivery.lastSeq,
          delivery.through,
          now,
        );
      if (result.status === "unrepairable") unrepairable++;
      if (result.status === "invalid") invalid++;
      assert.ok(delivery.entries.length <= PACKET_ENTRIES);
    }
    for (const w of replicas.values()) w.advance(now);
    if (now % 40 === 0 && now > 100) {
      const at = Math.floor((now - 44) / SNAPSHOT_INTERVAL) * SNAPSHOT_INTERVAL;
      const hashes = new Set([...replicas.values()].map((w) => w.hashAt(at)));
      assert.equal(
        hashes.size,
        1,
        `tick ${at} diverged: ${[...hashes].join(", ")}`,
      );
      assert.ok(!hashes.has(undefined));
    }
  }
  assert.equal(unrepairable, 0);
  assert.equal(invalid, 0);
  for (const w of replicas.values())
    if (w.tick !== 400)
      console.log(
        "BEHIND",
        w.selfId,
        w.tick,
        w.state.game.phase,
        JSON.stringify(w.stallBound()),
        [...w.streams]
          .map(
            ([id, s]) =>
              `${id}:c${s.contiguous}/l${s.lastSeq}/t${s.through}/ct${s.completeThrough()}/gap${s.gap}`,
          )
          .join(" "),
      );
  assert.ok(
    [...replicas.values()].every(
      (w) => w.state.game.phase !== "lobby" && w.tick === 400,
    ),
  );
  assert.equal(
    [...replicas.values()].some((w) => w.rollbacks > 0),
    true,
    `late packets caused rollbacks: ${[...replicas.values()].map((w) => w.rollbacks).join(",")}`,
  );
  assert.equal(
    [...replicas.values()].every(
      (w) => w.streams.get("creator")!.through >= 397,
    ),
    true,
    "completeness follows the packets",
  );
  assert.equal(
    [...replicas.values()].every((w) => w.stallBound().tick < Infinity),
    true,
    "every replica bounds itself on the other riders",
  );
  assert.equal(new StreamLog(1).retained().length, 0);
});

import { COUNTDOWN_TICKS as COUNTDOWN } from "../src/shared/game.js";
import { PRESENCE as PRESENCE_KIND } from "../src/shared/input-log.js";
test("a rider's replaced stream keeps its history: a rollback across the replacement replays the old generation's inputs", () => {
  const build = (lateFirst: boolean) => {
    const w = new World(
      createRoomState("m", defaultRoomSettings()),
      "creator",
      "creator",
    );
    const creator = w.stream("creator", 1),
      guest = w.stream("guest", 1);
    w.stream("other", 1);
    creator.append(1, [JOIN, "creator", "Creator", 0, "fox", 1]);
    creator.append(1, [JOIN, "guest", "Guest", 1, "cat", 1]);
    creator.append(1, [JOIN, "other", "Other", 2, "robot", 1]);
    creator.append(2, [ACTION, "start", "m"]);
    const start = COUNTDOWN + 10;
    for (let tick = start; tick < start + 30; tick++)
      guest.append(tick, [STEER, tick % 2 ? 1 : 2]);
    if (lateFirst)
      w.receive(
        "other",
        [[1, start + 20, STEER, 1] as Entry],
        1,
        start + 20,
        start + 20,
      );
    for (const stream of w.streams.values()) stream.through = start + 60;
    w.advance(start + 30);
    const replaced = w.stream("guest", 2, { seq: 0, tick: start + 30 });
    creator.append(start + 31, [PRESENCE_KIND, "guest", true, 2]);
    replaced.through = start + 60;
    for (let tick = start + 32; tick < start + 40; tick++)
      replaced.append(tick, [STEER, 1]);
    w.advance(start + 40);
    if (!lateFirst) {
      const result = w.receive(
        "other",
        [[1, start + 20, STEER, 1] as Entry],
        1,
        start + 60,
        start + 40,
      );
      assert.ok(
        result.rollbackTicks > 0,
        "the late entry rolled the world back across the replacement",
      );
    }
    return w;
  };
  assert.equal(
    hashRoomState(build(false).state),
    hashRoomState(build(true).state),
    "replaying with the old generation's entries gives the same world as never having rolled back",
  );
});

test("Extra Bomb collection and volley converge after dropped, reordered and duplicated fire entries", () => {
  const fixture = world();
  playing(fixture);
  const rider = guest(fixture),
    start = fixture.tick,
    end = start + 12;
  fixture.state.game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  fixture.state.game.pickups = [
    {
      id: fixture.state.game.nextPickupId++,
      type: "extraBomb",
      x: rider.x,
      y: rider.y,
      expiresAtTick: end + 10,
    },
  ];
  const entries: Entry[] = [
    [1, start + 2, PRESS, 1],
    [2, start + 5, RELEASE, 1],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end, end);
  reference.advance(end);
  const delayed = replica();
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  const repaired = delayed.receive("b", [entries[0]!], 2, end, end);
  assert.ok(repaired.rollbackTicks > 0);
  assert.equal(guest(delayed).extraBombs, 1);
  assert.equal(delayed.state.game.bombs.size, 2);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.deepEqual(delayed.receive("b", entries, 2, end, end).events, []);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
});
test("Shorter Fuse collection and volley converge after dropped, reordered and duplicated fire entries", () => {
  const fixture = world();
  playing(fixture);
  const rider = guest(fixture),
    start = fixture.tick,
    end = start + 12;
  fixture.state.game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  fixture.state.game.pickups = [
    {
      id: fixture.state.game.nextPickupId++,
      type: "stopwatch",
      x: rider.x,
      y: rider.y,
      expiresAtTick: end + 10,
    },
  ];
  rider.extraBombs = 1;
  const entries: Entry[] = [
    [1, start + 2, PRESS, 1],
    [2, start + 5, RELEASE, 1],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end, end);
  reference.advance(end);
  const delayed = replica();
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  const repaired = delayed.receive("b", [entries[0]!], 2, end, end);
  assert.ok(repaired.rollbackTicks > 0);
  assert.equal(guest(delayed).fuseLevel, 1);
  assert.ok(
    [...delayed.state.game.bombs.values()].every(
      (bomb) => bomb.explodeAtTick - bomb.launchedTick === 30,
    ),
  );
  assert.equal(delayed.state.game.bombs.size, 2);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.deepEqual(delayed.receive("b", entries, 2, end, end).events, []);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
});

test("late reordered inputs converge through GRIP collection and do not consume a repeat drop", () => {
  const fixture = world();
  playing(fixture);
  Object.assign(fixture.state.game.players.get("creator")!, {
    x: 1100,
    y: 700,
    angle: 0,
    trail: [],
  });
  Object.assign(guest(fixture), { x: 500, y: 350, angle: 0, trail: [] });
  fixture.state.game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  fixture.state.game.pickups = [0, 1].map(() => ({
    id: fixture.state.game.nextPickupId++,
    type: "grip",
    x: 505,
    y: 350,
    expiresAtTick: fixture.tick + 100,
  }));
  const start = fixture.tick,
    end = start + 12;
  const entries: Entry[] = [
    [1, start + 1, STEER, 1],
    [2, start + 8, STEER, 0],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end, end);
  reference.advance(end);
  const delayed = replica();
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  const repair = delayed.receive("b", [entries[0]!], 2, end, end);
  assert.ok(repair.rollbackTicks > 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.equal(guest(delayed).grip, true);
  assert.equal(delayed.state.game.pickups.length, 1);
  assert.equal(delayed.state.game.matchStats.get("b")!.pickupsCollected, 1);
  const duplicate = delayed.receive("b", entries, 2, end, end);
  assert.deepEqual(duplicate.events, []);
  assert.equal(duplicate.rollbackTicks, 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
});

test("late reordered inputs converge through Range collection and do not consume a repeat drop", () => {
  const fixture = world();
  playing(fixture);
  Object.assign(fixture.state.game.players.get("creator")!, {
    x: 1100,
    y: 700,
    angle: 0,
    trail: [],
  });
  Object.assign(guest(fixture), { x: 500, y: 350, angle: 0, trail: [] });
  fixture.state.game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  fixture.state.game.pickups = [0, 1, 2, 3].map(() => ({
    id: fixture.state.game.nextPickupId++,
    type: "range",
    x: 505,
    y: 350,
    expiresAtTick: fixture.tick + 100,
  }));
  const start = fixture.tick,
    end = start + 12;
  const entries: Entry[] = [
    [1, start + 1, STEER, 1],
    [2, start + 8, STEER, 0],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end, end);
  reference.advance(end);
  const delayed = replica();
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  const repair = delayed.receive("b", [entries[0]!], 2, end, end);
  assert.ok(repair.rollbackTicks > 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.equal(guest(delayed).rangeLevel, 3);
  assert.equal(delayed.state.game.pickups.length, 1);
  assert.equal(delayed.state.game.matchStats.get("b")!.pickupsCollected, 3);
  const duplicate = delayed.receive("b", entries, 2, end, end);
  assert.deepEqual(duplicate.events, []);
  assert.equal(duplicate.rollbackTicks, 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
});

test("late duplicated and reordered Target releases converge through debris decay and peer recovery", async () => {
  const { eliminatePlayer } = await import("../src/shared/game.js");
  const { encodeSnapshot, decodeSnapshot, SnapshotAssembler } =
    await import("../src/online/snapshot.js");
  const fixture = world("creator", ["creator", "b", "c"]);
  playing(fixture);
  const start = fixture.tick,
    end = start + 35,
    game = fixture.state.game;
  for (const p of game.players.values()) {
    p.trail = [];
    p.invulnerableUntilTick = end + 100;
  }
  const victim = game.players.get("c")!;
  victim.trail = Array.from({ length: 40 }, (_, i) => ({
    x1: 200 + i * 15,
    y1: 200,
    x2: 215 + i * 15,
    y2: 200,
    createdTick: start - 40 + i,
    expiresAtTick: start + 1,
  }));
  eliminatePlayer(game, "c");
  game.players.get("b")!.targetBombArmed = true;
  const entries: Entry[] = [
    [1, start + 1, PRESS, 1],
    [
      2,
      start + 2,
      RELEASE,
      1,
      Math.round((500 / game.width) * 65535),
      Math.round((200 / game.height) * 65535),
    ],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    for (const id of ["creator", "b", "c"])
      w.stream(id, 1).through = id === "b" ? start : end;
    return w;
  };
  const recover = (source: World) => {
    const assembler = new SnapshotAssembler(42);
    let decoded: ReturnType<typeof decodeSnapshot>;
    for (const chunk of encodeSnapshot(source, 42)) {
      const complete = assembler.accept(chunk);
      if (complete) decoded = decodeSnapshot(complete.bytes, 42);
    }
    assert.ok(decoded);
    assert.equal(hashRoomState(decoded.state), hashRoomState(source.state));
    const joiner = new World(decoded.state, "creator", "creator");
    for (const s of decoded.streams)
      joiner.stream(s.id, s.generation, {
        seq: s.seq,
        tick: joiner.tick,
        gesture: s.gesture,
      });
    return joiner;
  };
  const reference = replica(),
    beforeDecay = recover(reference),
    delayed = replica();
  for (const w of [reference, beforeDecay]) {
    w.receive("b", entries, 2, end, end);
    for (const s of w.streams.values()) s.through = end;
    w.advance(end);
  }
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  assert.ok(delayed.receive("b", [entries[0]!], 2, end, end).rollbackTicks > 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.equal(
    hashRoomState(beforeDecay.state),
    hashRoomState(reference.state),
  );
  const pieces = delayed.state.game.players.get("c")!.trail;
  assert.ok(pieces.length > 0 && pieces.length < 40);
  assert.equal(new Set(pieces.map((s) => s.detached?.id)).size, 2);
  assert.ok(pieces.every((s) => s.detached?.decayStartTick === start + 60));
  assert.equal(delayed.receive("b", entries, 2, end, end).rollbackTicks, 0);
  const recovered = recover(delayed);
  for (const w of [reference, delayed, recovered]) {
    for (const s of w.streams.values()) s.through = end + 30;
    w.advance(end + 30);
  }
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.equal(hashRoomState(recovered.state), hashRoomState(reference.state));
});

test("repair across the final elimination replaces speculative points and duplicate inputs cannot score twice", () => {
  const fixture = world();
  playing(fixture);
  fixture.state.game.round = 5;
  Object.assign(guest(fixture), {
    x: 34.45,
    y: 350,
    angle: Math.PI,
    trail: [],
  });
  Object.assign(fixture.state.game.players.get("creator")!, {
    x: 900,
    y: 600,
    angle: 0,
    trail: [],
  });
  const start = fixture.tick,
    end = start + 1;
  const entries: Entry[] = [
    [1, end, STEER, 1],
    [2, end + 1, STEER, 0],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end + 1;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end + 1, end + 1);
  reference.advance(end);
  assert.equal(reference.state.game.phase, "playing");
  const delayed = replica();
  delayed.advance(end);
  assert.equal(delayed.state.game.phase, "matchOver");
  assert.equal(
    delayed.state.game.matchStats.get("creator")!.matchScoreUnits,
    120,
  );
  delayed.receive("b", [entries[1]!], 2, end + 1, end + 1);
  const repaired = delayed.receive("b", [entries[0]!], 2, end + 1, end + 1);
  assert.ok(repaired.rollbackTicks > 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.equal(
    delayed.state.game.matchStats.get("creator")!.matchScoreUnits,
    0,
  );
  for (const w of [reference, delayed]) w.advance(end + 1);
  assert.equal(delayed.state.game.phase, "matchOver");
  const settled = hashRoomState(delayed.state);
  assert.deepEqual(
    delayed.receive("b", entries, 2, end + 1, end + 1).events,
    [],
  );
  assert.equal(hashRoomState(delayed.state), settled);
  assert.equal(settled, hashRoomState(reference.state));
  assert.equal(delayed.state.game.leaderboard.get("creator")!.matchWins, 1);
});

test("late reordered inputs converge through Nitro and Snail collection, and a duplicate never stacks a second deadline", () => {
  const fixture = world();
  playing(fixture);
  Object.assign(fixture.state.game.players.get("creator")!, {
    x: 1100,
    y: 700,
    angle: 0,
    trail: [],
  });
  Object.assign(guest(fixture), { x: 500, y: 350, angle: 0, trail: [] });
  fixture.state.game.nextPickupSpawnTick = Number.MAX_SAFE_INTEGER;
  fixture.state.game.pickups = (["nitro", "nitro", "snail"] as const).map(
    (type, index) => ({
      id: fixture.state.game.nextPickupId++,
      type,
      x: 505 + index * 12,
      y: 350,
      expiresAtTick: fixture.tick + 100,
    }),
  );
  const start = fixture.tick,
    end = start + 12;
  const entries: Entry[] = [
    [1, start + 1, STEER, 1],
    [2, start + 8, STEER, 0],
  ];
  const replica = () => {
    const w = new World(structuredClone(fixture.state), "creator", "creator");
    w.stream("creator", 1).through = end;
    w.stream("b", 1).through = start;
    return w;
  };
  const reference = replica();
  reference.receive("b", entries, 2, end, end);
  reference.advance(end);
  const delayed = replica();
  delayed.advance(end);
  delayed.receive("b", [entries[1]!], 2, end, end);
  const repair = delayed.receive("b", [entries[0]!], 2, end, end);
  assert.ok(repair.rollbackTicks > 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
  assert.equal(
    guest(delayed).nitroUntilTicks.length,
    2,
    "both Nitros landed as their own deadlines",
  );
  assert.equal(
    delayed.state.game.players.get("creator")!.snailUntilTicks.length,
    1,
    "the guest's Snail slowed the creator",
  );
  assert.deepEqual(guest(delayed).snailUntilTicks, []);
  assert.equal(delayed.state.game.pickups.length, 0);
  const duplicate = delayed.receive("b", entries, 2, end, end);
  assert.deepEqual(duplicate.events, []);
  assert.equal(duplicate.rollbackTicks, 0);
  assert.equal(hashRoomState(delayed.state), hashRoomState(reference.state));
});
