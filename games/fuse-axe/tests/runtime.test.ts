import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  JOIN,
  PRESENCE,
  World,
  decodePacket,
  encodeSnapshot,
  roomHash,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import { Platform, RESERVED_KEYS, type AccountRules } from "fuse-platform";
import { RIGHT, type HeroKind } from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  axeGame,
  createRoom,
  decode,
  encode,
  foldTick,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { isHero, validName } from "../src/online/names.js";
import { axeRegistration } from "../src/platform.js";
import { Mesh } from "./fixtures/mesh.js";

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

test("two devices and a bot play stage 1 over a lossy, reordering mesh and agree on it", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const random = seeded(4);
  mesh.fast = () => {
    const roll = random();
    if (roll < 0.1) return { drop: true };
    if (roll < 0.2) return { delayMs: 20, duplicateMs: 60 };
    return { delayMs: 10 + Math.floor(random() * 70) };
  };
  const host = mesh.join("host"),
    guest = mesh.join("guest");
  mesh.run(300);
  host.command({ type: "join", name: "Host", avatarId: "rhea" });
  guest.command({ type: "join", name: "Guest", avatarId: "gorm" });
  mesh.run(3_000);
  assert.ok(host.command({ type: "bot", action: "add" }));
  mesh.run(300);
  assert.equal(guest.roomState()!.seats.size, 3);
  assert.ok(host.command({ type: "action", action: "start" }));
  mesh.run(1_500);
  assert.equal(guest.roomState()!.stage, "running");
  assert.deepEqual(
    guest.roomState()!.world!.heroes.map((hero) => hero.kind),
    ["rhea", "gorm", "gorm"],
    "each picked hero, and the bot its seat's",
  );
  // The guest pulses its walk; the host's replica has to hear it.
  let t = 0,
    heard = false;
  mesh.run(3_000, () => {
    if (++t % 15 === 0) guest.input(t % 30 === 0 ? RIGHT : 0);
    heard ||= host.roomState()!.held.guest === RIGHT;
  });
  assert.ok(heard, "the guest's walk reached the host's fold");
  // A hidden page lets go of its controls and steps away; shown again, it walks on.
  guest.input(RIGHT);
  mesh.run(300);
  mesh.hide("guest", true);
  mesh.run(1_000);
  assert.equal(host.roomState()!.held.guest, undefined);
  assert.equal(host.roomState()!.seats.get("guest")!.away, true);
  mesh.hide("guest", false);
  mesh.run(2_000);
  guest.input(RIGHT);
  mesh.fast = () => ({ delayMs: 15 });
  mesh.run(1_000);
  assert.equal(host.roomState()!.held.guest, RIGHT, "back and walking");
  guest.input(0);
  mesh.run(2_000);
  assert.ok(Math.min(host.confirmedTick(), guest.confirmedTick()) > 0);
  const hostRoom = host.roomState()!,
    guestRoom = guest.roomState()!;
  assert.equal(hostRoom.tick, guestRoom.tick);
  assert.equal(
    JSON.stringify(hostRoom.world),
    JSON.stringify(guestRoom.world),
    "both replicas played the same stage",
  );
  assert.ok(hostRoom.world!.heroes[1]!.x > hostRoom.world!.heroes[2]!.x);
  assert.equal(guest.self, "guest");
  assert.ok(
    mesh.frames.get("guest")!.at(-1)!.world,
    "the screen gets frames with the world",
  );
});

test("a device that joins mid-run recovers the world from a peer and plays from the next run", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const host = mesh.join("host");
  mesh.run(300);
  host.command({ type: "join", name: "Host" });
  mesh.run(500);
  host.command({ type: "bot", action: "add" });
  mesh.run(300);
  host.command({ type: "action", action: "start" });
  host.input(RIGHT);
  mesh.run(2_000);
  const late = mesh.join("late");
  mesh.run(3_000);
  late.command({ type: "join", name: "Late" });
  late.input(RIGHT);
  mesh.run(2_000);
  const room = late.roomState()!;
  assert.ok(room.world, "the late device has the run");
  assert.ok(room.seats.has("late"), "and a seat");
  assert.equal(room.world.heroes.length, 2, "it plays from the next run");
  assert.equal(room.held.late, undefined, "so it logs no controls yet");
  assert.equal(room.tick, host.roomState()!.tick);
  assert.equal(
    JSON.stringify(room.world),
    JSON.stringify(host.roomState()!.world),
  );
});

test("a hero is picked in the lobby; held controls are logged when the run begins and again after a resync", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  const host = mesh.join("host");
  mesh.run(200);
  assert.ok(!host.pick("gorm"), "a member without a seat picks nothing");
  host.command({ type: "join", name: "Host" });
  mesh.run(1_000);
  assert.equal(host.roomState()!.seats.get("host")!.avatarId, "brakka");
  assert.ok(!host.pick("wizard" as HeroKind));
  assert.ok(host.pick("gorm"));
  mesh.run(200);
  assert.equal(host.roomState()!.seats.get("host")!.avatarId, "gorm");
  host.input(RIGHT);
  assert.equal(host.roomState()!.held.host, undefined, "none in the lobby");
  host.command({ type: "action", action: "start" });
  mesh.run(500);
  assert.equal(host.roomState()!.world!.heroes[0]!.kind, "gorm");
  assert.equal(
    host.roomState()!.held.host,
    RIGHT,
    "the held walk reached the run once it began",
  );
  assert.ok(!host.pick("rhea"), "no picking in a run");
  // A resync forgets what was logged, not the keys still down: the held walk is logged again.
  host.resync();
  host.flush();
  mesh.run(100);
  assert.equal(host.roomState()!.held.host, RIGHT);
  host.input(0);
  mesh.run(100);
  assert.equal(host.roomState()!.held.host, undefined);
  mesh.leave("host");
});

/**
 * `host` (Rhea) and `late` (Brakka) seated and run `m1` started by the pure fold, then restored as a room in `stage`
 * (with `late` logged absent when `present` is false).
 */
function roomIn(stage: Stage, present = true): Room {
  const room = createRoom("m0", DEFAULT_SETTINGS);
  let seq = 0;
  const fold = (...bodies: unknown[][]) => {
    const tick = room.tick + 1,
      entries = bodies.map((body) => [++seq, tick, ...body] as Entry);
    const streams = new Map<string, StreamEntries<Entry>>([
      ["host", { generation: 1, entries }],
    ]);
    foldTick(room, "host", streams);
  };
  fold(
    [JOIN, "host", "Host", 0, "rhea", 1],
    [JOIN, "late", "Late", 1, "brakka", 1],
  );
  fold([ACTION, "start", "m1"]);
  const fields = structuredClone(encode(room));
  fields[2] = stage;
  for (const seat of fields[4] as { id: string; connected: boolean }[])
    if (seat.id === "late") seat.connected = present;
  const restored = decode(fields, room.tick);
  assert.ok(restored, `a room in ${stage} restores`);
  return restored;
}

/**
 * The `host` of a mesh as a peer this test speaks for: it serves `served` to a device that asks for the room, and
 * collects the entries every other device logs (each once, in the order they were first heard).
 */
function serve(mesh: Mesh, served: Room): Entry[] {
  const heard: Entry[] = [],
    seen = new Set<string>();
  mesh.script(
    "host",
    (from, data) => {
      if ((data as { type?: unknown }).type !== "snapshotRequest") return;
      const world = new World(axeGame, structuredClone(served), "host", "host");
      for (const chunk of encodeSnapshot(world, roomHash("ROOM:host")))
        mesh.say("host", from, chunk);
    },
    (from, bytes) => {
      const decoded = decodePacket(axeGame, bytes);
      if (!decoded || !("packet" in decoded)) return;
      for (const entry of decoded.packet.entries) {
        const key = `${from}:${decoded.packet.generation}:${entry[0]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        heard.push(entry);
      }
    },
  );
  return heard;
}

test("a hero is picked only in the lobby or after game over, never in a run or in camp between its stages", () => {
  for (const [stage, picks] of [
    ["between", false],
    ["running", false],
    ["over", true],
  ] as const) {
    const mesh = new Mesh("host", DEFAULT_SETTINGS);
    serve(mesh, roomIn(stage));
    const late = mesh.join("late");
    mesh.run(300);
    assert.equal(late.roomState()?.stage, stage, "the room came from a peer");
    assert.equal(late.pick("gorm"), picks, `a pick in ${stage}`);
    mesh.run(300);
    assert.equal(
      late.roomState()!.seats.get("late")!.avatarId,
      picks ? "gorm" : "brakka",
    );
  }
});

test("a seat the fold would skip picks nothing: one logged absent, a watcher", () => {
  const mesh = new Mesh("host", DEFAULT_SETTINGS);
  serve(mesh, roomIn("over", false));
  const late = mesh.join("late");
  mesh.run(300);
  assert.equal(late.roomState()?.seats.get("late")?.connected, false);
  assert.ok(!late.pick("gorm"), "absent: the fold skips its entries");
  mesh.run(300);
  assert.equal(late.roomState()!.seats.get("late")!.avatarId, "brakka");
  const watcher = mesh.join("watcher");
  watcher.command({ type: "spectate", name: "Watcher" });
  mesh.run(500);
  assert.ok(!watcher.pick("gorm"), "a watcher has no hero");
});

test("held controls leave a device only in a run it plays: not in camp or after game over, and a hidden page lets go", () => {
  for (const [stage, logged] of [
    ["between", false],
    ["over", false],
    ["running", true],
  ] as const) {
    const mesh = new Mesh("host", DEFAULT_SETTINGS),
      heard = serve(mesh, roomIn(stage));
    const late = mesh.join("late");
    mesh.run(300);
    assert.equal(late.roomState()?.stage, stage, "the room came from a peer");
    // A run's first entry from a device says what it holds then (nothing), the next what it does: only the bits a hero
    // has (the stray bit is cut).
    late.input(RIGHT | 0x8000);
    mesh.run(300);
    assert.deepEqual(
      heard.filter((entry) => entry[2] === PLAY).map((entry) => entry.slice(2)),
      logged
        ? [
            [PLAY, "m1", 1, 0],
            [PLAY, "m1", 1, RIGHT],
          ]
        : [],
      `held controls in ${stage}`,
    );
    mesh.hide("late", true);
    mesh.run(300);
    assert.deepEqual(
      heard
        .filter((entry) => entry[2] === PLAY || entry[2] === PRESENCE)
        .map((entry) => entry.slice(2)),
      logged
        ? [
            [PLAY, "m1", 1, 0],
            [PLAY, "m1", 1, RIGHT],
            [PLAY, "m1", 1, 0],
            [PRESENCE, "late", false, 1],
          ]
        : [[PRESENCE, "late", false, 1]],
      `a hidden page in ${stage} releases what it held and steps away`,
    );
  }
});

test("the platform registration admits rooms and records nothing yet", () => {
  assert.equal(axeRegistration.id, axeGame.id);
  const account: AccountRules = {
    validName,
    validAvatar: isHero,
    nameRule: "1–18 characters",
    fallbackName: "Hero",
  };
  const platform = new Platform(account, [axeRegistration]);
  assert.deepEqual(platform.gameIds, ["fuse-axe"]);
  assert.equal(platform.game("fuse-axe"), axeRegistration);
  assert.equal(axeRegistration.isBot("bot:1"), false);
  assert.equal(axeRegistration.parseStats({}, 1), undefined);
  assert.deepEqual(axeRegistration.emptyTotals(), {});
  const reserved = [...RESERVED_KEYS][0]!;
  assert.deepEqual(axeRegistration.parseTotals({ [reserved]: 1 }), {});
  assert.equal(axeRegistration.parseTotals({ kills: 1 }), undefined);
});
