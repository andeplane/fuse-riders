import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parsePortalEntry } from "../packages/fuse-ui/src/portal.js";

const gamesRoot = new URL("../games/", import.meta.url);
const publicRoot = new URL("../public/", import.meta.url);

test("every game on the portal shows a gameplay capture, not its lettermark", () => {
  const listed = readdirSync(gamesRoot).filter((id) =>
    existsSync(new URL(`${id}/portal.json`, gamesRoot)),
  );
  assert.ok(listed.length > 0);
  const missing: string[] = [];
  for (const id of listed) {
    const entry = parsePortalEntry(
      JSON.parse(readFileSync(new URL(`${id}/portal.json`, gamesRoot), "utf8")),
    );
    assert.ok(entry, `games/${id}/portal.json is valid`);
    if (!entry.screenshot || !existsSync(new URL(entry.screenshot, publicRoot)))
      missing.push(id);
  }
  assert.deepEqual(
    missing,
    [],
    "add a recipe to scripts/gallery-capture.ts, run `pnpm gallery:capture <id>` and set `screenshot` in portal.json",
  );
});
