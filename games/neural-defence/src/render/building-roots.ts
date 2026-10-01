import { GROUND } from "./projection.js";
import { seededRandom, tendril } from "./neuron-form.js";
import { palette } from "./creep.js";

/**
 * A fleshy mound with roots spreading into the creep, so mechanical buildings
 * read as grown from the same tissue as the network. Drawn beneath the
 * building sprite; presentation only.
 */
export function buildingRootsMarkup(
  x: number,
  foot: number,
  slot: number,
  seed: number,
  scale = 1,
): string {
  return buildingRoots(x, foot, slot, seed, scale).markup;
}

/** The roots' markup, and each root's centreline for light pulses to travel. */
export function buildingRoots(
  x: number,
  foot: number,
  slot: number,
  seed: number,
  scale = 1,
): { markup: string; spines: (readonly (readonly [number, number])[])[] } {
  const p = palette(slot);
  const random = seededRandom(seed);
  const count = 7 + Math.floor(random() * 3);
  const outlines: string[] = [];
  const spines: (readonly (readonly [number, number])[])[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.5;
    const rim = 22 * scale;
    const start = [
      x + Math.cos(angle) * rim * 0.8,
      foot - 6 + Math.sin(angle) * rim * GROUND.depth * 0.8,
    ] as const;
    const root = tendril(
      start,
      angle,
      (16 + random() * 18) * scale,
      (3.2 + random() * 1.4) * scale,
      (random() - 0.5) * 0.5,
      seed * 31 + i,
    );
    outlines.push(...root.outlines);
    spines.push(root.spine);
  }
  const d = outlines.join("");
  const rx = 25 * scale,
    ry = 30 * scale * GROUND.depth * 0.75;
  return {
    markup: `<g class="building-roots" pointer-events="none"><path d="${d}" fill="${p.fleshDark}" transform="translate(0.8 2)"/><path class="root-flesh" d="${d}" fill="${p.dark}" stroke="${p.mid}" stroke-opacity="0.35" stroke-width="0.6"/><ellipse class="root-mound-side" cx="${x}" cy="${foot - 3}" rx="${rx}" ry="${ry}" fill="${p.fleshDark}"/><ellipse class="root-mound" cx="${x}" cy="${foot - 6}" rx="${rx * 0.96}" ry="${ry * 0.92}" fill="url(#nd-creep-${slot})"/><ellipse class="root-mound-sheen" cx="${x - rx * 0.2}" cy="${foot - 8}" rx="${rx * 0.8}" ry="${ry * 0.7}" fill="url(#nd-mound-${slot})"/></g>`,
    spines,
  };
}
