import test from "node:test";
import assert from "node:assert/strict";
import { AdmissionGate } from "../src/admission-gate.js";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import { RoomError } from "../src/room-store.js";

const limited = (error: unknown) =>
  error instanceof RoomError && error.status === 429;
test("admission failures share an hourly IP budget across gateways; healthy joins and other IPs remain independent", async () => {
  let now = 1000,
    calls = 0;
  class Database extends MemoryRoomDatabase {
    override async allowance(
      key: string,
      now: number,
      limit: number,
      consume = true,
    ) {
      calls++;
      return super.allowance(key, now, limit, consume);
    }
  }
  const db = new Database(),
    a = new AdmissionGate(db, () => now),
    b = new AdmissionGate(db, () => now);
  for (let i = 0; i < 40; i++)
    assert.equal(await a.run("healthy", async () => "ok"), "ok");
  for (let i = 0; i < 30; i++)
    await assert.rejects(
      (i % 2 ? a : b).run("abuser", async () => {
        throw new RoomError(404, "Missing room");
      }),
      /Missing room/,
    );
  let admitted = false;
  await assert.rejects(
    a.run("abuser", async () => {
      admitted = true;
    }),
    limited,
  );
  assert.equal(admitted, false);
  const afterBlock = calls;
  for (let i = 0; i < 100; i++)
    await assert.rejects(
      a.run("abuser", async () => {}),
      limited,
    );
  assert.equal(calls, afterBlock, "known blocked IPs do not hit the database");
  assert.equal(await a.run("healthy", async () => "ok"), "ok");
  now = 3_600_000;
  assert.equal(await a.run("abuser", async () => "ok"), "ok");
});

test("pending admission work is bounded per IP and process before touching the database", async () => {
  const gate = new AdmissionGate(new MemoryRoomDatabase(), () => 1000);
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = Array.from({ length: 4 }, () => gate.run("one", () => wait));
  await assert.rejects(
    gate.run("one", async () => {}),
    limited,
  );
  const others = Array.from({ length: 124 }, (_, i) =>
    gate.run(`ip-${i}`, () => wait),
  );
  await assert.rejects(
    gate.run("last", async () => {}),
    limited,
  );
  release();
  await Promise.all([...pending, ...others]);
  await gate.run("last", async () => {});
});

test("operational failures do not consume the caller's failure budget", async () => {
  const gate = new AdmissionGate(new MemoryRoomDatabase(), () => 1000);
  for (let i = 0; i < 40; i++)
    await assert.rejects(
      gate.run("one", async () => {
        throw new Error("offline");
      }),
      /offline/,
    );
  await gate.run("one", async () => {});
});
