import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GAMES, platform } from "../service/history.js";

// Production serves every game in GAMES (no deploy-time switch), so a game's rooms open when its registration lands
// there. This catches a new game whose `src/platform.ts` was never added to service/history.ts.
/** A game registration as service/history.ts lists it: an object with a string id and stats parsing. */
const isRegistration = (value: unknown): value is { id: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "string" &&
  typeof (value as { parseTotals?: unknown }).parseTotals === "function";

const gamesDir = join(import.meta.dirname, "..", "games");

test("every game with a platform registration is served", async () => {
  const registered = new Set<unknown>(GAMES);
  const files = readdirSync(gamesDir)
    .map((dir) => join(gamesDir, dir, "src", "platform.ts"))
    .filter((file) => existsSync(file));
  assert.equal(files.length, GAMES.length);
  for (const file of files) {
    const exports: Record<string, unknown> = await import(
      pathToFileURL(file).href
    );
    const registrations = Object.values(exports).filter(isRegistration);
    assert.ok(registrations.length > 0, `${file} exports no registration`);
    for (const registration of registrations)
      assert.ok(
        registered.has(registration),
        `${file}: ${registration.id} is not in GAMES in service/history.ts`,
      );
  }
  const ids = GAMES.map((game) => game.id);
  assert.equal(new Set(ids).size, ids.length, "GAMES lists an id twice");
  assert.deepEqual([...platform.gameIds].sort(), [...ids].sort());
});
