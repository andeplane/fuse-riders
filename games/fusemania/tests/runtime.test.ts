import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeDependencies } from "fuse-netcode";
import {
  BATTLE_MODE,
  MARVELOUS,
  MISS,
  NO_JUDGMENT,
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
    { display: true, song: "other", mode: 0, chart: 0 },
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
