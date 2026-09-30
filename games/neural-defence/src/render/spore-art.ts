import { palette } from "./creep.js";
import { neuronDefs } from "./neuron-art.js";

const f = (n: number) => n.toFixed(1);

/** Where a Spore tower's pod sits relative to its cell centre. */
export const SPORE_POD = Object.freeze({ dy: -36, rx: 16, ry: 13 });

/**
 * A Spore tower: a fleshy stalk rising from the creep, topped by a pod with
 * glowing vents that bursts on impact. Drawn procedurally in the same tissue
 * as the neurons; the pod throbs through CSS.
 */
export function sporeMarkup(x: number, y: number, slot: number): string {
  const p = palette(slot);
  const top = y + SPORE_POD.dy;
  const vents = [
    [-8, -2],
    [7, -4],
    [0, -9],
    [-3, 5],
    [9, 5],
  ]
    .map(
      ([dx, dy]) =>
        `<ellipse cx="${f(x + dx!)}" cy="${f(top + dy!)}" rx="2.6" ry="2" fill="${p.fleshDark}" stroke="${p.light}" stroke-width="0.9" stroke-opacity="0.8"/>`,
    )
    .join("");
  return `<g class="building-art spore-art"><path class="spore-stalk" d="M${f(x - 7)} ${f(y + 18)}C${f(x - 9)} ${f(y + 2)} ${f(x - 3)} ${f(top + 16)} ${f(x - 5)} ${f(top + 6)}L${f(x + 5)} ${f(top + 6)}C${f(x + 3)} ${f(top + 16)} ${f(x + 9)} ${f(y + 2)} ${f(x + 7)} ${f(y + 18)}Z" fill="url(#nd-dendrite-${slot}-0)" stroke="${p.fleshDark}" stroke-width="1"/><g class="spore-pod"><ellipse cx="${f(x + 1.5)}" cy="${f(top + 3)}" rx="${SPORE_POD.rx}" ry="${SPORE_POD.ry}" fill="${p.fleshDark}"/><ellipse cx="${f(x)}" cy="${f(top)}" rx="${SPORE_POD.rx}" ry="${SPORE_POD.ry}" fill="url(#nd-soma-${slot}-2)" stroke="${p.light}" stroke-opacity="0.35" stroke-width="0.8"/>${vents}<ellipse cx="${f(x - 6)}" cy="${f(top - 6)}" rx="4.5" ry="2.4" fill="#fff" opacity="0.3" transform="rotate(-25 ${f(x - 6)} ${f(top - 6)})"/></g></g>`;
}

const icons = new Map<number, string>();
/** Build-button and portrait image of a Spore tower in a team's colours. */
export function sporeIconUrl(slot: number): string {
  let url = icons.get(slot);
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -58 60 80"><defs>${neuronDefs(slot)}</defs>${sporeMarkup(0, 0, slot)}</svg>`;
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    icons.set(slot, url);
  }
  return url;
}
