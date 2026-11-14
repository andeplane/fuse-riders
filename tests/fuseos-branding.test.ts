import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * FuseOS is FuseOS: the names of the desktop it descends from and that desktop's surroundings
 * stay out of its sources, assets and docs (docs/fuseos/README.md, "Branding").
 */
const FORBIDDEN = /\b(cognite|cdf|fusion|atlas|industrial os)\b/gi;
const ROOTS = ["packages/fuseos", "public/fuseos", "docs/fuseos"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);
/** Bitmaps, sound, fonts and WebAssembly are not prose; everything else is read as text. */
const BINARY =
  /\.(png|jpe?g|gif|webp|ico|wasm|zip|mp3|m4a|ogg|wav|woff2?|ttf|otf)$/i;

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walk(file);
    return BINARY.test(entry.name) ? [] : [file];
  });
}

test("no Cognite, CDF, Fusion, Atlas or Industrial OS anywhere in packages/fuseos, public/fuseos or docs/fuseos", () => {
  const found: string[] = [];
  let scanned = 0;
  for (const file of ROOTS.flatMap(walk)) {
    scanned++;
    const text = readFileSync(file, "latin1");
    for (const match of text.matchAll(FORBIDDEN)) {
      const line = text.slice(0, match.index).split("\n").length;
      found.push(`${file}:${line} ${match[0]}`);
    }
  }
  assert.ok(scanned > 100, `scanned ${scanned} files`);
  assert.deepEqual(found, []);
});

test("the About sheet's version is the fuseos package's", () => {
  const pkg = JSON.parse(
    readFileSync("packages/fuseos/package.json", "utf8"),
  ) as { version: string };
  const source = readFileSync("packages/fuseos/src/about/version.ts", "utf8");
  assert.match(source, new RegExp(`FUSEOS_VERSION = "${pkg.version}"`));
});

test("the About credits name what the desktop stands on", () => {
  const credits = readFileSync("packages/fuseos/src/about/credits.ts", "utf8");
  for (const name of [
    "98.css",
    "React95",
    "Webamp",
    "js-dos",
    "clippyjs",
    "WebLLM",
    "CodeMirror",
    "1j01/pipes",
    "id Software",
    "soundtracks",
  ])
    assert.ok(credits.includes(name), `credits mention ${name}`);
});
