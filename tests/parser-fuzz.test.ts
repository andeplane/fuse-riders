import test from "node:test";
import assert from "node:assert/strict";
import { parseClientMessage } from "../src/shared/protocol.js";
import { STEER } from "../src/engine/input-log.js";
import {
  decodePacket,
  encodePacket,
  MAX_PACKET_BYTES,
  type Packet,
} from "fuse-netcode";
import { fuseGame } from "../src/online/fuse-game.js";
import { validSignal } from "../packages/fuse-network-be/src/signal.js";
import { parseRoomRecord } from "../packages/fuse-network-be/src/room-store.js";

// Bounded JSON-only fuzzing represents serialized network/storage data, without
// proxies, getters, monkeypatches or a random/sleep-dependent test outcome.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function corpus(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const names = [
    "type",
    "description",
    "candidate",
    "toString",
    "valueOf",
    "members",
    "expiresAt",
    "generation",
    "entries",
    "seq",
    "constructor",
    "__proto__",
  ];
  function value(depth = 0): Json {
    switch (next() % (depth < 4 ? 8 : 5)) {
      case 0:
        return null;
      case 1:
        return !!(next() % 2);
      case 2:
        return [0, -1, 0.5, Number.MAX_SAFE_INTEGER, 2 ** 32][next() % 5]!;
      case 3:
        return String.fromCharCode(next() % 0xffff).repeat(next() % 12);
      case 4:
        return ["offer", "answer", "input", "time", "AB42", "a".repeat(24)][
          next() % 6
        ]!;
      case 5:
        return Array.from({ length: next() % 6 }, () => value(depth + 1));
      default:
        return Object.fromEntries(
          Array.from({ length: next() % 6 }, () => [
            names[next() % names.length]!,
            value(depth + 1),
          ]),
        );
    }
  }
  return { next, value };
}
const signal = { description: { type: "offer", sdp: "v=0" } };
const room = {
  version: 2,
  code: "AB42",
  incarnation: "incarnation",
  hostHash: "a".repeat(64),
  hostId: "b".repeat(24),
  expiresAt: 90_000,
  revision: 1,
  members: {
    ["b".repeat(24)]: {
      id: "b".repeat(24),
      connectionId: "connection",
      gatewayId: "gateway",
      host: true,
      expiresAt: 30_000,
    },
  },
};
const packet: Packet = {
  room: 1,
  from: "abcdef",
  generation: 1,
  through: 10,
  lastSeq: 1,
  entries: [[1, 10, STEER, 1]],
  sentAt: 10,
  echoSentAt: 0,
  echoHeld: 0,
  clockTick: 10,
  hash: null,
};

// These JSON values formerly accepted an array as SDP type or threw during
// String(type) coercion. Hostile signalling must be rejected as data.
test("signalling rejects non-string SDP types without coercion", () => {
  for (const type of [
    ["offer"],
    ["answer"],
    { toString: null },
    { toString: [] },
    { valueOf: "offer" },
  ]) {
    assert.equal(validSignal({ description: { type, sdp: "v=0" } }), false);
  }
  assert.equal(validSignal(signal), true);
  assert.equal(
    validSignal({ description: { type: "answer", sdp: "v=0" } }),
    true,
  );
});

test("seeded JSON mutations cannot throw, mutate data or poison later parser calls", () => {
  const fuzz = corpus(0x259257);
  assert.ok(parseRoomRecord(room));
  for (let i = 0; i < 2_000; i++) {
    const value = fuzz.value();
    const variants: unknown[] = [
      value,
      { description: { type: value, sdp: "v=0" } },
      { candidate: value },
      { ...room, members: value },
      { ...room, grant: value },
    ];
    for (const raw of variants) {
      const before = JSON.stringify(raw);
      const message = parseClientMessage(before);
      if (message)
        assert.deepEqual(parseClientMessage(JSON.stringify(message)), message);
      validSignal(raw);
      parseRoomRecord(raw);
      assert.equal(
        JSON.stringify(raw),
        before,
        `seed 0x259257 case ${i} mutated input`,
      );
    }
    // Recovery after every hostile input batch, not only one successful baseline.
    assert.deepEqual(parseClientMessage('{"type":"heartbeat"}'), {
      type: "heartbeat",
    });
    assert.equal(validSignal(signal), true);
    assert.deepEqual(parseRoomRecord(room), room);
  }
});

test("seeded required-field corruption rejects client and stored-room records", () => {
  const fuzz = corpus(0x259002);
  const input = {
    type: "input",
    seq: 1,
    left: false,
    right: true,
    bomb: false,
  };
  for (let i = 0; i < 500; i++) {
    const junk = [null, [], {}, "wrong", false][fuzz.next() % 5]!;
    for (const key of ["seq", "left", "right", "bomb"]) {
      const bad = { ...input, [key]: key === "seq" ? junk : { value: junk } };
      assert.equal(parseClientMessage(JSON.stringify(bad)), null);
    }
    for (const key of [
      "version",
      "code",
      "hostHash",
      "hostId",
      "expiresAt",
      "revision",
      "members",
    ]) {
      assert.equal(parseRoomRecord({ ...room, [key]: [junk] }), undefined);
    }
  }
});

test("seeded byte mutations remain bounded and permit the next healthy packet", () => {
  const fuzz = corpus(0x259003),
    good = encodePacket(packet);
  for (let i = 0; i < 2_000; i++) {
    let bytes: Uint8Array;
    if (i % 2) {
      bytes = good.slice();
      for (let j = 0; j <= fuzz.next() % 4; j++)
        bytes[fuzz.next() % bytes.length] = fuzz.next() & 255;
    } else {
      bytes = Uint8Array.from(
        { length: fuzz.next() % (MAX_PACKET_BYTES + 32) },
        () => fuzz.next() & 255,
      );
    }
    const before = bytes.slice(),
      decoded = decodePacket(fuseGame, bytes);
    assert.deepEqual(bytes, before);
    // A mutation may still be a valid packet; require canonical re-encoding to
    // preserve every accepted field rather than incorrectly rejecting all noise.
    if (decoded && "packet" in decoded)
      assert.deepEqual(
        decodePacket(fuseGame, encodePacket(decoded.packet)),
        decoded,
      );
    assert.deepEqual(decodePacket(fuseGame, good), { packet });
  }
  for (let end = 0; end < good.length; end++)
    assert.equal(decodePacket(fuseGame, good.subarray(0, end)), undefined);
  assert.equal(
    decodePacket(fuseGame, new Uint8Array(MAX_PACKET_BYTES + 1)),
    undefined,
  );
  assert.equal(parseClientMessage(" ".repeat(2049)), null);
});
