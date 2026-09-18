import test from "node:test";
import assert from "node:assert/strict";
import {
  BUFFERED_ENTRIES,
  FUTURE_TICKS,
  PACKET_ENTRIES,
  RETAINED_ENTRIES,
  ROLLBACK_TICKS,
  SEQ_AHEAD,
  StreamLog,
} from "fuse-netcode";
import { fuseGame } from "../src/online/fuse-game.js";
import { PRESS, RELEASE, STEER, type Entry } from "../src/engine/input-log.js";

const e = (seq: number, tick: number, ...body: unknown[]): Entry =>
  [seq, tick, ...body] as Entry;

test("own stream appends contiguous entries with increasing gestures and rejects order violations", () => {
  const own = new StreamLog(fuseGame, 1);
  assert.deepEqual(own.append(5, [STEER, 1]), [1, 5, STEER, 1]);
  own.append(5, [PRESS, 1]);
  own.append(7, [RELEASE, 1]);
  assert.equal(own.lastSeq, 3);
  assert.equal(own.contiguous, 3);
  assert.equal(own.latestTick(), 7);
  assert.equal(own.latestOrdinal(), 1);
  assert.throws(() => own.append(6, [STEER, 0]), /Invalid own entry/);
  assert.throws(() => own.append(7, [PRESS, 1]), /Reused ordinal/);
  assert.throws(() => own.append(7, [STEER, 9]), /Invalid own entry/);
  assert.deepEqual(
    own.entriesAt(5).map((entry) => entry[0]),
    [1, 2],
  );
  assert.equal(own.gap, false);
  assert.equal(own.firstMissing(), undefined);
});

test("remote stream applies in seq order, buffers gaps, reports the first missing seq and rolls back to a late tick", () => {
  const remote = new StreamLog(fuseGame, 1);
  assert.deepEqual(remote.receive([e(2, 12, STEER, 2)], 2, 12, 20, 20), {
    status: "accepted",
    added: [],
  });
  assert.equal(remote.firstMissing(), 1);
  assert.equal(remote.gap, true);
  assert.deepEqual(remote.entriesAt(12), []);
  assert.equal(
    remote.completeThrough(),
    11,
    "a gap caps completeness before the first waiting entry",
  );
  const repaired = remote.receive([e(1, 10, STEER, 1)], 2, 12, 20, 20);
  assert.deepEqual(repaired, {
    status: "accepted",
    added: [e(1, 10, STEER, 1), e(2, 12, STEER, 2)],
    rollbackTo: 10,
  });
  assert.equal(remote.gap, false);
  assert.equal(remote.through, 12);
  assert.deepEqual(remote.entriesAt(12), [e(2, 12, STEER, 2)]);
  assert.deepEqual(
    remote.receive([e(3, 25, STEER, 0)], 3, 24, 20, 20),
    { status: "accepted", added: [e(3, 25, STEER, 0)] },
    "a future entry needs no rollback",
  );
  assert.deepEqual(
    remote.receive([e(3, 25, STEER, 0)], 3, 30, 20, 20).added,
    [],
    "duplicates are harmless",
  );
  assert.equal(remote.through, 30);
  assert.deepEqual(
    remote.receive([e(1, 10, STEER, 1)], 3, 30, 20, 25),
    { status: "accepted", added: [] },
    "a resend of a pruned or applied entry is ignored",
  );
});

test("a whole packet is rejected on any invalid entry and nothing changes", () => {
  const remote = new StreamLog(fuseGame, 1);
  remote.receive([e(1, 10, STEER, 1), e(2, 11, PRESS, 3)], 2, 11, 12, 12);
  const before = JSON.stringify([...remote.entries]);
  const bad: [unknown[], number, number][] = [
    [[e(3, 12, STEER, 0), e(4, 12, STEER, 5)], 4, 12],
    [[e(3, 9, STEER, 0)], 3, 12],
    [[e(5, 12, STEER, 0)], 4, 12],
    [[e(3, 12 + FUTURE_TICKS + 1, STEER, 0)], 3, 12],
    [[e(3, 12, PRESS, 3)], 3, 12],
    [[e(3, 12, PRESS, 2)], 3, 12],
    [[e(1, 10, STEER, 3)], 3, 12],
    [[e(4, 12, STEER, 0), e(3, 13, STEER, 0)], 4, 13],
    [[e(3, 13, PRESS, 5), e(4, 14, PRESS, 4)], 4, 14],
    [["nope"], 3, 12],
    [[e(3, 12, STEER, 0)], -1, 12],
    [[e(3, 12, STEER, 0)], 3, 1.5],
    [
      Array.from({ length: PACKET_ENTRIES + 1 }, (_, i) =>
        e(3 + i, 12, STEER, 0),
      ),
      20,
      12,
    ],
  ];
  for (const [entries, lastSeq, through] of bad) {
    const result = remote.receive(entries, lastSeq, through, 12, 12);
    assert.equal(result.status, "invalid", JSON.stringify(entries));
    // Only a tick beyond this replica's own clock is something an honest packet can be refused for here.
    assert.equal(
      result.refusal,
      JSON.stringify(entries).includes(String(12 + FUTURE_TICKS + 1))
        ? "window"
        : "violation",
      JSON.stringify(entries),
    );
    assert.equal(JSON.stringify([...remote.entries]), before);
  }
  assert.equal(
    remote.receive(e(3, 12, STEER, 0) as unknown as unknown[], 3, 12, 12, 12)
      .status,
    "invalid",
  );
  const flood = new StreamLog(fuseGame, 1);
  let seq = 2,
    status = "accepted";
  let refusal: string | undefined;
  while (status === "accepted" && seq < BUFFERED_ENTRIES + 10) {
    ({ status, refusal } = flood.receive([e(seq, 5, STEER, 0)], seq, 4, 5, 5));
    seq++;
  }
  assert.equal(status, "invalid");
  assert.equal(refusal, "window", "a full buffer is this replica's limit");
  assert.equal(seq, BUFFERED_ENTRIES + 3, "and it is the buffer that refused");
  assert.ok(flood.entries.size <= BUFFERED_ENTRIES);
});

test("entries behind the rollback window or the snapshot base are unrepairable and leave the stream waiting for a snapshot", () => {
  const remote = new StreamLog(fuseGame, 1);
  assert.equal(
    remote.receive([e(1, 5, STEER, 1)], 1, 5, 100, 100).status,
    "unrepairable",
  );
  const based = new StreamLog(fuseGame, 3, { seq: 4, tick: 50, ordinal: 2 });
  assert.equal(
    based.receive([e(5, 49, STEER, 1)], 5, 50, 60, 60).status,
    "unrepairable",
    "below the base tick",
  );
  assert.equal(
    based.receive([e(5, 50, STEER, 1)], 5, 50, 60, 60).status,
    "unrepairable",
    "at the base tick is already folded in",
  );
  assert.equal(
    based.receive([e(6, 51, STEER, 0)], 6, 51, 60, 60).status,
    "accepted",
  );
  assert.equal(
    based.gap,
    true,
    "the stale entry is not committed; only a fresh snapshot resolves it",
  );
  assert.equal(based.firstMissing(), 5);
  const fresh = new StreamLog(fuseGame, 3, { seq: 4, tick: 50, ordinal: 2 });
  assert.equal(
    fresh.receive([e(5, 51, PRESS, 2)], 5, 51, 60, 60).status,
    "invalid",
    "gesture below the base gesture",
  );
  assert.deepEqual(fresh.receive([e(5, 51, PRESS, 3)], 5, 51, 60, 60), {
    status: "accepted",
    added: [e(5, 51, PRESS, 3)],
    rollbackTo: 51,
  });
  assert.equal(fresh.latestOrdinal(), 3);
  assert.equal(
    new StreamLog(fuseGame, 3, { seq: 4, tick: 50 }).entriesAfter(4, 50).length,
    0,
  );
});

test("retention keeps the newest 64 or two seconds, rotates every entry through packets and answers nacks", () => {
  const own = new StreamLog(fuseGame, 1);
  for (let seq = 1; seq <= 100; seq++) own.append(seq, [STEER, seq % 4]);
  own.through = 100;
  assert.equal(own.retained().length, ROLLBACK_TICKS, "two seconds of ticks");
  for (let seq = 101; seq <= 200; seq++) own.append(100, [RELEASE, seq]);
  assert.equal(own.retained().length, RETAINED_ENTRIES);
  const seen = new Set<number>();
  for (let packets = 0; packets < 30; packets++) {
    const entries = own.packetEntries();
    assert.equal(entries.length, PACKET_ENTRIES);
    assert.ok(entries.some((entry) => entry[0] === 200));
    for (const entry of entries) seen.add(entry[0]);
  }
  assert.equal(
    seen.size,
    RETAINED_ENTRIES,
    "every retained entry recurs within a few packets",
  );
  assert.deepEqual(
    own.repairEntries(150).map((entry) => entry[0]),
    [150, 151, 152, 153, 154, 155],
  );
  assert.deepEqual(
    own.repairEntries(199).map((entry) => entry[0]),
    [199, 200],
  );
  assert.deepEqual(
    own.repairEntries(10),
    [],
    "older than the window cannot be repaired",
  );
  own.prune(100);
  assert.equal(own.entries.size, 0);
  const small = new StreamLog(fuseGame, 1);
  small.append(1, [STEER, 1]);
  small.append(2, [STEER, 0]);
  assert.deepEqual(
    small.packetEntries().map((entry) => entry[0]),
    [1, 2],
  );
});

test("snapshot bases exclude entries after the snapshot tick and replay everything after the base", () => {
  const remote = new StreamLog(fuseGame, 2);
  remote.receive(
    [
      e(1, 10, PRESS, 1),
      e(2, 12, RELEASE, 1),
      e(3, 14, PRESS, 2),
      e(5, 16, STEER, 1),
    ],
    5,
    16,
    20,
    20,
  );
  assert.deepEqual(remote.baseAt(13), { seq: 2, tick: 13, ordinal: 1 });
  assert.deepEqual(
    remote.entriesAfter(2).map((entry) => entry[0]),
    [3, 5],
  );
  remote.prune(12);
  assert.deepEqual(remote.baseAt(13), { seq: 2, tick: 13, ordinal: 1 });
  assert.deepEqual(
    remote.baseAt(20),
    { seq: 5, tick: 20, ordinal: 2 },
    "a base past the gap folds the waiting entry by absence: the served world never applied seq 4 or 5",
  );
});

test("a snapshot base at an earlier tick excludes presses appended for later ticks, and pruned presses raise it", () => {
  const own = new StreamLog(fuseGame, 1);
  own.append(60, [STEER, 1]);
  own.append(76, [PRESS, 1]);
  own.append(77, [RELEASE, 1]);
  assert.deepEqual(
    own.baseAt(64),
    { seq: 1, tick: 64, ordinal: 0 },
    "the press at 76 is after the base",
  );
  assert.equal(own.baseAt(76).ordinal, 1);
  const replica = new StreamLog(fuseGame, 1, own.baseAt(64));
  assert.equal(
    replica.receive(own.entriesAfter(1, 64), 3, 80, 80, 64).status,
    "accepted",
    "the replayed press is not a reused gesture",
  );
  own.through = 80;
  own.prune(76);
  assert.equal(
    own.baseAt(78).ordinal,
    1,
    "a pruned press still counts for later bases",
  );
});

test("confirmed completeness stops at the last contiguous entry when a gap hides where the missing entry belongs", () => {
  const remote = new StreamLog(fuseGame, 1);
  assert.equal(
    remote.receive([e(1, 50, STEER, 1)], 1, 60, 60, 60).status,
    "accepted",
  );
  assert.equal(
    remote.receive([e(3, 80, STEER, 0)], 3, 90, 90, 90).status,
    "accepted",
  );
  assert.equal(
    remote.completeThrough(),
    79,
    "the stall rule may still run up to the buffered entry",
  );
  assert.equal(
    remote.confirmedThrough(),
    60,
    "but only what the gap-free packet confirmed is final: seq 2 may sit anywhere from 61 to 80",
  );
  const sameTick = new StreamLog(fuseGame, 1);
  sameTick.receive([e(1, 72, STEER, 1), e(3, 80, STEER, 0)], 3, 90, 90, 90);
  assert.equal(
    sameTick.confirmedThrough(),
    71,
    "a missing entry may share the last contiguous entry's tick",
  );
  assert.equal(
    remote.receive([e(2, 70, STEER, 2)], 3, 90, 90, 90).status,
    "accepted",
  );
  assert.equal(remote.confirmedThrough(), 90);
});

test("a declared through is a promise about every later seq: a new entry at or below it is refused, a repeat is not", () => {
  const remote = new StreamLog(fuseGame, 1);
  // The entry rides with the packet that declares it: `through` may already have reached its tick.
  assert.equal(
    remote.receive([e(1, 10, STEER, 1)], 1, 10, 10, 10).status,
    "accepted",
  );
  assert.equal(remote.receive([], 1, 50, 50, 50).status, "accepted");
  const before = JSON.stringify([...remote.entries]);
  for (const tick of [10, 30, 50]) {
    assert.equal(
      remote.receive([e(2, tick, STEER, 2)], 2, 50, 50, 50).status,
      "invalid",
      `seq 2 at tick ${tick} after "nothing after seq 1 at or before 50"`,
    );
    assert.equal(JSON.stringify([...remote.entries]), before);
    assert.equal(remote.lastSeq, 1, "a refused packet declares nothing");
    assert.equal(remote.gap, false);
  }
  assert.equal(
    remote.receive([e(1, 10, STEER, 1)], 1, 50, 50, 50).status,
    "accepted",
    "a retransmitted entry below through is a harmless repeat",
  );
  assert.deepEqual(remote.receive([e(2, 51, STEER, 2)], 2, 51, 51, 51), {
    status: "accepted",
    added: [e(2, 51, STEER, 2)],
    rollbackTo: 51,
  });
  assert.equal(remote.confirmedThrough(), 51);
});

test("promises survive reordering: a later packet may overtake the one carrying entries below its through", () => {
  const remote = new StreamLog(fuseGame, 1);
  // Sent first: seq 1–2 up to tick 12. Sent second: seq 3 at tick 20, through 25. They arrive the other way round.
  assert.equal(
    remote.receive([e(3, 20, STEER, 0)], 3, 25, 25, 25).status,
    "accepted",
  );
  assert.equal(remote.gap, true);
  assert.deepEqual(
    remote.receive([e(1, 10, STEER, 1), e(2, 12, STEER, 2)], 2, 12, 25, 25)
      .added,
    [e(1, 10, STEER, 1), e(2, 12, STEER, 2), e(3, 20, STEER, 0)],
    "entries at or before tick 25 were all issued by seq 3, which the promise names",
  );
  assert.equal(remote.confirmedThrough(), 25);
  assert.equal(
    remote.receive([e(4, 25, STEER, 1)], 4, 26, 26, 26).status,
    "invalid",
    "once the prefix reaches seq 3 the promise binds everything after it",
  );
  // A promise made past a gap binds only the seqs after the one it names.
  const gapped = new StreamLog(fuseGame, 1);
  gapped.receive([e(1, 10, STEER, 1)], 1, 10, 10, 10);
  assert.equal(gapped.receive([], 3, 40, 40, 40).status, "accepted");
  assert.equal(
    gapped.receive([e(4, 40, STEER, 0)], 4, 41, 41, 41).status,
    "invalid",
  );
  assert.equal(
    gapped.receive([e(2, 20, STEER, 2), e(3, 30, STEER, 3)], 3, 40, 41, 41)
      .status,
    "accepted",
    "seq 2 and 3 were issued before the promise and may sit anywhere up to it",
  );
  assert.equal(
    gapped.receive([e(4, 40, STEER, 0)], 4, 41, 41, 41).status,
    "invalid",
  );
  assert.equal(
    gapped.receive([e(4, 41, STEER, 0)], 4, 41, 41, 41).status,
    "accepted",
  );
});

test("a lastSeq further ahead than any repair could close is refused and opens no gap", () => {
  const remote = new StreamLog(fuseGame, 1);
  remote.receive([e(1, 10, STEER, 1)], 1, 10, 10, 10);
  assert.equal(remote.ahead, false);
  assert.deepEqual(remote.receive([], 1 + SEQ_AHEAD + 1, 11, 11, 11), {
    status: "invalid",
    added: [],
    refusal: "window",
  });
  assert.equal(remote.receive([], 0xffff_ffff, 11, 11, 11).status, "invalid");
  assert.equal(remote.gap, false);
  assert.equal(remote.lastSeq, 1);
  assert.equal(remote.through, 10, "nothing from a refused packet is kept");
  assert.equal(
    remote.ahead,
    true,
    "but the stream says its owner is out of reach, so the replica can resync",
  );
  assert.equal(
    remote.receive([e(2, 9, STEER, 0)], 2, 11, 11, 11).refusal,
    "violation",
  );
  assert.equal(remote.ahead, true, "only a packet that is taken clears it");
  assert.equal(remote.receive([], 1, 11, 11, 11).status, "accepted");
  assert.equal(remote.ahead, false);
  assert.equal(
    remote.receive([], 1 + SEQ_AHEAD, 11, 11, 11).status,
    "accepted",
  );
  assert.equal(remote.gap, true);
});

/** One owner, one replica and a seeded link that loses, duplicates and reorders; `lookahead` makes the owner declare itself complete that many ticks ahead of its clock. */
function lossyStream(seed: number, lookahead: number) {
  let a = seed * 0x9e3779b9;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const own = new StreamLog(fuseGame, 1),
    remote = new StreamLog(fuseGame, 1);
  interface Delivery {
    at: number;
    entries: Entry[];
    lastSeq: number;
    through: number;
  }
  let queue: Delivery[] = [],
    gesture = 0,
    folded = 0,
    refused = 0;
  const send = (entries: Entry[], now: number) => {
    if (random() < 0.3) return;
    const packet = {
      entries,
      lastSeq: own.lastSeq,
      through: own.through + lookahead,
    };
    queue.push({ at: now + 1 + Math.floor(random() * 12), ...packet });
    if (random() < 0.3)
      queue.push({ at: now + 1 + Math.floor(random() * 12), ...packet });
  };
  for (let now = 1; now <= 1200; now++) {
    // Bursts and silences: through keeps advancing over idle stretches, so promises run far ahead of the last entry.
    const busy = Math.floor(now / 100) % 2 === 0;
    if (busy && random() < 0.5)
      own.append(now + 1, [STEER, Math.floor(random() * 4)]);
    if (busy && random() < 0.1) {
      own.append(now + 1, [PRESS, ++gesture]);
      if (random() < 0.5) own.append(now + 2, [RELEASE, gesture]);
    }
    own.through = Math.max(own.through, now);
    send(own.packetEntries(), now);
    const missing = remote.firstMissing();
    if (missing !== undefined && random() < 0.5)
      send(own.repairEntries(missing), now);
    const due = queue
      .filter((item) => item.at <= now)
      .sort(() => random() - 0.5);
    queue = queue.filter((item) => item.at > now);
    for (const packet of due) {
      const confirmed = remote.confirmedThrough();
      const result = remote.receive(
        packet.entries,
        packet.lastSeq,
        packet.through,
        now,
        now,
      );
      if (result.status === "invalid") refused++;
      for (const entry of result.added)
        assert.ok(
          entry[1] > confirmed,
          `seed ${seed}: seq ${entry[0]} at tick ${entry[1]} landed at or before confirmed tick ${confirmed}`,
        );
      folded += result.added.length;
    }
    remote.prune(now - 48);
    own.prune(now - 48);
  }
  return { folded, refused, issued: own.lastSeq };
}

test("an honest stream never trips the promise or the seq bound under seeded loss, duplication and reordering", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { folded, refused, issued } = lossyStream(seed, 0);
    assert.equal(refused, 0, `seed ${seed}`);
    assert.ok(folded > 0.9 * issued, `seed ${seed}: ${folded} of ${issued}`);
  }
});

test("an owner that declares itself complete two seconds ahead cannot land an entry in a tick a replica holds confirmed", () => {
  for (const seed of [1, 2, 3]) {
    // The harness asserts that no folded entry is stamped at or before the replica's confirmed tick.
    const { refused } = lossyStream(seed, ROLLBACK_TICKS);
    assert.ok(refused > 0, `seed ${seed}`);
  }
});
