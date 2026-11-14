import test from "node:test";
import assert from "node:assert/strict";
import {
  decodePacket,
  type Callbacks,
  type RoomTransport,
  type RuntimeDependencies,
  type TransportEvents,
} from "fuse-netcode";
import {
  INPUT_HELD,
  INPUT_LEFT,
  INPUT_PRESSED,
  INPUT_RIGHT,
  type GameEvent,
} from "../src/engine/index.js";
import {
  ATTACK,
  DEFAULT_SETTINGS,
  PLAY,
  PRESS,
  SEAT,
  killerFuseGame,
  type AttackEntry,
  type Entry,
  type PlayEntry,
  type PressEntry,
  type Settings,
  type View,
} from "../src/online/game.js";
import { KillerFuseRuntime } from "../src/online/runtime.js";

/** The runtime as a test reads it: its own log, and the two things the netcode does to a game's controls. */
class Probe extends KillerFuseRuntime {
  log(): Entry[] {
    return [...this.own().entries.values()];
  }
  plays(): PlayEntry[] {
    return this.log().filter((entry): entry is PlayEntry => entry[2] === PLAY);
  }
  presses(): PressEntry[] {
    return this.log().filter(
      (entry): entry is PressEntry => entry[2] === PRESS,
    );
  }
  attacks(): AttackEntry[] {
    return this.log().filter(
      (entry): entry is AttackEntry => entry[2] === ATTACK,
    );
  }
  seats(): Entry[] {
    return this.log().filter((entry) => entry[2] === SEAT);
  }
  /** A resync that carried none of this device's entries: the log was reset. */
  resync(): void {
    this.resetControls();
  }
  /** The loop's word that the manager has logged this device's seat absent. */
  absent(): void {
    this.absentControls();
  }
}

/**
 * The runtime's clock, scheduler and page visibility, driven by the test: nothing moves unless `now` does. The shared
 * clock reads `now` alone, so `advance` places a moment inside a log tick exactly; `run` also drives the 10 ms loop.
 */
class Bench {
  now = 1_000;
  hidden = false;
  private tokens = 0;
  private loop: (() => void) | undefined;
  private notify: (() => void) | undefined;
  readonly dependencies: RuntimeDependencies = {
    now: () => this.now,
    hidden: () => this.hidden,
    token: () => `token-${++this.tokens}`,
    generation: () => 1,
    schedule: (callback) => {
      this.loop = callback;
      return () => (this.loop = undefined);
    },
    onVisibilityChange: (callback) => {
      this.notify = callback;
      return () => (this.notify = undefined);
    },
  };
  run(ms: number): void {
    for (let t = 0; t < ms; t += 10) {
      this.now += 10;
      this.loop?.();
    }
  }
  advance(ms: number): void {
    this.now += ms;
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.notify?.();
  }
}

/** What an app does with the runtime: it flushes the held controls on every frame it renders. */
function callbacks(
  events: GameEvent[],
  flush: () => void,
): Callbacks<View, GameEvent, Settings> {
  return {
    state: flush,
    event: (event) => events.push(event),
    status: () => {},
    ready: () => {},
  };
}

/**
 * A solo room (this device as the Cyan Queen, bots in the other five slots), whose clock started at tick 0 when it opened and is now 60 ms on: the
 * solo room folds its first tick as it opens, so an entry made before the clock passes that tick would land on a tick
 * already folded. The app's first frame has logged the nothing held (`[matchId, 1, 0]`).
 */
function solo() {
  const bench = new Bench(),
    events: GameEvent[] = [];
  const runtime = new Probe(
    "ROOM",
    DEFAULT_SETTINGS,
    callbacks(events, () => runtime.flush()),
    { dependencies: bench.dependencies },
  );
  const opened = bench.now;
  runtime.start();
  bench.run(60);
  /** Moves the clock to `ms` after the room opened (log ticks are 50 ms), without running the loop. */
  const at = (ms: number) => {
    assert.ok(opened + ms >= bench.now, "the clock only runs forward");
    bench.now = opened + ms;
  };
  return { bench, runtime, events, at };
}

/**
 * The room's creator on a transport with one silent peer, which hears every packet it is sent: the runtime as it runs
 * online, with its seat, its away entries and its packets.
 */
function hosted() {
  const bench = new Bench(),
    events: GameEvent[] = [],
    heard: Uint8Array[] = [];
  let link: TransportEvents | undefined;
  const transport = (transportEvents: TransportEvents): RoomTransport => {
    link = transportEvents;
    return {
      id: "host",
      hostId: "host",
      sentBytes: 0,
      connect: () => {},
      close: () => {},
      send: () => true,
      sendFast: (to, bytes) => {
        if (to === "peer") heard.push(bytes.slice());
        return true;
      },
      linked: () => true,
      explain: () => "fake link",
      stats: async () => ({ direct: 0, relayed: 0, buffered: 0 }),
    };
  };
  const runtime = new Probe(
    "ROOM",
    DEFAULT_SETTINGS,
    callbacks(events, () => runtime.flush()),
    { dependencies: bench.dependencies, transport },
  );
  runtime.start();
  link!.welcome("host", "host");
  bench.run(50); // the creator opens the room's world
  link!.peer("peer", true);
  link!.link("peer", true);
  assert.ok(runtime.command({ type: "join", name: "Host" }));
  bench.run(100);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(200);
  /** The entries of the newest packet the peer heard, as the peer decodes them. */
  const lastPacket = (): Entry[] => {
    const decoded = decodePacket(killerFuseGame, heard.at(-1)!);
    assert.ok(decoded && "packet" in decoded, "the peer heard a packet");
    return decoded.packet.entries;
  };
  return { bench, runtime, events, heard, lastPacket };
}

const plays = (runtime: Probe) =>
  runtime.plays().map((entry) => entry.slice(3));
const room = (runtime: Probe) => runtime.roomState()!;
const L = INPUT_LEFT,
  R = INPUT_RIGHT,
  H = INPUT_HELD;

test("solo: this device is the Cyan Queen, the engine's bots play the rest, and the game starts by itself", () => {
  const { runtime } = solo();
  assert.equal(runtime.self, "solo");
  assert.equal(room(runtime).stage, "running");
  assert.deepEqual(room(runtime).world!.humans, [
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  assert.equal(room(runtime).seats.size, 1);
});

test("this device logs its held bits on change, not the press edge and not the same hold twice", () => {
  const { runtime } = solo();
  const { matchId } = room(runtime);
  runtime.input(L | INPUT_PRESSED);
  runtime.input(L);
  runtime.input(L | 0x40);
  assert.deepEqual(plays(runtime), [
    [matchId, 1, 0],
    [matchId, 1, L],
  ]);
  runtime.input(L | H);
  runtime.input(0);
  assert.deepEqual(plays(runtime).slice(2), [
    [matchId, 1, L | H],
    [matchId, 1, 0],
  ]);
});

test("a press is stamped with the next log tick and the third of it that the clock has reached", () => {
  const { runtime, at } = solo();
  const { matchId } = room(runtime);
  // [ms past the 100 ms mark (log tick 2.0), the log tick the press is stamped with, its step of that tick]
  const presses: [number, number, number][] = [
    [0, 3, 0], // the first instant of a tick is its first step
    [16, 3, 0],
    [17, 3, 1],
    [33, 3, 1],
    [34, 3, 2],
    [49.999, 3, 2], // just short of the next tick is still the last step of this one
    [50, 4, 0], // a boundary belongs to the tick it opens
    [66, 4, 0],
    [67, 4, 1],
    [100, 5, 0],
  ];
  presses.forEach(([ms, tick, step], index) => {
    at(100 + ms);
    assert.ok(runtime.press(), `a press at ${ms} ms`);
    assert.deepEqual(
      runtime.presses().at(-1)!.slice(1),
      [tick, PRESS, matchId, 1, index + 1, step],
      `a press at ${ms} ms`,
    );
  });
});

test("an attack is stamped the way a flap is, and both buttons share one rising gesture stream", () => {
  const { runtime, at } = solo();
  const { matchId } = room(runtime);
  assert.deepEqual(runtime.attacks(), [], "nothing until the button is hit");
  at(134); // the last third of log tick 2, so the entry is stamped for tick 3
  assert.ok(runtime.attack());
  assert.deepEqual(runtime.attacks().at(-1)!.slice(1), [
    3,
    ATTACK,
    matchId,
    1,
    1,
    2,
  ]);
  // The flap after it takes the next ordinal, not the first: one stream carries both gestures.
  at(150);
  assert.ok(runtime.press());
  assert.deepEqual(runtime.presses().at(-1)!.slice(1), [
    4,
    PRESS,
    matchId,
    1,
    2,
    0,
  ]);
  at(167);
  assert.ok(runtime.attack());
  assert.deepEqual(runtime.attacks().at(-1)!.slice(1), [
    4,
    ATTACK,
    matchId,
    1,
    3,
    1,
  ]);
});

test("an attack reaches this device's Queen, and a device that plays nothing attacks nothing", () => {
  const { bench, runtime } = solo();
  bench.run(8_300); // the first game's countdown (8 s) is out and she is flying
  const queen = () => room(runtime).world!.units[0]!;
  assert.equal(queen().attack, 0, "she has not struck");
  assert.ok(runtime.attack());
  bench.run(100);
  assert.ok(
    queen().attack > 0 || queen().attackBuffer > 0,
    "the fold struck with the attack edge, or holds it until there is room",
  );
  // Outside a running game there is nothing to strike with, and no ordinal is spent.
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  const logged = runtime.attacks().length;
  assert.equal(runtime.attack(), false);
  assert.equal(runtime.attacks().length, logged);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  assert.ok(runtime.attack());
  assert.equal(
    runtime.attacks().at(-1)![5],
    logged + 1,
    "the ordinal rose by one, not by the refused press",
  );
});

test("a tap shorter than a log tick flaps the Queen, and held bits reach the fold", () => {
  const { bench, runtime } = solo();
  runtime.input(R);
  bench.run(8_300); // the first game's countdown (8 s) and a little flight
  assert.equal(room(runtime).held.solo, R);
  const queen = () => room(runtime).world!.units[0]!;
  bench.run(1_000); // she lands
  const rested = queen().y;
  assert.ok(runtime.press());
  bench.run(150);
  assert.ok(queen().y < rested, "the press lifted her");
});

test("a device that plays nothing logs no controls and spends no gesture", () => {
  const { bench, runtime } = solo();
  const logged = runtime.plays().length;
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.equal(room(runtime).stage, "lobby");
  runtime.input(L);
  assert.equal(runtime.press(), false);
  assert.equal(runtime.plays().length, logged);
  assert.deepEqual(runtime.presses(), []);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  assert.ok(runtime.press());
  assert.equal(runtime.presses()[0]![5], 1, "the first press is gesture 1");
});

test("seat choices are logged outside a running game only, and move this device's seat", () => {
  const { bench, runtime } = solo();
  assert.equal(runtime.seat(3), false, "not during a game");
  assert.deepEqual(runtime.seats(), []);
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.ok(runtime.seat(3));
  bench.run(100);
  assert.equal(room(runtime).seats.get("solo")!.slot, 3);
  assert.deepEqual(
    runtime.seats().map((entry) => entry.slice(2)),
    [[SEAT, 3]],
  );
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  assert.equal(room(runtime).world!.humans[3], true);
  // A runtime that has not opened a room has no seat to move.
  const idle = new Probe(
    "ROOM",
    DEFAULT_SETTINGS,
    callbacks([], () => {}),
    {
      dependencies: new Bench().dependencies,
    },
  );
  assert.equal(idle.seat(1), false);
  assert.equal(idle.press(), false);
  assert.equal(idle.roomState(), undefined);
});

test("gesture ordinals only rise, across sets and a resync", () => {
  const { bench, runtime } = solo();
  const seen: [string, number][] = [];
  const press = () => {
    bench.advance(30);
    assert.ok(runtime.press());
    seen.push([room(runtime).matchId, runtime.presses().at(-1)![5]]);
  };
  press();
  press();
  const first = room(runtime).matchId;
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  assert.notEqual(room(runtime).matchId, first, "a new set");
  press();
  runtime.resync();
  press();
  assert.deepEqual(
    seen.map(([, ordinal]) => ordinal),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    seen.map(([matchId]) => matchId === first),
    [true, true, false, false],
    "each press is scoped to the set it was made in",
  );
  assert.deepEqual(
    runtime.presses().map((e) => e[5]),
    [1, 2, 3, 4],
  );
});

test("held bits are logged again in a new set and in the next game", () => {
  const { bench, runtime } = solo();
  const first = room(runtime).matchId;
  runtime.input(L);
  bench.run(100);
  assert.deepEqual(plays(runtime), [
    [first, 1, 0],
    [first, 1, L],
  ]);
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.equal(plays(runtime).length, 2, "nothing in the lobby");
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  const second = room(runtime).matchId;
  assert.deepEqual(plays(runtime).at(-1), [second, 1, L]);
  assert.equal(room(runtime).held.solo, L, "the new set hears the hold");
  for (let ms = 0; ms < 900_000 && room(runtime).round === 1; ms += 1_000)
    bench.run(1_000);
  assert.equal(room(runtime).round, 2, "the bots play the first game out");
  bench.run(200);
  assert.deepEqual(plays(runtime).at(-1), [second, 2, L]);
  assert.equal(room(runtime).held.solo, L, "the next game hears it too");
  runtime.input(0);
  bench.run(100);
  assert.equal(room(runtime).held.solo, undefined);
});

test("held bits are logged again after a resync or an absence made the runtime forget them", () => {
  const { runtime } = solo();
  const { matchId } = room(runtime);
  runtime.input(L);
  runtime.flush();
  const logged = runtime.plays().length;
  runtime.resync();
  runtime.flush();
  runtime.flush();
  assert.equal(runtime.plays().length, logged + 1, "once");
  runtime.absent();
  runtime.flush();
  assert.deepEqual(plays(runtime).slice(logged - 1), [
    [matchId, 1, L],
    [matchId, 1, L],
    [matchId, 1, L],
  ]);
});

test("a page that hides lets go of its controls, and holds nothing when it is back", () => {
  const { bench, runtime } = solo();
  runtime.input(L);
  bench.run(200);
  assert.equal(room(runtime).held.solo, L);
  bench.setHidden(true);
  assert.equal(runtime.plays().at(-1)![5], 0, "released as the page hides");
  assert.equal(room(runtime).held.solo, undefined);
  bench.setHidden(false);
  bench.run(200);
  assert.equal(room(runtime).held.solo, undefined);
  runtime.input(R);
  bench.run(100);
  assert.equal(room(runtime).held.solo, R);
});

test("a press and a change of the held bits leave in a packet at once, not on the next loop", () => {
  const { bench, runtime, heard, lastPacket } = hosted();
  bench.run(500);
  assert.equal(room(runtime).stage, "running");
  const before = heard.length;
  assert.ok(runtime.press());
  assert.equal(heard.length, before + 1, "sent by the press itself");
  const press = runtime.presses().at(-1)!;
  assert.deepEqual(lastPacket().at(-1), press);
  runtime.input(L);
  assert.equal(heard.length, before + 2, "sent by the change itself");
  assert.deepEqual(lastPacket().at(-1), runtime.plays().at(-1));
  assert.deepEqual(
    lastPacket().filter((e) => e[2] === PRESS),
    [press],
    "the press goes out again with the next packets, until it is too old to matter",
  );
});

test("a seat that was away has the bits it still holds logged again once it is back", () => {
  const { bench, runtime } = hosted();
  const { matchId, round } = room(runtime);
  runtime.input(L);
  bench.run(300);
  assert.equal(room(runtime).held.host, L);
  bench.setHidden(true);
  assert.equal(
    runtime.plays().at(-1)![5],
    0,
    "released before the away entry leaves",
  );
  runtime.input(R);
  bench.setHidden(false);
  bench.run(500);
  assert.equal(room(runtime).seats.get("host")!.connected, true, "back");
  assert.equal(room(runtime).round, round);
  assert.deepEqual(
    plays(runtime).slice(-2),
    [
      [matchId, round, R],
      [matchId, round, R],
    ],
    "logged again once the seat was back",
  );
  assert.equal(room(runtime).held.host, R);
});

test("what the screen plays forward from has this device's controls the moment they are made", () => {
  const { bench, runtime } = solo();
  assert.equal(runtime.ahead()?.ticks[0]?.length, 0, "the countdown");
  bench.run(8_300);
  const before = runtime.ahead()!;
  assert.equal(before.tick, room(runtime).tick);
  assert.equal(before.world, room(runtime).world);
  assert.equal(before.ticks[0]![0]![0]!.right, false);
  // Held right and a press, with no fold in between: both are in the next tick's inputs, the press on its step.
  runtime.input(R);
  assert.ok(runtime.press());
  const after = runtime.ahead()!;
  assert.equal(after.tick, before.tick, "nothing was folded");
  assert.deepEqual(
    after.ticks.map((tick) => tick.map((step) => step[0]!.right)),
    [
      [true, true, true],
      [true, true, true],
    ],
  );
  const pressed = runtime.presses().at(-1)!;
  assert.deepEqual(
    after.ticks[pressed[1] - after.tick - 1]!.map((step) => step[0]!.pressed),
    [0, 1, 2].map((step) => step === pressed[6]),
  );
  assert.notDeepEqual(after.next[0], before.next[0]);
  // The fold then runs on exactly those inputs: the mark of the folded tick is the one that was ahead.
  bench.run(50);
  assert.deepEqual(runtime.ahead()!.folded, after.next[0]);
});
