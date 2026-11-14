import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GAMES, platform } from "../service/history.js";

// Production serves every game in GAMES (no deploy-time switch), so a game's rooms open when its registration lands
// there. This catches a new game whose `src/platform.ts` was never added to service/history.ts.
const gamesDir = join(import.meta.dirname, "..", "games");

test("every game with a platform registration is served", async () => {
  const registered = new Set<unknown>(GAMES);
  const files = readdirSync(gamesDir)
    .map((dir) => join(gamesDir, dir, "src", "platform.ts"))
    .filter((file) => existsSync(file));
  assert.ok(files.length > 1);
  for (const file of files) {
    const exports: Record<string, unknown> = await import(
      pathToFileURL(file).href
    );
    assert.ok(
      Object.values(exports).some((value) => registered.has(value)),
      `${file} exports no registration listed in GAMES in service/history.ts`,
    );
  }
  assert.deepEqual(
    [...platform.gameIds].sort(),
    GAMES.map((game) => game.id).sort(),
  );
});
