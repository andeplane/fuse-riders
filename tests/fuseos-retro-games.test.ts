import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GAME_IDS } from "../packages/fuseos/src/retro/gameIds.js";

/**
 * Programs > Games > Retro Games is a catalogue (`packages/fuseos/src/retro/games.ts`) over committed assets under
 * `public/fuseos` and credits in `docs/fuseos/retro-games.md`. Each game is either a js-dos bundle, a vendored web
 * page or a native React component, and every one needs its files, a row in the licence table and its licence
 * texts in the repository, or the Start menu lists something the site cannot serve or may not distribute.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const RETRO = path.join(ROOT, "public", "fuseos", "retro");
const JSDOS = path.join(ROOT, "public", "fuseos", "jsdos");
const DOCS = path.join(ROOT, "docs", "fuseos");
const credits = readFileSync(path.join(DOCS, "retro-games.md"), "utf8");

type Runtime = "jsdos" | "iframe" | "native";

function runtimeOf(id: string): Runtime | undefined {
  const found: Runtime[] = [];
  if (existsSync(path.join(RETRO, `${id}.jsdos.wasm`))) found.push("jsdos");
  if (existsSync(path.join(RETRO, id, "index.html"))) found.push("iframe");
  if (existsSync(path.join(ROOT, "packages", "fuseos", "src", "retro", id)))
    found.push("native");
  return found.length === 1 ? found[0] : undefined;
}

test("every retro game has exactly one way to run, with its files committed", () => {
  const runtimes = Object.fromEntries(
    GAME_IDS.map((id) => [id, runtimeOf(id) ?? "missing"]),
  );
  assert.deepEqual(runtimes, {
    doom: "jsdos",
    wolf3d: "jsdos",
    keen1: "jsdos",
    duke3d: "jsdos",
    minesweeper: "native",
    skifree: "iframe",
    micropolis: "iframe",
    solitaire: "native",
  });
});

test("the js-dos player and the DOSBox core are committed next to the bundles", () => {
  for (const file of [
    "player.html",
    "player.js",
    "player.css",
    "js-dos.js",
    "js-dos.css",
    "emulators/emulators.js",
    "emulators/wdosbox.js",
    "emulators/wdosbox.wasm",
    "emulators/wlibzip.js",
    "emulators/wlibzip.wasm",
  ])
    assert.ok(existsSync(path.join(JSDOS, file)), `missing ${file}`);
});

test("the player page resolves the core and the bundles relative to itself, so it works under any base path", () => {
  const player = readFileSync(path.join(JSDOS, "player.js"), "utf8");
  assert.match(
    player,
    /new URL\('\.\.\/retro\/' \+ bundle \+ '\.jsdos\.wasm', here\)/,
  );
  assert.match(player, /new URL\('emulators\/', here\)/);
  assert.match(player, /noCloud: true/);
  const html = readFileSync(path.join(JSDOS, "player.html"), "utf8");
  assert.doesNotMatch(
    html,
    /https?:\/\//,
    "the player page loads nothing from another origin",
  );
});

test("the player swallows the keyboard lock rejection js-dos leaves unhandled inside a frame", () => {
  const player = readFileSync(path.join(JSDOS, "player.js"), "utf8");
  // js-dos.js calls navigator.keyboard.lock([...]) without catching; the player wraps lock first.
  assert.ok(
    readFileSync(path.join(JSDOS, "js-dos.js"), "utf8").includes(".lock(["),
    "js-dos no longer locks the keyboard; drop the guard in player.js",
  );
  assert.match(player, /keyboard\.lock = function/);
  assert.match(player, /\.catch\(function \(\) \{\}\)/);
  assert.ok(
    player.indexOf("keyboard.lock = function") <
      player.indexOf("window.Dos(root"),
    "the guard must be installed before js-dos starts",
  );
});

test("every retro game has a row in the licence table and its licence texts are in docs/fuseos/licenses", () => {
  const table = credits
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("| ") &&
        !line.startsWith("| Game") &&
        !line.startsWith("| ---"),
    );
  assert.equal(table.length, GAME_IDS.length, "one table row per game");
  for (const id of GAME_IDS) {
    const runtime = runtimeOf(id);
    const needle =
      runtime === "jsdos"
        ? `retro/${id}.jsdos.wasm`
        : runtime === "iframe"
          ? `retro/${id}/index.html`
          : `packages/fuseos/src/retro/${id}`;
    assert.ok(
      table.some((row) => row.includes(`\`${needle}`)),
      `${id}: no row names ${needle}`,
    );
  }
  const references = [...credits.matchAll(/`licenses\/([^`]+)`/g)].map(
    (m) => m[1] ?? "",
  );
  assert.ok(references.length >= 8, "the table points at the licence files");
  for (const reference of references)
    assert.ok(
      existsSync(path.join(DOCS, "licenses", reference)),
      `missing docs/fuseos/licenses/${reference}`,
    );
  for (const file of [
    "DOOM-README.TXT",
    "WOLF3D-VENDOR.DOC",
    "KEEN1-VENDOR.DOC",
    "DUKE3D-LICENSE.TXT",
    "skifree/LICENSE.md",
    "micropolis/LICENSE",
    "micropolis/MicropolisPublicNameLicense.md",
    "solitaire/VECTOR-PLAYING-CARDS-README.md",
  ])
    assert.ok(
      references.includes(file),
      `the table does not reference licenses/${file}`,
    );
});

test("the retro docs and scripts carry no leftovers from the OS this was ported from", () => {
  const texts = [
    credits,
    ...[
      "copy-jsdos.mjs",
      "copy-clippy.mjs",
      "build-jsdos-bundles.py",
      "vendor-web-games.py",
    ].map((file) =>
      readFileSync(path.join(ROOT, "scripts", "fuseos", file), "utf8"),
    ),
  ];
  for (const text of texts) {
    assert.doesNotMatch(
      text,
      /Cognite|CDF|Fusion|Atlas|Industrial OS|Flows|App Hosting/,
    );
    assert.doesNotMatch(
      text,
      /public\/games\b|docs\/games\b|public\/jsdos\b|public\/assistant\b/,
    );
  }
});
