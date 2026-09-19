import test from "node:test";
import assert from "node:assert/strict";
import { FakeNetwork, type NetworkOptions } from "./fixtures/fake-room.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";
import { COUNTDOWN_TICKS } from "../src/engine/game.js";
import type { RoomRuntime } from "../src/online/room-runtime.js";
import { TICK_MS } from "fuse-netcode";
import { fuseGame } from "../src/online/fuse-game.js";
import {
  createRoomState,
  hashRoomState,
  successionOrder,
  type RoomState,
} from "../src/engine/apply-tick.js";
import {
  JOIN,
  PRESENCE,
  SPECTATOR,
  STEER,
  type Entry,
} from "../src/engine/input-log.js";

// N4 (#258): hidden tabs under browser timer throttling. Every test here runs the hidden member's tick loop once a second
// (Chrome and Firefox for a background tab), and after a minute hidden once a minute: Chrome's intensive throttling,
// which Chrome starts after five minutes, brought forward so the long case stays cheap (the policy does not depend on
// when it starts). The hidden page's own link health lapses 600 ms after it hides, as `PeerTransport` does. Packets
// and visibility events stay event-driven. Desktop fake timing, not physical-phone evidence.
const settings = { ...defaultRoomSettings(), map: "classic" as const };
const THROTTLED: NetworkOptions = {
  loss: 0.01,
  baseMs: 20,
  jitterMs: 40,
  reliableMs: 30,
  hiddenTickMs: 1000,
  intensiveAfterMs: 60_000,
  intensiveTickMs: 60_000,
};
const HOST = "a-host",
  GUESTS = ["b-guest", "c-guest", "d-guest"];

// A one-round match for the fast phase: once its round is decided the bots stop racing, which keeps the long case cheap.
const oneRound = { ...settings, length: 1 };
function room(riders: number, bots = 0, options = THROTTLED) {
  const net = new FakeNetwork(HOST, options, 7);
  const join = (id: string, name: string) => {
    const runtime = net.add(id, bots ? oneRound : settings, {
      humanName: name,
    });
    runtime.start();
    runtime.command({ type: "join", name });
    return runtime;
  };
  const runtimes = new Map<string, RoomRuntime>();
  runtimes.set(HOST, join(HOST, "Host"));
  net.step(200);
  for (const id of GUESTS.slice(0, riders - 1))
    runtimes.set(id, join(id, id.slice(2)));
  net.step(1500);
  const host = runtimes.get(HOST)!;
  for (let i = 0; i < bots; i++) host.command({ type: "bot", action: "add" });
  net.step(300);
  return { net, host, runtimes };
}
type Room = ReturnType<typeof room>;
const frame = (r: Room, id: string) => r.net.frame(id)!;
const seated = (r: Room, observer: string, id: string) =>
  frame(r, observer).players.find((player) => player.id === id);

/** Step `ms` in 50 ms slices, counting how often `id`'s seat changes presence on `observer`'s screen. */
function watch(r: Room, observer: string, id: string, ms: number) {
  let flips = 0,
    last = seated(r, observer, id)?.connected,
    lost = false;
  const from = frame(r, observer).logTick;
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    r.net.step(50);
    const seat = seated(r, observer, id);
    if (!seat) lost = true;
    if (seat && last !== undefined && seat.connected !== last) flips++;
    last = seat?.connected ?? last;
  }
  return { flips, lost, advanced: frame(r, observer).logTick - from };
}

/** After a return: every member's world within two ticks of the others, nobody fetching, no divergence, and a shared hash. */
function converge(r: Room, ids: string[]) {
  const ready = () => {
    const ticks = ids.map((id) => r.runtimes.get(id)!.metrics().tick);
    return (
      Math.max(...ticks) - Math.min(...ticks) <= 2 &&
      ids.every((id) => !r.runtimes.get(id)!.metrics().snapshotRequest)
    );
  };
  for (let elapsed = 0; elapsed < 15_000 && !ready(); elapsed += 50)
    r.net.step(50);
  assert.ok(
    ready(),
    `worlds converge: ${ids.map((id) => r.runtimes.get(id)!.metrics().tick)}`,
  );
  const since = r.net.now;
  r.net.step(3000);
  for (const id of ids)
    assert.equal(r.runtimes.get(id)!.metrics().mismatches, 0, `${id} agrees`);
  // Hashes each member's own packets reported after the return, at ticks every member reported.
  const reported = ids.map((id) => r.net.reportedHashes.get(id)!);
  const common = [...reported[0]!.keys()].filter(
    (tick) =>
      tick * TICK_MS > since - 60_000 &&
      reported.every((hashes) => hashes.has(tick)),
  );
  const recent = common.filter(
    (tick) => tick >= Math.max(...common) - 100 && tick > 0,
  );
  assert.ok(recent.length > 0, "every member reported a hash after returning");
  for (const tick of recent)
    assert.equal(
      new Set(reported.map((hashes) => hashes.get(tick))).size,
      1,
      `one hash at tick ${tick}`,
    );
}

type Phase = "lobby" | "countdown" | "playing" | "fast";
function enter(r: Room, phase: Phase) {
  if (phase === "lobby") return;
  r.host.command({ type: "action", action: "start" });
  r.net.step(100);
  if (phase === "countdown") {
    assert.equal(frame(r, HOST).phase, "countdown");
    return;
  }
  r.net.step(COUNTDOWN_TICKS * TICK_MS + 200);
  if (phase === "playing") {
    assert.equal(frame(r, HOST).phase, "playing");
    return;
  }
  // Idle riders ride into a wall; the bots steer. Every human dead and a bot alive is the fast phase (§11).
  const fast = () => {
    const now = frame(r, HOST);
    return (
      now.phase === "playing" &&
      now.players.some((p) => p.alive && p.id.startsWith("bot:")) &&
      now.players.every((p) => !p.alive || p.id.startsWith("bot:"))
    );
  };
  for (let i = 0; i < 600 && !fast(); i++) r.net.step(50);
  assert.ok(fast(), "the room reached the bots-only fast phase");
}

// The long case spends a minute at 1 Hz and then over a minute at the once-a-minute cadence.
const DURATIONS = [3000, 30_000, 150_000] as const;
// The fast phase takes a room of bots and a long ride into the walls to reach, so its durations share one room (below).
const PHASES: Phase[] = ["lobby", "countdown", "playing"];
for (const phase of PHASES)
  for (const hiddenMs of DURATIONS)
    test(`a rider hidden ${hiddenMs / 1000} s from the ${phase} keeps a steady seat, the room plays on, and it converges on return`, () => {
      const r = room(3, phase === "fast" ? 2 : 0);
      const hider = GUESTS[0]!;
      enter(r, phase);
      r.net.setHidden(hider, true);
      const seen = watch(r, HOST, hider, hiddenMs);
      assert.equal(
        seen.flips,
        0,
        "the hidden rider's presence never flaps on the host",
      );
      assert.equal(seen.lost, false, "the hidden rider keeps its seat");
      // The visible riders are not held back: the host's world advanced within a second of the wall clock.
      assert.ok(
        seen.advanced >= hiddenMs / TICK_MS - 20,
        `the room plays on: ${seen.advanced} of ${hiddenMs / TICK_MS} ticks`,
      );
      r.net.setHidden(hider, false);
      converge(r, [HOST, ...GUESTS.slice(0, 2)]);
      const back = seated(r, HOST, hider);
      assert.ok(back?.connected, "back and present");
      for (const runtime of r.runtimes.values()) runtime.stop();
    });

test("riders hidden 3 s and 150 s from the bots-only fast phase keep steady seats, the room plays on, and they converge on return", () => {
  // One room for both (reaching the fast phase is the expensive part); the long hide passes the 30 s mark as well.
  const r = room(3, 2);
  enter(r, "fast");
  const hiders: [string, number][] = [
    [GUESTS[0]!, 3000],
    [GUESTS[1]!, 150_000],
  ];
  for (const [id] of hiders) r.net.setHidden(id, true);
  const flips = new Map(hiders.map(([id]) => [id, 0]));
  const last = new Map(
    hiders.map(([id]) => [id, seated(r, HOST, id)?.connected]),
  );
  const from = frame(r, HOST).logTick;
  for (let elapsed = 0; elapsed < 150_000; elapsed += 50) {
    r.net.step(50);
    for (const [id, ms] of hiders) {
      const seat = seated(r, HOST, id);
      assert.ok(seat, `${id} keeps its seat`);
      if (seat.connected !== last.get(id)) flips.set(id, flips.get(id)! + 1);
      last.set(id, seat.connected);
      if (elapsed + 50 === ms) r.net.setHidden(id, false);
    }
  }
  assert.deepEqual([...flips.values()], [0, 0], "no presence flaps");
  assert.ok(
    frame(r, HOST).logTick - from >= 150_000 / TICK_MS - 20,
    "the room played on",
  );
  converge(r, [HOST, ...GUESTS.slice(0, 2)]);
  for (const [id] of hiders)
    assert.ok(seated(r, HOST, id)?.connected, `${id} back and present`);
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("the creator hides, then the acting creator: management moves down the order, and both come back to their seats", () => {
  const r = room(3);
  const [acting, third] = GUESTS as [string, string];
  enter(r, "playing");
  r.net.setHidden(HOST, true);
  const creatorAway = watch(r, acting, HOST, 10_000);
  assert.equal(creatorAway.flips, 0);
  assert.ok(
    creatorAway.advanced >= 180,
    "the room plays on without the creator",
  );
  // A joiner is seated by the acting creator while the creator is hidden.
  const late = "e-late";
  const joiner = r.net.add(late, settings, { humanName: "Late" });
  joiner.start();
  joiner.command({ type: "spectate", name: "Late" });
  r.runtimes.set(late, joiner);
  r.net.setHidden(acting, true);
  const actingAway = watch(r, third, acting, 20_000);
  assert.equal(actingAway.flips, 0);
  assert.ok(actingAway.advanced >= 380, "the room plays on under the third");
  assert.ok(
    frame(r, third).spectators.some((s) => s.id === late),
    "the joiner was admitted while the creator was hidden",
  );
  r.net.setHidden(HOST, false);
  r.net.setHidden(acting, false);
  converge(r, [HOST, acting, third]);
  for (const id of [HOST, acting])
    assert.ok(seated(r, third, id)?.connected, `${id} back in its seat`);
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("two riders hidden at once: the others play on, and both return to their seats", () => {
  const r = room(4);
  enter(r, "playing");
  const [first, second] = GUESTS as [string, string];
  r.net.setHidden(first, true);
  r.net.setHidden(second, true);
  const seen = [first, second].map(() => ({ flips: 0 }));
  const from = frame(r, HOST).logTick;
  let last = [first, second].map((id) => seated(r, HOST, id)?.connected);
  for (let elapsed = 0; elapsed < 30_000; elapsed += 50) {
    r.net.step(50);
    const now = [first, second].map((id) => seated(r, HOST, id)?.connected);
    now.forEach((connected, index) => {
      assert.notEqual(connected, undefined, "both keep their seats");
      if (connected !== last[index]) seen[index]!.flips++;
    });
    last = now;
  }
  assert.deepEqual(
    seen.map((s) => s.flips),
    [0, 0],
  );
  assert.ok(frame(r, HOST).logTick - from >= 580, "the others play on");
  r.net.setHidden(first, false);
  r.net.setHidden(second, false);
  converge(r, [HOST, ...GUESTS]);
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("a sole hidden world holder serves no frozen world: a returning rider waits, then recovers once the holder is back", () => {
  const r = room(2);
  enter(r, "playing");
  const guest = GUESTS[0]!;
  r.runtimes.get(guest)!.stop();
  r.net.setHidden(HOST, true);
  r.net.step(30_000);
  const returning = r.net.reload(guest, settings);
  returning.command({ type: "join", name: "b-guest" });
  r.runtimes.set(guest, returning);
  r.net.step(6000);
  assert.equal(
    r.net.frame(guest),
    undefined,
    "no frozen world was installed from the hidden holder",
  );
  r.net.setHidden(HOST, false);
  converge(r, [HOST, guest]);
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("hiding gains a rider nothing: its rider keeps riding with neutral controls and still takes part in the next round", () => {
  const r = room(3);
  enter(r, "playing");
  const hider = GUESTS[0]!;
  const round = frame(r, HOST).round;
  r.net.setHidden(hider, true);
  // Neutral controls: the rider rides straight into a wall rather than freezing where it was.
  for (let i = 0; i < 600 && seated(r, HOST, hider)?.alive; i++) r.net.step(50);
  assert.equal(
    seated(r, HOST, hider)?.alive,
    false,
    "the hidden rider is not protected",
  );
  for (let i = 0; i < 1200 && frame(r, HOST).round === round; i++)
    r.net.step(50);
  assert.ok(frame(r, HOST).round > round, "the next round started");
  assert.equal(
    seated(r, HOST, hider)?.alive,
    true,
    "an away rider is placed in the next round like everyone else",
  );
  r.net.setHidden(hider, false);
  converge(r, [HOST, ...GUESTS.slice(0, 2)]);
  for (const runtime of r.runtimes.values()) runtime.stop();
});

// ---- the fold: what `PRESENCE` about oneself means on every replica ------------------------------------------------
const step = (
  state: RoomState,
  ticker: ReturnType<typeof fuseGame.createTicker>,
  byMember: Record<string, Entry[]>,
) => {
  const tick = state.tick + 1;
  const streams = new Map(
    Object.entries(byMember).map(([id, entries]) => [
      id,
      {
        generation: 1,
        entries: entries.filter((entry) => entry[1] === tick),
      },
    ]),
  );
  ticker(state, "creator", streams);
};
test("a member's own PRESENCE false steps it away: seat and game place kept, neutral controls, out of succession; its own PRESENCE true brings it back", () => {
  const state = createRoomState("m", settings);
  const ticker = fuseGame.createTicker();
  const log: Record<string, Entry[]> = {
    creator: [
      [1, 1, JOIN, "creator", "Creator", 0, "fox", 1],
      [2, 1, JOIN, "amy", "Amy", 1, "fox", 1],
      [3, 1, JOIN, "bob", "Bob", 2, "fox", 1],
    ],
    amy: [
      [1, 3, PRESENCE, "amy", false, 1],
      // Steering while away is not read: the fold stays neutral.
      [2, 4, STEER, 1],
      [3, 6, PRESENCE, "amy", true, 1],
      [4, 7, STEER, 2],
    ],
    // Nobody else may step a member away, or bring it back: bob is behind amy in the order.
    bob: [[1, 2, PRESENCE, "bob", true, 1]],
  };
  for (let tick = 1; tick <= 2; tick++) step(state, ticker, log);
  assert.deepEqual(successionOrder(state, "creator"), [
    "creator",
    "amy",
    "bob",
  ]);
  step(state, ticker, log); // tick 3: amy steps away
  assert.equal(state.folds.get("amy")!.away, true);
  assert.equal(
    state.game.players.get("amy")!.connected,
    true,
    "present to the game",
  );
  assert.deepEqual(successionOrder(state, "creator"), ["creator", "bob"]);
  const seat = fuseGame.seat(state, "amy")!;
  assert.equal(seat.connected, false, "nothing waits on an away member");
  assert.equal(seat.away, true);
  step(state, ticker, log); // tick 4: its steer is not read
  assert.equal(state.folds.get("amy")!.flags, 0);
  for (let tick = 5; tick <= 6; tick++) step(state, ticker, log);
  assert.equal(state.folds.get("amy")!.away, undefined, "back");
  assert.equal(fuseGame.seat(state, "amy")!.connected, true);
  step(state, ticker, log); // tick 7: read again
  assert.equal(state.folds.get("amy")!.flags, 2);
});

test("an away seat that the manager then logs absent is gone, and only a present member may step away", () => {
  const state = createRoomState("m", settings);
  const ticker = fuseGame.createTicker();
  const log: Record<string, Entry[]> = {
    creator: [
      [1, 1, JOIN, "creator", "Creator", 0, "fox", 1],
      [2, 1, JOIN, "amy", "Amy", 1, "fox", 1],
      [3, 3, PRESENCE, "amy", false, 1],
    ],
    amy: [[1, 2, PRESENCE, "amy", false, 1]],
  };
  for (let tick = 1; tick <= 3; tick++) step(state, ticker, log);
  assert.equal(
    state.folds.get("amy")!.away,
    undefined,
    "the away mark is gone",
  );
  assert.equal(state.game.players.get("amy")!.connected, false, "absent");
  // An absent member's own PRESENCE true is not a return from away: only the manager seats it again.
  log.amy!.push([2, 4, PRESENCE, "amy", true, 1]);
  step(state, ticker, log);
  assert.equal(state.game.players.get("amy")!.connected, false);
});

test("the away mark survives a checkpoint, is refused on a seat the game has absent, and leaves a room nobody left unchanged", () => {
  const state = createRoomState("m", settings);
  const ticker = fuseGame.createTicker();
  const log: Record<string, Entry[]> = {
    creator: [
      [1, 1, JOIN, "creator", "Creator", 0, "fox", 1],
      [2, 1, JOIN, "amy", "Amy", 1, "fox", 1],
      [3, 1, SPECTATOR, "join", "wes", "Wes", 1],
    ],
    amy: [[1, 2, PRESENCE, "amy", false, 1]],
    wes: [[1, 2, PRESENCE, "wes", false, 1]],
  };
  const before = hashRoomState(state);
  for (let tick = 1; tick <= 2; tick++) step(state, ticker, log);
  assert.equal(state.spectators.get("wes")!.away, true);
  const fields = fuseGame.checkpoint.encode(state);
  const decoded = fuseGame.checkpoint.decode(fields, state.tick)!;
  assert.equal(hashRoomState(decoded), hashRoomState(state));
  assert.equal(decoded.folds.get("amy")!.away, true);
  assert.equal(decoded.spectators.get("wes")!.away, true);
  // Away is a mark on a present seat: one on a rider the game has absent is a damaged checkpoint.
  const absent = fuseGame.checkpoint.decode(fields, state.tick)!;
  absent.game.players.get("amy")!.connected = false;
  assert.equal(
    fuseGame.checkpoint.decode(fuseGame.checkpoint.encode(absent), state.tick),
    undefined,
  );
  const badMark = structuredClone(fields);
  (badMark[2] as unknown[][])[1]![5] = 2;
  assert.equal(fuseGame.checkpoint.decode(badMark, state.tick), undefined);
  assert.notEqual(before, hashRoomState(state));
});

// ---- the policy's own failure paths ---------------------------------------------------------------------------------
test("a lost return is logged again: the manager keeps logging it until the seat is back", () => {
  const r = room(3);
  const hider = GUESTS[0]!;
  enter(r, "playing");
  r.net.setHidden(hider, true);
  r.net.step(5000);
  assert.equal(seated(r, HOST, hider)?.connected, true, "away, not absent");
  // A third of everything is lost for the first seconds after the return, the manager's `PRESENCE true` included.
  r.net.options = { ...r.net.options, loss: 0.35 };
  r.net.setHidden(hider, false);
  r.net.step(4000);
  r.net.options = { ...r.net.options, loss: 0.01 };
  converge(r, [HOST, ...GUESTS.slice(0, 2)]);
  assert.ok(
    seated(r, HOST, hider)?.connected,
    "the rider is steering again on every replica",
  );
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("a hidden rider the manager logged absent first steps away on its own, without flapping", () => {
  const r = room(3);
  const hider = GUESTS[0]!;
  // In the lobby, where an absent seat is kept until the next start: silence long enough for the host to log it absent.
  r.net.muted.add(hider);
  r.net.step(2000);
  assert.equal(seated(r, HOST, hider)?.connected, false, "logged absent");
  r.net.setHidden(hider, true);
  r.net.muted.delete(hider);
  r.net.step(8000);
  assert.equal(
    seated(r, HOST, hider)?.connected,
    true,
    "its own entry steps it away, so the room has it present and idle again",
  );
  let flips = 0,
    last = seated(r, HOST, hider)?.connected;
  for (let elapsed = 0; elapsed < 20_000; elapsed += 50) {
    r.net.step(50);
    const seat = seated(r, HOST, hider);
    assert.ok(seat, "the seat is kept");
    if (seat.connected !== last) flips++;
    last = seat.connected;
  }
  assert.equal(flips, 0, "and never flaps again");
  r.net.setHidden(hider, false);
  converge(r, [HOST, ...GUESTS.slice(0, 2)]);
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("an away seat is reclaimed when the room is full and a rider is waiting for a place", () => {
  const r = room(3);
  r.host.command({ type: "bot", action: "add" });
  r.host.command({ type: "bot", action: "add" });
  r.net.step(1000);
  const hider = GUESTS[0]!;
  r.net.setHidden(hider, true);
  r.net.step(3000);
  const late = "e-late";
  const joiner = r.net.add(late, settings, { humanName: "Late" });
  joiner.start();
  joiner.command({ type: "join", name: "Late" });
  r.runtimes.set(late, joiner);
  for (let i = 0; i < 200 && !seated(r, HOST, late); i++) r.net.step(50);
  assert.ok(seated(r, HOST, late), "the joiner took the away rider's place");
  assert.equal(
    seated(r, HOST, hider),
    undefined,
    "a hidden page holds a seat only while nobody else needs it",
  );
  for (const runtime of r.runtimes.values()) runtime.stop();
});

test("nothing but its return applies from an away member, the creator included", () => {
  const state = createRoomState("m", settings);
  const ticker = fuseGame.createTicker();
  const log: Record<string, Entry[]> = {
    creator: [
      [1, 1, JOIN, "creator", "Creator", 0, "fox", 1],
      [2, 1, JOIN, "amy", "Amy", 1, "fox", 1],
      [3, 2, PRESENCE, "creator", false, 1],
      // Away: neither a seat nor a settings change from the creator's stream applies until it logs its return.
      [4, 3, JOIN, "bob", "Bob", 2, "fox", 1],
      [5, 4, PRESENCE, "creator", true, 1],
      [6, 5, JOIN, "bob", "Bob", 2, "fox", 1],
    ],
  };
  for (let tick = 1; tick <= 3; tick++) step(state, ticker, log);
  assert.equal(state.folds.get("creator")!.away, true);
  assert.equal(
    state.game.players.has("bob"),
    false,
    "away, so it seats nobody",
  );
  for (let tick = 4; tick <= 5; tick++) step(state, ticker, log);
  assert.equal(state.folds.get("creator")!.away, undefined);
  assert.ok(state.game.players.has("bob"), "back, and managing again");
});

test("a member the manager logged absent may still step away, and its seat is kept", () => {
  const state = createRoomState("m", settings);
  const ticker = fuseGame.createTicker();
  const log: Record<string, Entry[]> = {
    creator: [
      [1, 1, JOIN, "creator", "Creator", 0, "fox", 1],
      [2, 1, JOIN, "amy", "Amy", 1, "fox", 1],
      [3, 2, PRESENCE, "amy", false, 1],
    ],
    amy: [[1, 3, PRESENCE, "amy", false, 1]],
  };
  for (let tick = 1; tick <= 2; tick++) step(state, ticker, log);
  assert.equal(state.game.players.get("amy")!.connected, false);
  step(state, ticker, log);
  assert.equal(state.folds.get("amy")!.away, true, "away on its own entry");
  assert.equal(
    state.game.players.get("amy")!.connected,
    true,
    "present to the game again: away is not absence",
  );
});

test("an away member whose last peer dies unlogged records that death, comes back and runs the room", () => {
  const r = room(2);
  const host = r.runtimes.get(HOST)!;
  const guest = GUESTS[0]!;
  r.net.setHidden(guest, true);
  r.net.step(3000);
  // The creator's page is gone for good: the runtime stops and the service reports it offline, with nobody present to
  // log either — the away guest is the room.
  host.stop();
  r.net.disconnect(HOST);
  r.net.step(2000);
  r.net.setHidden(guest, false);
  for (
    let elapsed = 0;
    elapsed < 30_000 && seated(r, guest, HOST)?.connected !== false;
    elapsed += 50
  )
    r.net.step(50);
  assert.equal(
    seated(r, guest, HOST)?.connected,
    false,
    "the dead creator is recorded absent by the member that was away",
  );
  // Back and managing: a bot only joins on a manager's entry, and only a present member manages. The return is logged
  // on the first pass after the creator's absence folds, so the command is offered until it takes.
  for (
    let i = 0;
    i < 100 && !frame(r, guest).players.some((p) => p.id.startsWith("bot:"));
    i++
  ) {
    r.runtimes.get(guest)!.command({ type: "bot", action: "add" });
    r.net.step(100);
  }
  assert.equal(
    frame(r, guest).players.filter((p) => p.id.startsWith("bot:")).length,
    1,
    "the rider is back in its seat and the room has a manager again",
  );
  r.runtimes.get(guest)!.stop();
});
