import test from "node:test";
import assert from "node:assert/strict";
import {
  decodePacket,
  type Callbacks,
  type RoomTransport,
  type RuntimeDependencies,
  type TransportEvents,
} from "fuse-netcode";
import { FIRE, LEFT, UP, type TickEvent } from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  PLAY,
  PRESS,
  bombersGame,
  type Entry,
  type PlayEntry,
  type PressEntry,
  type Settings,
  type View,
} from "../src/online/game.js";
import { BombersRuntime } from "../src/online/runtime.js";

/** The runtime as a test reads it: its own log, and the two things the netcode does to a game's controls. */
class Probe extends BombersRuntime {
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
  events: TickEvent[],
  flush: () => void,
): Callbacks<View, TickEvent, Settings> {
  return {
    state: flush,
    event: (event) => events.push(event),
    status: () => {},
    ready: () => {},
  };
}

/**
 * A solo room (this device and three bots), whose clock started at tick 0 when it opened and is now 60 ms on: the
 * solo room folds its first tick as it opens, so an entry made before the clock passes that tick would land on a tick
 * already folded. The app's first frame has logged the nothing held (`[matchId, 1, 0]`).
 */
function solo() {
  const bench = new Bench(),
    events: TickEvent[] = [];
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
    events: TickEvent[] = [],
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
  assert.ok(runtime.command({ type: "bot", action: "add" }));
  bench.run(100);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(200);
  /** The entries of the newest packet the peer heard, as the peer decodes them. */
  const lastPacket = (): Entry[] => {
    const decoded = decodePacket(bombersGame, heard.at(-1)!);
    assert.ok(decoded && "packet" in decoded, "the peer heard a packet");
    return decoded.packet.entries;
  };
  return { bench, runtime, events, heard, lastPacket };
}

const plays = (runtime: Probe) =>
  runtime.plays().map((entry) => entry.slice(3));
const room = (runtime: Probe) => runtime.roomState()!;

test("this device logs its held directions on change, not the fire bit and not the same hold twice", () => {
  const { runtime } = solo();
  const { matchId } = room(runtime);
  assert.equal(room(runtime).stage, "running");
  assert.deepEqual(room(runtime).ships, ["solo", "bot:1", "bot:2", "bot:3"]);
  runtime.input(UP | FIRE);
  runtime.input(UP);
  runtime.input(UP | 0x40);
  assert.deepEqual(plays(runtime), [
    [matchId, 1, 0],
    [matchId, 1, UP],
  ]);
  runtime.input(UP | LEFT);
  runtime.input(0);
  assert.deepEqual(plays(runtime).slice(2), [
    [matchId, 1, UP | LEFT],
    [matchId, 1, 0],
  ]);
});

test("a fire press is stamped with the next log tick and the third of it that the clock has reached", () => {
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
    assert.ok(runtime.fire(), `a press at ${ms} ms`);
    assert.deepEqual(
      runtime.presses().at(-1)!.slice(1),
      [tick, PRESS, matchId, 1, index + 1, step],
      `a press at ${ms} ms`,
    );
  });
});

test("a tap shorter than a log tick fires on its step, and two presses inside one reload fire one volley", () => {
  const { bench, runtime, events, at } = solo();
  const volleys = () =>
    events.filter((e) => e.type === "fired" && e.castleId === 0).length;
  runtime.input(UP | LEFT);
  bench.run(4_500); // the countdown (3 s) and the first reload (1.2 s)
  assert.equal(room(runtime).held.solo, UP | LEFT);
  at(4_620); // log tick 92.4
  assert.ok(runtime.fire());
  at(4_640); // log tick 92.8
  assert.ok(runtime.fire());
  assert.deepEqual(
    runtime.presses().map((e) => [e[1], e[5], e[6]]),
    [
      [93, 1, 1],
      [93, 2, 2],
    ],
    "two taps in one log tick are two presses, on different steps",
  );
  bench.run(200);
  assert.equal(volleys(), 1);
  bench.run(3_000);
  assert.ok(runtime.fire());
  bench.run(200);
  assert.equal(volleys(), 2, "a press one reload later fires again");
});

test("a device that flies nothing logs no controls and spends no gesture", () => {
  const { bench, runtime } = solo();
  const logged = runtime.plays().length;
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.equal(room(runtime).stage, "lobby");
  runtime.input(UP);
  assert.equal(runtime.fire(), false);
  assert.equal(runtime.plays().length, logged);
  assert.deepEqual(runtime.presses(), []);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  assert.ok(runtime.fire());
  assert.equal(runtime.presses()[0]![5], 1, "the first press is gesture 1");
});

test("gesture ordinals only rise, across matches and a resync", () => {
  const { bench, runtime } = solo();
  const seen: [string, number][] = [];
  const press = () => {
    bench.advance(30);
    assert.ok(runtime.fire());
    seen.push([room(runtime).matchId, runtime.presses().at(-1)![5]]);
  };
  press();
  press();
  const first = room(runtime).matchId;
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  assert.notEqual(room(runtime).matchId, first, "a new match");
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
    "each press is scoped to the match it was made in",
  );
  // The stream took them all: none was refused as a reused ordinal.
  assert.deepEqual(
    runtime.presses().map((e) => e[5]),
    [1, 2, 3, 4],
  );
});

test("held directions are logged again in a new match and in the next round", () => {
  const { bench, runtime } = solo();
  const first = room(runtime).matchId;
  runtime.input(UP);
  bench.run(100);
  assert.deepEqual(plays(runtime), [
    [first, 1, 0],
    [first, 1, UP],
  ]);
  assert.ok(runtime.command({ type: "action", action: "lobby" }));
  bench.run(100);
  assert.equal(plays(runtime).length, 2, "nothing in the lobby");
  assert.ok(runtime.command({ type: "action", action: "start" }));
  bench.run(100);
  const second = room(runtime).matchId;
  assert.deepEqual(plays(runtime).at(-1), [second, 1, UP]);
  assert.equal(room(runtime).held.solo, UP, "the new match hears the hold");
  for (let ms = 0; ms < 200_000 && room(runtime).round === 1; ms += 1_000)
    bench.run(1_000);
  assert.equal(room(runtime).round, 2, "the bots play the first round out");
  bench.run(200);
  assert.deepEqual(plays(runtime).at(-1), [second, 2, UP]);
  assert.equal(room(runtime).held.solo, UP, "the next round hears it too");
  runtime.input(0);
  bench.run(100);
  assert.equal(room(runtime).held.solo, undefined);
});

test("held directions are logged again after a resync or an absence made the runtime forget them", () => {
  const { runtime } = solo();
  const { matchId } = room(runtime);
  runtime.input(UP);
  runtime.flush();
  const logged = runtime.plays().length;
  runtime.resync();
  runtime.flush();
  runtime.flush();
  assert.equal(runtime.plays().length, logged + 1, "once");
  runtime.absent();
  runtime.flush();
  assert.deepEqual(plays(runtime).slice(logged - 1), [
    [matchId, 1, UP],
    [matchId, 1, UP],
    [matchId, 1, UP],
  ]);
});

test("a page that hides lets go of its directions, and holds nothing when it is back", () => {
  const { bench, runtime } = solo();
  runtime.input(UP);
  bench.run(200);
  assert.equal(room(runtime).held.solo, UP);
  bench.setHidden(true);
  assert.equal(runtime.plays().at(-1)![5], 0, "released as the page hides");
  assert.equal(room(runtime).held.solo, undefined);
  bench.setHidden(false);
  bench.run(200);
  assert.equal(room(runtime).held.solo, undefined);
  runtime.input(LEFT);
  bench.run(100);
  assert.equal(room(runtime).held.solo, LEFT);
});

test("a press and a change of direction leave in a packet at once, not on the next loop", () => {
  const { bench, runtime, heard, lastPacket } = hosted();
  bench.run(4_500);
  assert.equal(room(runtime).stage, "running");
  const before = heard.length;
  assert.ok(runtime.fire());
  assert.equal(heard.length, before + 1, "sent by the press itself");
  const press = runtime.presses().at(-1)!;
  assert.deepEqual(lastPacket().at(-1), press);
  runtime.input(UP);
  assert.equal(heard.length, before + 2, "sent by the change itself");
  assert.deepEqual(lastPacket().at(-1), runtime.plays().at(-1));
  assert.deepEqual(
    lastPacket().filter((e) => e[2] === PRESS),
    [press],
    "the press goes out again with the next packets, until it is too old to matter",
  );
});

test("a seat that was away has the directions it still holds logged again once it is back", () => {
  const { bench, runtime } = hosted();
  const { matchId, round } = room(runtime);
  runtime.input(UP);
  bench.run(300);
  assert.equal(room(runtime).held.host, UP);
  bench.setHidden(true);
  assert.equal(
    runtime.plays().at(-1)![5],
    0,
    "released before the away entry leaves",
  );
  // A key that reaches the page as it hides is logged, then ignored by every fold: the seat is away from an earlier tick.
  runtime.input(LEFT);
  bench.setHidden(false);
  bench.run(500);
  assert.equal(room(runtime).seats.get("host")!.connected, true, "back");
  assert.equal(room(runtime).round, round);
  assert.deepEqual(
    plays(runtime).slice(-2),
    [
      [matchId, round, LEFT],
      [matchId, round, LEFT],
    ],
    "logged again once the seat was back",
  );
  assert.equal(room(runtime).held.host, LEFT);
});
