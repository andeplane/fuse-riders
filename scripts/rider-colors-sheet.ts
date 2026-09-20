/**
 * The palette's contact sheet: every `RIDER_COLORS` entry drawn as a trail at its real width, over each ground a room
 * actually plays on, plus every pair side by side. Run it when a colour is added or changed and look at the result —
 * the question a unit test cannot answer is whether two riders can tell their lines apart mid-round.
 *
 *   npx tsx scripts/rider-colors-sheet.ts        # writes artifacts/rider-colors.html and prints the path
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RIDER_COLORS,
  RIDER_COLOR_LABELS,
  TRAIL_WIDTH,
} from "../games/fuse-riders/src/engine/tuning.js";

/** The floors a trail is read against: the dark field every classic room uses, then the two coloured grounds. */
const GROUNDS = [
  { name: "Classic field", floor: "#020715" },
  { name: "Desert", floor: "#624020" },
  { name: "Forest", floor: "#164338" },
] as const;

const label = (index: number) => RIDER_COLOR_LABELS[index] ?? `#${index}`;

/** One rider's trail: a stroke at the simulation's own width, with the bright head the renderer draws. */
const trail = (color: string) => `
  <svg viewBox="0 0 240 34" class="trail" role="img" aria-label="${color} trail">
    <path d="M4 25 H70 V9 H150 V25 H226" fill="none" stroke="${color}"
          stroke-width="${TRAIL_WIDTH}" stroke-linecap="square" stroke-linejoin="miter" />
    <circle cx="226" cy="25" r="7" fill="${color}" />
  </svg>`;

const groundBlock = (ground: (typeof GROUNDS)[number]) => `
  <section>
    <h2>${ground.name}</h2>
    <div class="sheet" style="background:${ground.floor}">
      ${RIDER_COLORS.map(
        (color, index) => `
      <div class="row">
        <span class="chip" style="background:${color}"></span>
        <span class="name">${index}&nbsp;${label(index)}</span>
        ${trail(color)}
        <code>${color}</code>
      </div>`,
      ).join("")}
    </div>
  </section>`;

/** Every unordered pair, so a clash between two colours that never sat together in a screenshot still shows up. */
const pairsBlock = () => {
  const cells: string[] = [];
  for (let a = 0; a < RIDER_COLORS.length; a++)
    for (let b = a + 1; b < RIDER_COLORS.length; b++)
      cells.push(`
        <div class="pair" title="${label(a)} · ${label(b)}">
          <span style="background:${RIDER_COLORS[a]}"></span>
          <span style="background:${RIDER_COLORS[b]}"></span>
        </div>`);
  return `
  <section>
    <h2>Every pair (${cells.length})</h2>
    <div class="pairs">${cells.join("")}</div>
  </section>`;
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Rider colours</title>
<style>
  body { margin: 0; padding: 24px; background: #06070f; color: #e2e8f0;
         font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 16px; letter-spacing: .08em; }
  h2 { font-size: 12px; letter-spacing: .1em; color: #93a3c4; margin: 20px 0 6px; }
  .sheet { padding: 10px 14px; border-radius: 10px; }
  .row { display: grid; grid-template-columns: 20px 90px 240px auto;
         align-items: center; gap: 12px; padding: 1px 0; }
  .chip { width: 18px; height: 18px; border-radius: 50%; display: block; }
  .name { color: #f8fafc; text-shadow: 0 1px 2px #000; }
  code { color: #cbd5e1; text-shadow: 0 1px 2px #000; }
  .trail { width: 240px; height: 34px; display: block; }
  .pairs { display: flex; flex-wrap: wrap; gap: 4px; }
  .pair { display: flex; width: 54px; height: 22px; border-radius: 4px; overflow: hidden; }
  .pair span { flex: 1; }
</style></head>
<body>
  <h1>RIDER_COLORS — ${RIDER_COLORS.length} colours at ${TRAIL_WIDTH}px trail width</h1>
  ${GROUNDS.map(groundBlock).join("")}
  ${pairsBlock()}
</body></html>
`;

const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../artifacts/rider-colors.html",
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
