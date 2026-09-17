import test from "node:test";
import assert from "node:assert/strict";
import {
  generateRoomCode,
  reserveRoomCode,
  validRoomCode,
  ROOM_CODE_SPACE,
} from "../src/room-code.js";
test("short codes map the full67600 space and reject biased random tail", () => {
  assert.equal(
    generateRoomCode(() => 0),
    "AA00",
  );
  assert.equal(
    generateRoomCode(() => ROOM_CODE_SPACE - 1),
    "ZZ99",
  );
  let calls = 0;
  assert.equal(
    generateRoomCode(() => (++calls === 1 ? 2 ** 32 - 1 : 142)),
    "AB42",
  );
  assert.equal(calls, 2);
  assert.throws(() => generateRoomCode(() => -1), /Invalid random/);
  assert.throws(() => generateRoomCode(() => 2 ** 32 - 1), /rejection limit/);
});
test("room identities validate without making codes secrets", () => {
  for (const code of ["AB42", "ZZ99"]) assert.equal(validRoomCode(code), true);
  for (const code of [
    "ab42",
    "A142",
    "ABC1",
    "1234",
    "AB420",
    "AB42/",
    "AABBCCDDEE",
  ])
    assert.equal(validRoomCode(code), false);
});
test("collision reservation is bounded and never masks noncollision failure", async () => {
  let attempts = 0;
  assert.equal(
    await reserveRoomCode(
      async () => ++attempts === 3,
      () => `AA0${attempts}`,
    ),
    "AA02",
  );
  assert.equal(attempts, 3);
  attempts = 0;
  assert.equal(
    await reserveRoomCode(
      async () => {
        attempts++;
        return false;
      },
      () => "AA00",
    ),
    undefined,
  );
  assert.equal(attempts, 12);
  await assert.rejects(
    reserveRoomCode(async () => {
      throw new Error("database unavailable");
    }),
    /database unavailable/,
  );
});
