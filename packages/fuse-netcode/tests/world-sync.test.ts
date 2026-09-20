import test from "node:test";
import assert from "node:assert/strict";
// By path, not through the package barrel: `WorldSync` is `RoomRuntime`'s own decomposition, so the barrel exports
// only the types that name `RoomRuntime.sync`. A test inside the package reaches the class directly.
import { WorldSync, type WorldSyncState } from "../src/world-sync.js";
import { SnapshotAssembler } from "../src/snapshot.js";
import type { World } from "../src/rollback.js";
import type { LogEntry, RollbackGame, RoomClock } from "../src/game.js";

type Room = RoomClock;
type Entry = LogEntry;
type View = { tick: number };
type Sync = WorldSync<Room, Entry, View, unknown, unknown>;

/**
 * The state machine reads a tick, the streams' gaps and one hash off its world; nothing here folds, so a stand-in
 * carries exactly those. `hashAt` answers `mine`, which the tests compare against a different authority hash.
 */
const world = (
  tick = 0,
  hash: string | undefined = "mine",
): World<Room, Entry, View, unknown, unknown> =>
  ({
    tick,
    streams: new Map(),
    completeTick: () => tick,
    hashAt: () => hash,
  }) as unknown as World<Room, Entry, View, unknown, unknown>;
const assembler = (): SnapshotAssembler =>
  new SnapshotAssembler(
    { id: "test" } as unknown as RollbackGame<
      Room,
      Entry,
      View,
      unknown,
      unknown
    >,
    0,
  );
const fresh = (): Sync => new WorldSync("test");
const asked = (sync: Sync, to = "peer", at = 0): Sync => {
  sync.requestFrom(to, at, assembler());
  return sync;
};

test("a fresh replica holds no world and asks nobody", () => {
  const sync = fresh();
  assert.equal(sync.state, "NoWorld");
  assert.equal(sync.world, undefined);
  assert.equal(sync.requesting, false);
  assert.equal(sync.diverged, false);
});

test("the world is present in exactly the states that have one", () => {
  const withWorld: WorldSyncState[] = ["Live", "Resyncing", "Diverged"];
  const reach: Record<WorldSyncState, () => Sync> = {
    NoWorld: fresh,
    Requesting: () => asked(fresh()),
    Live: () => {
      const sync = fresh();
      sync.open(world());
      return sync;
    },
    Resyncing: () => {
      const sync = fresh();
      sync.open(world());
      return asked(sync);
    },
    Diverged: () => {
      const sync = fresh();
      sync.open(world());
      for (let miss = 0; miss < 3; miss++)
        sync.compareHash(0, "theirs", miss * 10);
      return sync;
    },
  };
  for (const [at, build] of Object.entries(reach) as [
    WorldSyncState,
    () => Sync,
  ][]) {
    const sync = build();
    assert.equal(sync.state, at, `${at} is reachable`);
    assert.equal(
      sync.world !== undefined,
      withWorld.includes(at),
      `${at} holds a world only if it should`,
    );
  }
});

test("a first fetch goes to Requesting and a fetch over a world goes to Resyncing", () => {
  const first = asked(fresh());
  assert.equal(first.state, "Requesting");
  assert.equal(first.request?.to, "peer");
  const resync = fresh();
  resync.open(world());
  asked(resync);
  assert.equal(resync.state, "Resyncing");
  assert.equal(resync.world !== undefined, true, "the world keeps simulating");
});

test("a retry rotating round the holders keeps the failure count", () => {
  const sync = asked(fresh(), "first");
  sync.request!.failures = 2;
  asked(sync, "second", 100);
  assert.equal(sync.state, "Requesting");
  assert.equal(sync.request?.to, "second");
  assert.equal(sync.request?.failures, 2, "the count carries to the next peer");
});

test("a snapshot that fails validation keeps the peer, counts the failure and waits for the timer", () => {
  const sync = asked(fresh(), "peer", 0);
  const before = sync.request!.assembler;
  sync.restartAssembly(500, assembler());
  assert.equal(sync.state, "Requesting");
  assert.equal(sync.request?.to, "peer", "the same peer is asked again");
  assert.equal(sync.request?.failures, 1);
  assert.equal(sync.request?.at, 500, "the retry timer restarts");
  assert.notEqual(sync.request?.assembler, before, "a fresh assembler");
});

test("abandoning a fetch falls back to whatever world the replica already had", () => {
  const first = asked(fresh());
  first.abandonRequest();
  assert.equal(first.state, "NoWorld");
  const resync = fresh();
  resync.open(world());
  asked(resync);
  resync.abandonRequest();
  assert.equal(resync.state, "Live");
  assert.equal(resync.requesting, false);
  assert.notEqual(resync.world, undefined, "the world it had is untouched");
});

test("installing a snapshot ends the fetch from either state", () => {
  const first = asked(fresh());
  first.installed(world(7));
  assert.equal(first.state, "Live");
  assert.equal(first.requesting, false);
  assert.equal(first.world?.tick, 7);
});

test("divergence latches on the third mismatch inside the window and absorbs every later transition", () => {
  const sync = fresh();
  sync.open(world());
  assert.equal(sync.compareHash(0, "theirs", 0), "resync");
  assert.equal(sync.compareHash(0, "theirs", 10), "resync");
  assert.equal(sync.state, "Live", "two misses still resync");
  assert.equal(sync.compareHash(0, "theirs", 20), "diverged");
  assert.equal(sync.state, "Diverged");
  assert.equal(sync.mismatchCount, 3);
  // A diverged replica still fetches when a gap or a backlog demands one, and installing does not clear the latch.
  asked(sync, "peer", 30);
  assert.equal(sync.state, "Diverged");
  assert.equal(sync.requesting, true, "Diverged carries the optional request");
  sync.installed(world(9));
  assert.equal(sync.state, "Diverged", "nothing clears the latch today");
  assert.equal(sync.requesting, false);
  sync.abandonRequest();
  assert.equal(sync.state, "Diverged");
});

test("mismatches older than the window do not count toward the limit", () => {
  const sync = fresh();
  sync.open(world());
  assert.equal(sync.compareHash(0, "theirs", 0), "resync");
  assert.equal(sync.compareHash(0, "theirs", 10), "resync");
  assert.equal(
    sync.compareHash(0, "theirs", 60_001 + 10),
    "resync",
    "the first two aged out",
  );
  assert.equal(sync.state, "Live");
  assert.equal(sync.mismatchCount, 1);
});

test("a hash with nothing to compare against is not a mismatch and is not counted", () => {
  const sync = fresh();
  assert.equal(sync.compareHash(0, "theirs", 0), "unknown", "no world");
  assert.equal(sync.hashChecks, 0);
  sync.open(world());
  assert.equal(sync.compareHash(5, "theirs", 0), "unknown", "not folded yet");
  assert.equal(sync.hashChecks, 0);
  assert.equal(sync.mismatchCount, 0);
});

test("opening a world over one the replica already holds throws instead of half-resetting it", () => {
  const sync = fresh();
  sync.open(world(3));
  assert.throws(
    () => sync.open(world(0)),
    /sync state was Live/,
    "a silent return would leave the old world in place while the caller reset everything around it",
  );
  assert.equal(sync.world?.tick, 3, "the world it had is untouched");
});

test("peers that answered with no world are asked again once the retry interval has passed", () => {
  const sync = fresh();
  assert.equal(sync.saidNoWorld("peer", 0, 2000), false);
  sync.noteNoWorld("peer", 0);
  assert.equal(sync.saidNoWorld("peer", 1999, 2000), true);
  assert.equal(sync.saidNoWorld("peer", 2000, 2000), false, "the answer aged");
  sync.noteNoWorld("peer", 3000);
  sync.forgetNoWorld("peer");
  assert.equal(sync.saidNoWorld("peer", 3000, 2000), false);
  sync.noteNoWorld("other", 4000);
  sync.clearNoWorld();
  assert.equal(sync.saidNoWorld("other", 4000, 2000), false);
});

test("a resync that brought nothing newer holds the replica on catch-up until the hold expires", () => {
  const sync = fresh();
  assert.equal(sync.mayFetchBacklog(0), true);
  sync.holdCatchUp(10_000);
  assert.equal(sync.mayFetchBacklog(9_999), false);
  assert.equal(sync.mayFetchBacklog(10_000), true);
  sync.holdCatchUp(20_000);
  sync.releaseCatchUp();
  assert.equal(sync.mayFetchBacklog(0), true);
});

test("behind counts the backlog in steps, and a replica with no world is never behind", () => {
  const sync = fresh();
  assert.equal(sync.behind(1000, 3, 400), false, "nothing to be behind");
  sync.open(world(100));
  assert.equal(sync.behind(200, 1, 400), false, "100 ticks at one step");
  assert.equal(sync.behind(600, 1, 400), true);
  assert.equal(sync.behind(250, 3, 400), true, "150 ticks at three steps");
});
