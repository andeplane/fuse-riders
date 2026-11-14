import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import {
  BATTLE_MODE,
  MARVELOUS,
  MISS,
  NO_JUDGMENT,
  LEAD_IN_MS,
  SOLO_LEAD_IN_MS,
} from "../src/engine/index.js";
import { createFusemaniaGame } from "../src/online/game.js";
import { FusemaniaRuntime } from "../src/online/runtime.js";
import { Mesh, type TestRuntime } from "./fixtures/mesh.js";
import { SETTINGS, game, library } from "./fixtures/room.js";
import { beatMs } from "./fixtures/songs.js";

/** A seeded generator, so a lossy mesh is the same mesh on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
/** A link that drops a tenth of its fast packets, duplicates another tenth and delivers the rest out of order. */
function lossy(mesh: Mesh, seed: number): void {
  const random = seeded(seed);
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.1) return { drop: true };
    if (roll < 0.2) return { delayMs: 20, duplicateMs: 60 };
    return { delayMs: 10 + Math.floor(random() * 70) };
  };
}
const steady = (mesh: Mesh) => {
  mesh.fast = () => ({ delayMs: 15 });
};

/** Host and guest seated and a match started by the host. */
function match(): { mesh: Mesh; host: TestRuntime; guest: TestRuntime } {
  const mesh = new Mesh("host", SETTINGS);
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  guest.command({ type: "join", name: "Guest" });
  mesh.run(3_000);
  assert.equal(host.roomState()!.seats.size, 2);
  assert.ok(host.command({ type: "action", action: "start" }));
  // Both devices have the song: they say so, and the room lets it go.
  mesh.run(600, () => {
    host.ready();
    guest.ready();
  });
  assert.equal(host.held(), false);
  return { mesh, host, guest };
}

/**
 * A player at the keys: every 10 ms it presses the notes of Easy whose time has come, `late` ms after each, and lets
 * a key go 40 ms after pressing it. The times it stamps are the room clock's, as a device without sound would.
 */
function fingers(runtime: TestRuntime, late: number) {
  const notes = library.steps("grid", 0)!.notes;
  let next = 0;
  const up: { column: number; at: number }[] = [];
  return () => {
    const ms = runtime.songMs();
    if (ms === undefined) return;
    while (up.length && up[0]!.at <= ms) {
      const lifted = up.shift()!;
      runtime.key(lifted.column, false, lifted.at);
    }
    while (next < notes.length && notes[next]!.ms + late <= ms) {
      const note = notes[next++]!;
      if (runtime.key(note.column, true, note.ms + late))
        up.push({ column: note.column, at: note.ms + late + 40 });
    }
  };
}

const quiet = (now: () => number, schedule?: (run: () => void) => void) =>
  ({
    now,
    hidden: () => false,
    token: () => "match",
    generation: () => 1,
    schedule: (callback) => {
      schedule?.(callback);
      return () => {};
    },
    onVisibilityChange: () => () => {},
  }) satisfies RuntimeDependencies;
const silent = {
  state: () => {},
  event: () => {},
  status: () => {},
  ready: () => {},
};

test("solo is one player on the chosen song and chart, with AI rivals when it is a battle", () => {
  const runtime = new FusemaniaRuntime(
    "SOLO",
    { ...SETTINGS, display: true, song: "other" },
    silent,
    game,
    { humanName: "Ada", dependencies: quiet(() => 0) },
  );
  runtime.start();
  const room = runtime.roomState()!;
  assert.equal(runtime.self, "solo");
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.roster.map((entrant) => [entrant.id, entrant.name, entrant.bot]),
    [["solo", "Ada", false]],
  );
  assert.equal(room.world!.song, "other");
  assert.equal(room.settings.display, false);
  assert.ok(room.world!.ms <= -SOLO_LEAD_IN_MS + 100);
  runtime.stop();

  const battle = new FusemaniaRuntime(
    "SOLO",
    { ...SETTINGS, mode: BATTLE_MODE },
    silent,
    createFusemaniaGame(library, 3),
    { humanName: "Ada", dependencies: quiet(() => 0) },
  );
  battle.start();
  assert.deepEqual(
    battle.roomState()!.roster.map((entrant) => entrant.bot),
    [false, true, true, true],
  );
  battle.stop();
});

test("two devices play a song over a mesh that drops, duplicates and reorders, and agree on every judgment", () => {
  const { mesh, host, guest } = match();
  lossy(mesh, 4);
  const hostKeys = fingers(host, 5),
    guestKeys = fingers(guest, 60);
  const play = () => {
    hostKeys();
    guestKeys();
  };
  mesh.run(24_000, play);
  steady(mesh);
  mesh.run(2_000, play);
  assert.ok(mesh.align(200));
  const a = host.roomState()!,
    b = guest.roomState()!;
  assert.ok(Math.min(host.confirmedTick(), guest.confirmedTick()) > 0);
  assert.equal(a.tick, b.tick);
  assert.equal(game.hash(a), game.hash(b), "identical room hashes");
  assert.deepEqual(a.world, b.world);
  const [first, second] = a.world!.players;
  // Every press reached the fold with the time it was made at: 5 ms late is a Marvelous, 60 ms late a Great.
  assert.ok(first!.counts[MARVELOUS]! >= 30, `${first!.counts[MARVELOUS]}`);
  assert.equal(first!.counts[MISS], 0);
  assert.equal(second!.counts[MARVELOUS], 0);
  assert.equal(second!.counts[MISS], 0);
  assert.ok(first!.score > second!.score);
  assert.equal(host.metrics().mismatches, 0);
  assert.equal(guest.metrics().mismatches, 0);
});

test("a device that joins mid-song recovers the match from a peer and watches on in step", () => {
  const { mesh, host, guest } = match();
  const keys = fingers(guest, 0);
  mesh.run(8_000, keys);
  const late = mesh.join("late");
  mesh.run(3_000, keys);
  assert.ok(late.command({ type: "spectate", name: "Late" }));
  mesh.run(3_000, keys);
  // The guest's newest key is still on its way to the others: they are compared once it has arrived.
  mesh.run(200);
  assert.ok(mesh.align());
  const room = late.roomState()!;
  assert.ok(room.world, "the late device has the match");
  assert.equal(room.seats.get("late")?.watcher, true);
  assert.equal(game.hash(room), game.hash(host.roomState()!));
  assert.equal(game.hash(room), game.hash(guest.roomState()!));
  assert.ok(room.world.players[1]!.counts[MARVELOUS]! > 0);
  // A watcher's keys are nobody's.
  assert.equal(late.key(0, true, late.songMs()!), false);
  assert.ok(late.picture(late.songMs()!));
});

test("a press shows in the picture at once, and the room then judges it the same", () => {
  let now = 0,
    pass: (() => void) | undefined;
  const runtime = new FusemaniaRuntime("SOLO", SETTINGS, silent, game, {
    humanName: "Ada",
    dependencies: quiet(
      () => now,
      (callback) => (pass = callback),
    ),
  });
  runtime.start();
  const wait = (ms: number) => {
    for (let t = 0; t < ms; t += 5) {
      now += 5;
      pass?.();
    }
  };
  while (runtime.songMs()! < beatMs(4) - 20) wait(5);
  // Just after a tick, so the room will not fold the press for most of a tick.
  const tick = runtime.roomState()!.tick;
  while (runtime.roomState()!.tick === tick) wait(5);
  const heard = runtime.songMs()! + 12;
  const pressed = Math.max(heard, beatMs(4) + 8);
  assert.equal(
    runtime.picture(pressed)!.players[0]!.judged,
    NO_JUDGMENT,
    "nothing before the key",
  );
  assert.ok(runtime.key(0, true, pressed));
  assert.equal(runtime.key(0, true, pressed), false, "a key is down once");
  const drawn = runtime.picture(pressed)!.players[0]!;
  assert.equal(drawn.judged, MARVELOUS);
  assert.equal(drawn.combo, 1);
  assert.equal(
    runtime.roomState()!.world!.players[0]!.counts[MARVELOUS],
    0,
    "the room has not folded it yet",
  );
  wait(200);
  const folded = runtime.roomState()!.world!.players[0]!;
  assert.equal(folded.counts[MARVELOUS], 1);
  assert.equal(folded.judgedAt, drawn.judgedAt);
  assert.equal(folded.judgedOff, drawn.judgedOff);
  // Letting go is logged once too, and a stopped page lets go of everything.
  assert.ok(runtime.key(0, false, runtime.songMs()!));
  assert.equal(runtime.key(0, false, runtime.songMs()!), false);
  runtime.stop();
});

test("a press keeps its own song time while it is inside its tick's bounds, however late it is logged", () => {
  // Solo, on a clock the test moves: the room's song position is the clock's, as on a page without sound.
  const judgedOff = (logAfter: number, late: number) => {
    let now = 0,
      pass: (() => void) | undefined;
    const runtime = new FusemaniaRuntime("SOLO", SETTINGS, silent, game, {
      humanName: "Ada",
      dependencies: quiet(
        () => now,
        (callback) => (pass = callback),
      ),
    });
    runtime.start();
    assert.equal(runtime.lastSlackMs, undefined);
    const wait = (ms: number) => {
      for (let t = 0; t < ms; t += 5) {
        now += 5;
        pass?.();
      }
    };
    const chart = runtime.roomState()!.world!.players[0]!.chart,
      note = library
        .steps(runtime.roomState()!.world!.song, chart)!
        .notes.find((each) => each.ms >= beatMs(6))!,
      stamped = note.ms + late;
    // The key is logged `logAfter` ms after the song time it names: a slow frame, a busy main thread.
    while (runtime.songMs()! < stamped + logAfter) wait(5);
    assert.ok(runtime.key(note.column, true, stamped));
    const slack = runtime.lastSlackMs!;
    wait(600);
    const mine = runtime.roomState()!.world!.players[0]!;
    runtime.stop();
    return { off: mine.judgedOff, judged: mine.judged, slack };
  };
  // Pressed 13 ms late and logged at once, 100 ms later and 200 ms later: the same judgment, room to spare.
  const prompt = judgedOff(0, 13),
    slow = judgedOff(100, 13),
    slower = judgedOff(200, 13);
  assert.deepEqual([prompt.off, prompt.judged], [13, MARVELOUS]);
  assert.deepEqual([slow.off, slow.judged], [13, MARVELOUS]);
  assert.deepEqual([slower.off, slower.judged], [13, MARVELOUS]);
  assert.ok(prompt.slack > 0 && slow.slack > 0 && slower.slack > 0);
  assert.ok(slower.slack < slow.slack && slow.slack < prompt.slack);
  // Logged so late that the tick's bounds are passed, the room moves it: the slack says so before the fold does.
  const lost = judgedOff(400, 13);
  assert.ok(lost.slack < 0, `slack ${lost.slack}`);
  assert.notEqual(lost.off, 13);
});

test("a song waits for a device that is still getting it, and starts for both when it has it", () => {
  const mesh = new Mesh("host", SETTINGS);
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  guest.command({ type: "join", name: "Guest" });
  mesh.run(3_000);
  assert.ok(host.command({ type: "action", action: "start" }));
  // The host has the song and says so again and again; the guest's is still on its way.
  mesh.run(4_000, () => host.ready());
  for (const each of [host, guest]) {
    assert.equal(each.held(), true);
    assert.equal(each.songMs(), -LEAD_IN_MS, "the song has not moved");
    assert.equal(each.key(0, true, 0), false, "and takes no keys");
  }
  assert.deepEqual(mesh.frames.get("host")!.at(-1)!.waiting, {
    ids: ["guest"],
    screen: false,
  });
  mesh.run(600, () => {
    host.ready();
    guest.ready();
  });
  assert.ok(mesh.align());
  assert.equal(host.held(), false);
  assert.equal(guest.held(), false);
  assert.ok(host.songMs()! > -LEAD_IN_MS);
  assert.equal(game.hash(host.roomState()!), game.hash(guest.roomState()!));
  // Said once it was heard: the log holds one word from each, not one a frame.
  assert.equal(host.metrics().mismatches, 0);
});

test("a lobby seat is a choice: a guest joins the seat it asks for, host and guest move to any free one, and a taken one is refused", () => {
  const mesh = new Mesh("host", SETTINGS);
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  const slots = (runtime: TestRuntime) =>
    Object.fromEntries(
      [...runtime.roomState()!.seats.values()].map((seat) => [
        seat.id,
        seat.slot,
      ]),
    );
  host.command({ type: "join", name: "Host" });
  guest.command({ type: "join", name: "Guest", slot: 3 });
  mesh.run(3_000);
  assert.deepEqual(slots(host), { host: 0, guest: 3 });
  assert.ok(guest.command({ type: "join", name: "Guest", slot: 1 }));
  mesh.run(3_000);
  assert.ok(host.command({ type: "join", name: "Host", slot: 4 }));
  mesh.run(800);
  assert.deepEqual(slots(host), { host: 4, guest: 1 });
  assert.deepEqual(slots(guest), slots(host));
  // A seat somebody holds is not on offer, and asking for it moves nobody.
  guest.command({ type: "join", name: "Guest", slot: 4 });
  mesh.run(3_000);
  assert.deepEqual(slots(host), { host: 4, guest: 1 });
  // The moved seats still start a match, in seat order.
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(600, () => {
    host.ready();
    guest.ready();
  });
  assert.deepEqual(
    host.roomState()!.roster.map((entrant) => entrant.id),
    ["guest", "host"],
  );
});
