import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BOTS_ONLY_STEPS_PER_TICK,
  TICK_HZ,
} from "../games/fuse-riders/src/engine/game.js";
import { MAX_STEPS_PER_TICK } from "../games/fuse-riders/src/engine/tick-driver.js";
import {
  TickClock,
  SNAP_TICKS,
  TICK_MS,
  BUFFERED_ENTRIES,
  FUTURE_TICKS,
  PACKET_ENTRIES,
  RETAINED_ENTRIES,
  ROLLBACK_TICKS,
  SEQ_AHEAD,
  SNAPSHOT_INTERVAL,
  SNAPSHOTS_RETAINED,
  STALL_TICKS,
  MAX_PACKET_BYTES,
  MAX_PACKET_ENTRIES,
  MAX_SNAPSHOT_BYTES,
  DISCONNECT_MS,
  HASH_INTERVAL,
  HASH_LAG,
  SNAPSHOT_BUFFER_LIMIT,
  SNAPSHOT_RETRY_MS,
  STALLED_GAP_MS,
  WINDOW_GRACE_MS,
} from "fuse-netcode";
import { DEFAULT_MAX_FAST_BYTES } from "fuse-network-fe";
import { ROOM_RECONNECT_GRACE_MS } from "fuse-network-protocol";
import { ROOM_TTL_MS } from "fuse-network-be";

const ADR = "docs/adr/047-p2p-input-log-lockstep-rollback.md";
/** Every numeric constant these modules export must have a row: a new magic number is documented or CI says so. */
const COMPLETE = [
  "packages/fuse-netcode/src/stream.ts",
  "packages/fuse-netcode/src/rollback.ts",
  "packages/fuse-netcode/src/clock.ts",
  "packages/fuse-netcode/src/packet.ts",
  "packages/fuse-netcode/src/snapshot.ts",
  "packages/fuse-netcode/src/room-runtime.ts",
  "packages/fuse-netcode/src/membership.ts",
  "packages/fuse-netcode/src/world-sync.ts",
  "packages/fuse-netcode/src/room-manager.ts",
  "packages/fuse-netcode/src/input-recorder.ts",
];

interface Row {
  name: string;
  value: number;
  path: string;
}
function rows(): Row[] {
  const text = readFileSync(new URL(`../${ADR}`, import.meta.url), "utf8");
  const block = text.match(
    /<!-- adr-047-constants:start -->([\s\S]*?)<!-- adr-047-constants:end -->/,
  );
  assert.ok(block, `${ADR} has lost its adr-047-constants markers`);
  const parsed: Row[] = [];
  for (const line of block[1]!.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    // Only blank lines, the header and the rule under it may be skipped: any other row must parse, or a typo would hide a constant.
    if (!cells.length || cells[0] === "Constant" || /^-+$/.test(cells[0]!))
      continue;
    const name = cells[0]!.match(/^`([A-Z][A-Z0-9_]*)`$/)?.[1];
    assert.ok(
      name,
      `constants table row does not start with a \`CONSTANT_NAME\` cell: ${line.trim().slice(0, 80)}`,
    );
    const path = cells[3]?.match(/^`([^`]+\.ts)`$/)?.[1];
    assert.match(cells[1] ?? "", /^\d+$/, `${name}: the value is an integer`);
    assert.ok(path, `${name}: "Defined in" is one source path`);
    parsed.push({ name, value: Number(cells[1]), path });
  }
  return parsed;
}
const load = async (path: string): Promise<Record<string, unknown>> =>
  (await import(new URL(`../${path}`, import.meta.url).href)) as Record<
    string,
    unknown
  >;

test("ADR 047's constants table quotes the values the source exports", async () => {
  const table = rows();
  assert.ok(table.length >= 50, "the table was parsed");
  assert.equal(
    new Set(table.map((row) => `${row.path}:${row.name}`)).size,
    table.length,
    "no constant is listed twice",
  );
  for (const row of table)
    assert.equal(
      (await load(row.path))[row.name],
      row.value,
      `${row.name} in ${row.path} no longer matches ${ADR}: correct the row and reread its couplings`,
    );
});

test("every numeric constant the netcode core exports has a row in ADR 047", async () => {
  const table = rows(),
    missing: string[] = [];
  for (const path of COMPLETE) {
    const listed = new Set(
      table.filter((row) => row.path === path).map((row) => row.name),
    );
    for (const [name, value] of Object.entries(await load(path)))
      if (
        typeof value === "number" &&
        /^[A-Z][A-Z0-9_]*$/.test(name) &&
        !listed.has(name)
      )
        missing.push(`${name} (${path})`);
  }
  assert.deepEqual(
    missing,
    [],
    `exported but not listed in ${ADR}: ${missing.join(", ")} — add a row for each with its unit and what it couples to`,
  );
});

test("the couplings ADR 047 marks as checked hold", () => {
  // C1: speculation never outruns the rollback window.
  assert.equal(STALL_TICKS, ROLLBACK_TICKS);
  // C2: the oldest repairable entry is at W - ROLLBACK_TICKS + 1 and needs a snapshot at or before W - ROLLBACK_TICKS;
  // the oldest retained one is at most W - SNAPSHOT_INTERVAL * (SNAPSHOTS_RETAINED - 1).
  assert.ok(SNAPSHOT_INTERVAL * (SNAPSHOTS_RETAINED - 1) >= ROLLBACK_TICKS);
  // C3: hashes exist only at retained snapshot ticks, and the hashed tick is still in the ring when it is sent.
  assert.equal(HASH_INTERVAL % SNAPSHOT_INTERVAL, 0);
  assert.equal(HASH_LAG % SNAPSHOT_INTERVAL, 0);
  assert.ok(HASH_LAG <= SNAPSHOT_INTERVAL * (SNAPSHOTS_RETAINED - 1));
  // C4: one cap under three names.
  assert.equal(MAX_PACKET_ENTRIES, PACKET_ENTRIES);
  assert.equal(DEFAULT_MAX_FAST_BYTES, MAX_PACKET_BYTES);
  // C5: the clock's tick length is the simulation's, and it has one rate: game speed is steps per log tick, so a tick
  // bound is the same wall time in every phase and nobody stalls on a silent rider before it can be logged absent.
  assert.equal(TICK_MS * TICK_HZ, 1000);
  assert.ok(BOTS_ONLY_STEPS_PER_TICK > 1);
  assert.equal(MAX_STEPS_PER_TICK, BOTS_ONLY_STEPS_PER_TICK);
  assert.equal("rate" in TickClock.prototype, false);
  assert.ok(DISCONNECT_MS < STALL_TICKS * TICK_MS);
  // C6: an honest out-of-reach stream gets a stalled-gap wait and a snapshot retry in before its owner stops counting as heard.
  assert.ok(WINDOW_GRACE_MS >= STALLED_GAP_MS + SNAPSHOT_RETRY_MS);
  // C6: a link just up holds off an absence for one DISCONNECT_MS, which nobody stalls on at 1×.
  assert.ok(DISCONNECT_MS < STALL_TICKS * TICK_MS);
  // C7: a follower still slewing toward the authority is never refused as too far ahead.
  assert.ok(FUTURE_TICKS > SNAP_TICKS);
  // C9: a full snapshot's base64 text fits the buffer it is served through.
  assert.ok(SNAPSHOT_BUFFER_LIMIT > Math.ceil((MAX_SNAPSHOT_BYTES * 4) / 3));
  // C12: the service's room lifetime is the protocol's reconnect grace.
  assert.equal(ROOM_TTL_MS, ROOM_RECONNECT_GRACE_MS);
  // C13: out of reach starts beyond what a NACK can repair and beyond what the buffer may hold.
  assert.equal(SEQ_AHEAD, BUFFERED_ENTRIES * 16);
  assert.ok(SEQ_AHEAD > RETAINED_ENTRIES);
  assert.ok(SEQ_AHEAD >= BUFFERED_ENTRIES);
});
