import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDevRoomService } from "../service/dev.js";
import { GAMES } from "../service/history.js";
import {
  DEFAULT_ROOM_SOCKETS,
  ROOM_LIMITS,
  ROOM_SOCKETS,
  roomSockets,
} from "../service/room-limits.js";

// A room must admit everyone its game can list: every seat, every place in the watching list, and one shared screen.
// The game's own numbers live in its `seating` (fuse-netcode's `Seating`), which the service never loads; this reads
// them and fails when a game lists more members than `service/room-limits.ts` lets into its room.

const gamesDir = join(import.meta.dirname, "..", "games");

interface Roster {
  capacity: number;
  maxWatchers: number;
}
const isRoster = (value: unknown): value is Roster =>
  typeof value === "object" &&
  value !== null &&
  Number.isSafeInteger((value as Roster).capacity) &&
  Number.isSafeInteger((value as Roster).maxWatchers);
const isRegistration = (value: unknown): value is { id: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "string" &&
  typeof (value as { parseTotals?: unknown }).parseTotals === "function";

/** The modules of one game that declare a `seating`, by reading the source: only those are loaded. */
function seatingModules(dir: string): string[] {
  const found: string[] = [];
  const walk = (path: string, depth: number) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2) walk(child, depth + 1);
      } else if (
        entry.name.endsWith(".ts") &&
        /\bseating: \{/.test(readFileSync(child, "utf8"))
      )
        found.push(child);
    }
  };
  walk(join(dir, "src"), 0);
  return found;
}

test("every game's room admits its whole roster: seats, watchers and a shared screen", async () => {
  const served = new Set<string>(GAMES.map((game) => game.id));
  const checked: string[] = [];
  for (const name of readdirSync(gamesDir).sort()) {
    const dir = join(gamesDir, name),
      platform = join(dir, "src", "platform.ts");
    if (!existsSync(platform)) continue;
    const ids = Object.values(
      (await import(pathToFileURL(platform).href)) as Record<string, unknown>,
    )
      .filter(isRegistration)
      .map((registration) => registration.id);
    const rosters: Roster[] = [];
    for (const file of seatingModules(dir)) {
      let exported: Record<string, unknown>;
      try {
        exported = await import(pathToFileURL(file).href);
      } catch {
        // A module that needs a browser to load; the game's own `seating` is found in another.
        continue;
      }
      for (const value of Object.values(exported)) {
        const seating = (value as { seating?: unknown } | null)?.seating;
        if (isRoster(seating)) rosters.push(seating);
      }
    }
    assert.ok(
      rosters.length > 0,
      `games/${name}: no exported game with a \`seating\` was found, so its room size cannot be checked`,
    );
    const needed = Math.max(
      ...rosters.map((roster) => roster.capacity + roster.maxWatchers + 1),
    );
    for (const id of ids) {
      assert.ok(served.has(id), `${id} is not served`);
      assert.ok(
        roomSockets(id) >= needed,
        `${id} lists ${needed} members (seats, watchers and a screen) but its room admits ${roomSockets(id)}: ` +
          `give it an entry in ROOM_SOCKETS in service/room-limits.ts`,
      );
      checked.push(id);
    }
  }
  assert.deepEqual(checked.sort(), [...served].sort());
});

test("the limits handed to the room service are the table, counted without the creator", () => {
  assert.equal(ROOM_LIMITS.maxGuests, DEFAULT_ROOM_SOCKETS - 1);
  for (const [id, count] of Object.entries(ROOM_SOCKETS)) {
    assert.equal(ROOM_LIMITS.gameMaxGuests[id], count - 1);
    assert.ok(
      GAMES.some((game) => game.id === id),
      `ROOM_SOCKETS names ${id}, which is not a registered game`,
    );
  }
  assert.equal(roomSockets("a-game-with-no-entry"), DEFAULT_ROOM_SOCKETS);
  // A full mesh is n × (n − 1) / 2 links, and the room-level signalling allowances grow with membership from a room
  // of six (docs/design/signalling-abuse-isolation.md). Past this, measure before raising it.
  for (const count of [DEFAULT_ROOM_SOCKETS, ...Object.values(ROOM_SOCKETS)])
    assert.ok(count >= 2 && count <= 14, `${count} sockets`);
});

test("the service that is composed admits each game's room at the table's size", async () => {
  // The table is only as good as its wiring: this is the store the local and CI service really runs, and the
  // deployed entry (service/index.ts) spreads the same ROOM_LIMITS into its own.
  const service = createDevRoomService();
  try {
    for (const game of GAMES)
      assert.equal(
        service.gateway.store.guestLimit(game.id),
        roomSockets(game.id) - 1,
        game.id,
      );
  } finally {
    await service.close();
  }
});
