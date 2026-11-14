import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * FuseOS draws every portal game on its desktop, Start menu, title bars and taskbar with a bitmap icon from
 * public/fuseos/game-icons/: `<id>.png` (64x64, shown at 32px) and `<id>-16.png` (32x32, shown at 16px). The build
 * (vite.config.ts) only lists an icon it finds, and the OS falls back to the lettermark tile, so a missing file
 * would ship silently; this test is what makes it a failure.
 */

const gamesRoot = new URL("../games/", import.meta.url);
const iconsRoot = new URL("../public/fuseos/game-icons/", import.meta.url);

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** PNG colour type 6 is truecolour with alpha. */
const RGBA = 6;

type PngHeader = { width: number; height: number; colorType: number };

function pngHeader(file: URL): PngHeader {
  const bytes = readFileSync(file);
  assert.ok(
    bytes.subarray(0, 8).equals(PNG_SIGNATURE),
    `${file.pathname} is a PNG`,
  );
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes.readUInt8(25),
  };
}

const portalGames = () =>
  readdirSync(gamesRoot)
    .filter((id) => existsSync(new URL(`${id}/portal.json`, gamesRoot)))
    .sort();

test("every game on the portal ships a desktop icon at both sizes", () => {
  const listed = portalGames();
  assert.ok(listed.length > 0);
  const missing: string[] = [];
  for (const id of listed)
    for (const name of [`${id}.png`, `${id}-16.png`])
      if (!existsSync(new URL(name, iconsRoot))) missing.push(name);
  assert.deepEqual(
    missing,
    [],
    "add public/fuseos/game-icons/<id>.png (64x64) and <id>-16.png (32x32); see PROVENANCE.md there",
  );
});

test("each icon is a transparent PNG of its slot's size, small enough to ship", () => {
  for (const id of portalGames()) {
    for (const [name, size] of [
      [`${id}.png`, 64],
      [`${id}-16.png`, 32],
    ] as const) {
      const file = new URL(name, iconsRoot);
      const header = pngHeader(file);
      assert.deepEqual(
        header,
        { width: size, height: size, colorType: RGBA },
        `${name} is a ${size}x${size} RGBA PNG`,
      );
      assert.ok(
        readFileSync(file).byteLength < 16 * 1024,
        `${name} stays under 16 KiB`,
      );
    }
  }
});

test("Pig stays off the desktop: no icon for a game without a portal entry", () => {
  const stray = readdirSync(iconsRoot)
    .filter((name) => name.endsWith(".png"))
    .map((name) => name.replace(/(-16)?\.png$/, ""))
    .filter((id) => !existsSync(new URL(`${id}/portal.json`, gamesRoot)));
  assert.deepEqual([...new Set(stray)], []);
});
