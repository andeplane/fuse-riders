import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { AddressBudget } from "../src/address-budget.js";
import { createDevRoomService } from "../src/dev.js";
import { ROOM_LOOKUP_BURST } from "../src/http.js";

test("each address has its own allowance, refilled over time, and idle addresses are forgotten", () => {
  let now = 0;
  const budget = new AddressBudget(() => now, 3, 0.5, 2);
  assert.deepEqual(
    [1, 2, 3, 4].map(() => budget.take("a")),
    [true, true, true, false],
  );
  assert.equal(budget.take("b"), true, "another address is unaffected");
  // A third address is refused while two are tracked, rather than growing the table.
  assert.equal(budget.take("c"), false);
  assert.equal(budget.size, 2);
  now += 2000;
  assert.deepEqual(
    [budget.take("a"), budget.take("a")],
    [true, false],
    "one call back after two seconds",
  );
  // Once an address would be full again it is forgotten, which makes room for a new one.
  now += 6000;
  assert.equal(budget.take("c"), true);
  assert.equal(budget.size, 1);
  assert.deepEqual(
    [1, 2, 3, 4].map(() => budget.take("a")),
    [true, true, true, false],
  );
});

test("the room lookups an outsider can ask for are bounded per address; other routes keep their own budgets", async () => {
  let now = 1_000_000;
  const service = createDevRoomService({ now: () => now, log: () => {} });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      headers: { Origin: origin, ...init.headers },
    });
  try {
    const room = (await (
      await call("/api/rooms", { method: "POST" })
    ).json()) as {
      code: string;
      token: string;
    };
    const stranger = { Authorization: `Bearer ${"e".repeat(64)}` };
    const statuses: number[] = [];
    for (let n = 0; n < ROOM_LOOKUP_BURST + 2; n++)
      statuses.push(
        (
          await call(
            n % 2
              ? `/api/rooms/${room.code}/ice`
              : `/api/rooms/${room.code}/end`,
            { method: n % 2 ? "GET" : "POST", headers: stranger },
          )
        ).status,
      );
    // Not a member, not the creator: refused on the merits thirty times, then without a room read at all.
    assert.deepEqual(statuses.slice(0, ROOM_LOOKUP_BURST), [
      ...Array.from({ length: ROOM_LOOKUP_BURST / 2 }, () => [403, 403]).flat(),
    ]);
    assert.deepEqual(statuses.slice(ROOM_LOOKUP_BURST), [429, 429]);
    // Health and room creation are other budgets.
    assert.equal((await call("/api/health")).status, 200);
    assert.equal((await call("/api/rooms", { method: "POST" })).status, 201);
    now += 2000;
    assert.equal(
      (
        await call(`/api/rooms/${room.code}/end`, {
          method: "POST",
          headers: { Authorization: `Bearer ${room.token}` },
        })
      ).status,
      200,
      "the creator's own call goes through once the address has an allowance again",
    );
  } finally {
    await service.close();
  }
});
