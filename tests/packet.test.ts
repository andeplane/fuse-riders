import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PACKET_BYTES,
  MAX_PACKET_ENTRIES,
  decodePacket,
  encodeNack,
  encodePacket,
  packMessage,
  roomHash,
  unpackMessage,
  wrapDelta,
  wrapMs,
  type Packet,
} from "../src/online/packet.js";
import { PRESS, RELEASE, STEER, type Entry } from "../src/shared/input-log.js";

const packet = (): Packet => ({
  room: roomHash("AB42:host"),
  from: "abcdef",
  generation: 3,
  through: 120,
  lastSeq: 9,
  entries: [
    [8, 121, STEER, 1],
    [9, 121, PRESS, 4],
  ],
  sentAt: 123456,
  echoSentAt: 120000,
  echoHeld: 12,
  clockTick: 120.4,
  hash: [80, "deadbeefcafebabe"],
});

test("packets and nacks round-trip through MessagePack within the byte budget", () => {
  const bytes = encodePacket(packet());
  assert.ok(
    bytes.byteLength < 120,
    `${bytes.byteLength} bytes for two entries`,
  );
  assert.deepEqual(decodePacket(bytes), { packet: packet() });
  const six: Entry[] = Array.from(
    { length: MAX_PACKET_ENTRIES },
    (_, i) => [i + 1, 100 + i, i % 2 ? PRESS : RELEASE, i + 1] as Entry,
  );
  const full = encodePacket({ ...packet(), entries: six, hash: null });
  assert.ok(full.byteLength < 140);
  const nack = encodeNack({ room: 7, from: "abcdef", firstMissingSeq: 4 });
  assert.ok(nack.byteLength < 16);
  assert.deepEqual(decodePacket(nack), {
    nack: { room: 7, from: "abcdef", firstMissingSeq: 4 },
  });
  assert.throws(
    () =>
      encodePacket({
        ...packet(),
        entries: Array.from(
          { length: MAX_PACKET_ENTRIES + 1 },
          (_, i) => [i + 1, 100, STEER, 0] as Entry,
        ),
      }),
    /Too many/,
  );
  assert.throws(
    () => encodePacket({ ...packet(), from: "x".repeat(1200) }),
    /too large/,
  );
  assert.equal(roomHash("a"), roomHash("a"));
  assert.notEqual(roomHash("a"), roomHash("b"));
  assert.ok(roomHash("anything") <= 0xffff_ffff);
  assert.equal(wrapMs(4294967295.4), 4294967295);
  assert.equal(wrapMs(4294967296), 0);
  assert.equal(wrapDelta(5, 4294967290), 11);
  assert.equal(wrapDelta(10, 40), -30);
});

test("malformed, oversized and out-of-range packets decode to nothing", () => {
  const good = packet();
  const variants: unknown[] = [
    [2, 7, "abcdef", 0],
    [2, 7, "abcdef"],
    [2, -1, "abcdef", 4],
    [3, 7, "a", 1],
    "text",
    12,
    null,
    [],
    [
      1,
      good.room,
      good.from,
      good.generation,
      good.through,
      good.lastSeq,
      good.entries,
      good.sentAt,
      good.echoSentAt,
      good.echoHeld,
      good.clockTick,
    ], // short
    [1, "room", good.from, 3, 120, 9, [], 1, 0, 0, 1, null],
    [1, 5, "", 3, 120, 9, [], 1, 0, 0, 1, null],
    [1, 5, "x", 3.5, 120, 9, [], 1, 0, 0, 1, null],
    [1, 5, "x", 3, 120, 9, [[1, 2, 99, 0]], 1, 0, 0, 1, null],
    [1, 5, "x", 3, 120, 9, [[1, 2, 1, 65535, 0]], 1, 0, 0, 1, null], // retired aim kind
    [1, 5, "x", 3, 120, 9, [[1, 2, RELEASE, 1, 65535, 0]], 1, 0, 0, 1, null], // retired release-with-aim form
    [1, 5, "x", 3, 120, 9, "entries", 1, 0, 0, 1, null],
    [1, 5, "x", 3, 120, 9, [], -1, 0, 0, 1, null],
    [1, 5, "x", 3, 120, 9, [], 1, 0, 0, NaN, null],
    [1, 5, "x", 3, 120, 9, [], 1, 0, 0, -2, null],
    [1, 5, "x", 3, 120, 9, [], 1, 0, 0, 1, "hash"],
    [1, 5, "x", 3, 120, 9, [], 1, 0, 0, 1, [1, "zz"]],
    [1, 5, "x", 3, 120, 9, [], 1, 0, 0, 1, [1, "deadbeefcafebabe", 2]],
    [
      1,
      5,
      "x",
      3,
      120,
      9,
      Array.from({ length: 7 }, (_, i) => [i + 1, 5, STEER, 0]),
      1,
      0,
      0,
      1,
      null,
    ],
  ];
  for (const variant of variants)
    assert.equal(
      decodePacket(packMessage(variant)),
      undefined,
      JSON.stringify(variant),
    );
  assert.equal(decodePacket(new Uint8Array(MAX_PACKET_BYTES + 1)), undefined);
  assert.equal(
    decodePacket(new Uint8Array([0xc1])),
    undefined,
    "reserved MessagePack byte",
  );
  assert.equal(
    decodePacket(new Uint8Array([0xdd, 0xff, 0xff, 0xff, 0xff])),
    undefined,
    "a header claiming four billion elements allocates nothing",
  );
});

test("bounded unpack rejects deep nesting, oversized collections, binary, extensions and trailing bytes", () => {
  assert.deepEqual(
    unpackMessage(
      packMessage([1, "a", [2, [3]], { k: 1 }, null, true, 1.5, -7]),
    ),
    [1, "a", [2, [3]], { k: 1 }, null, true, 1.5, -7],
  );
  assert.throws(
    () =>
      unpackMessage(
        new Uint8Array([...Array.from({ length: 40 }, () => 0x91), 0x00]),
      ),
    /complexity/,
  );
  assert.throws(
    () => unpackMessage(packMessage(Array.from({ length: 5000 }, () => 0))),
    /Collection limit/,
  );
  assert.throws(
    () =>
      unpackMessage(
        packMessage(
          Object.fromEntries(
            Array.from({ length: 100 }, (_, i) => [`k${i}`, i]),
          ),
        ),
      ),
    /Collection limit/,
  );
  assert.throws(
    () => unpackMessage(new Uint8Array([0xc4, 1, 0])),
    /Unsupported/,
  );
  assert.throws(
    () => unpackMessage(new Uint8Array([0xd4, 1, 0])),
    /Unsupported/,
  );
  assert.throws(() => unpackMessage(new Uint8Array([0x01, 0x02])), /Trailing/);
  assert.throws(() => unpackMessage(new Uint8Array([0x91])), /Truncated/);
  assert.throws(() => unpackMessage(new Uint8Array(2_000_001)), /too large/);
  const wide = packMessage(
    Array.from({ length: 60 }, () => Array.from({ length: 4000 }, () => 0)),
  );
  assert.throws(() => unpackMessage(wide), /Allocation limit/);
  assert.equal(typeof unpackMessage(packMessage("x".repeat(40))), "string");
  assert.equal(unpackMessage(packMessage("y".repeat(300))), "y".repeat(300));
  assert.equal(
    unpackMessage(packMessage("z".repeat(70000))),
    "z".repeat(70000),
  );
  assert.deepEqual(
    unpackMessage(
      packMessage([2 ** 40, -(2 ** 40), 3.25, 200, 70000, -200, -70000, 4e9]),
    ),
    [2 ** 40, -(2 ** 40), 3.25, 200, 70000, -200, -70000, 4e9],
  );
  assert.deepEqual(
    unpackMessage(packMessage(Array.from({ length: 20 }, (_, i) => `s${i}`))),
    Array.from({ length: 20 }, (_, i) => `s${i}`),
  );
  assert.deepEqual(
    unpackMessage(
      packMessage(
        Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])),
      ),
    ),
    Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])),
  );
});

import { encodePacketTrimmed } from "../src/online/packet.js";
import { SETTINGS } from "../src/shared/input-log.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
test("a settings entry travels in a packet, and an oversized packet is trimmed from its oldest entries", () => {
  const settingsEntry = [9, 120, SETTINGS, defaultRoomSettings()] as Entry;
  const bytes = encodePacket({ ...packet(), entries: [settingsEntry] });
  assert.ok(bytes.byteLength < 400, `${bytes.byteLength} bytes`);
  assert.deepEqual((decodePacket(bytes) as { packet: Packet }).packet.entries, [
    settingsEntry,
  ]);
  const many = Array.from(
    { length: MAX_PACKET_ENTRIES },
    (_, i) => [i + 1, 100 + i, SETTINGS, defaultRoomSettings()] as Entry,
  );
  assert.throws(
    () => encodePacket({ ...packet(), entries: many }),
    /too large/,
  );
  const trimmed = (
    decodePacket(encodePacketTrimmed({ ...packet(), entries: many })) as {
      packet: Packet;
    }
  ).packet.entries;
  assert.ok(
    trimmed.length >= 1 && trimmed.length < MAX_PACKET_ENTRIES,
    `${trimmed.length} entries fit`,
  );
  assert.equal(
    trimmed.at(-1)![0],
    MAX_PACKET_ENTRIES,
    "the newest entry always travels",
  );
});
