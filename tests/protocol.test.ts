import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseClientMessage,
  type ClientMessage,
} from "../src/shared/protocol.js";

test("all semantic message variants validate without accepting extra fields", () => {
  const messages: ClientMessage[] = [
    { type: "join", name: " Åse " },
    { type: "join", name: "P2", playerToken: "a".repeat(48) },
    { type: "input", seq: 5, left: true, right: false, bomb: false },
    {
      type: "input",
      seq: 6,
      left: false,
      right: false,
      bomb: true,
      bombAction: "press",
    },
    {
      type: "input",
      seq: 7,
      left: false,
      right: false,
      bomb: false,
      bombAction: "release",
    },
    {
      type: "input",
      seq: 8,
      left: false,
      right: false,
      bomb: false,
      bombAction: "cancel",
    },
    { type: "heartbeat" },
    { type: "leave" },
    { type: "hostAuth", token: "b".repeat(48) },
    { type: "ping", id: 1, sentAt: 123.4 },
    { type: "hostAction", action: "start" },
    { type: "hostAction", action: "nextRound" },
    { type: "hostAction", action: "rematch" },
    { type: "hostAction", action: "lobby" },
  ];
  for (const m of messages) {
    assert.ok(parseClientMessage(JSON.stringify(m)));
    assert.equal(
      parseClientMessage(JSON.stringify({ ...m, position: 12 })),
      null,
    );
  }
  assert.deepEqual(parseClientMessage(JSON.stringify(messages[0])), {
    type: "join",
    name: "Åse",
  });
});

test("untrusted message shapes, sizes, tokens and input sequences fail closed", () => {
  const invalid: unknown[] = [
    null,
    [],
    1,
    true,
    "",
    {},
    { type: "unknown" },
    { type: "join", name: "" },
    { type: "join", name: 5 },
    { type: "join", name: "a".repeat(19) },
    { type: "join", name: "bad\u0000" },
    { type: "join", name: "OK", playerToken: "invalid" },
    { type: "hostAuth", token: 4 },
    { type: "hostAction", action: "delete" },
    { type: "ping", id: -1, sentAt: 0 },
    { type: "ping", id: 1, sentAt: -1 },
    { type: "ping", id: 1, sentAt: null },
    ...[-1, 0.5, 2 ** 54, null, "1"].map((seq) => ({
      type: "input",
      seq,
      left: false,
      right: false,
      bomb: false,
    })),
    { type: "input", seq: 1, left: 1, right: false, bomb: false },
    { type: "input", seq: 1, left: false, right: false },
    {
      type: "input",
      seq: 1,
      left: false,
      right: false,
      bomb: false,
      bombAction: "press",
    },
    {
      type: "input",
      seq: 1,
      left: false,
      right: false,
      bomb: true,
      bombAction: "release",
    },
    {
      type: "input",
      seq: 1,
      left: false,
      right: false,
      bomb: true,
      bombAction: "cancel",
    },
    {
      type: "input",
      seq: 1,
      left: false,
      right: false,
      bomb: true,
      bombAction: "detonate",
    },
  ];
  for (const v of invalid)
    assert.equal(
      parseClientMessage(JSON.stringify(v)),
      null,
      JSON.stringify(v),
    );
  assert.equal(parseClientMessage("{"), null);
  assert.equal(parseClientMessage(" ".repeat(2049)), null);
  assert.ok(
    parseClientMessage(JSON.stringify({ type: "join", name: "😀".repeat(18) })),
  );
});

test("target aim accepts finite normalized coordinates only and rejects nested extras", () => {
  const input = {
    type: "input",
    seq: 1,
    left: false,
    right: false,
    bomb: true,
  };
  for (const aim of [
    { x: 0, y: 1 },
    { x: 0.5, y: 0.2 },
  ])
    assert.deepEqual(parseClientMessage(JSON.stringify({ ...input, aim })), {
      ...input,
      aim,
    });
  for (const aim of [
    null,
    [],
    3,
    {},
    { x: 0.5 },
    { x: -0.1, y: 0 },
    { x: 0, y: 1.01 },
    { x: "0", y: 0 },
    { x: null, y: 0 },
    { x: 0, y: 0, z: 0 },
  ])
    assert.equal(parseClientMessage(JSON.stringify({ ...input, aim })), null);
});
