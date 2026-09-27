import type { StructureKind } from "../engine/types.js";

/** One visual identity shared by battlefield, command card and inspection. */
export const NEURON_ART = [
  "neuron-v3",
  "neuron-lobed-v4",
  "neuron-folded-v4",
] as const;

export function structureArt(kind: StructureKind, cell?: number): string {
  if (kind === "brain") return "brain-v3";
  if (kind === "harvester") return "harvester-v1";
  if (kind === "bastion") return "tower-bastion-v1";
  if (kind === "neuron") {
    if (cell === undefined) return NEURON_ART[0];
    const seed = (Math.imul(cell + 1, 0x45d9f3b) ^ ((cell + 1) >>> 3)) >>> 0;
    return NEURON_ART[seed % NEURON_ART.length]!;
  }
  return `tower-${kind === "tower" ? "pulse" : kind}-v3`;
}

const teamHues = [0, 145, 265, 205] as const;
export function teamArtHue(slot: number): number {
  return teamHues[slot] ?? 0;
}
export function teamArtFilter(slot: number): string {
  return `hue-rotate(${teamHues[slot] ?? 0}deg)`;
}

export function teamSvgFilter(slot: number): string {
  return `url(#nd-art-hue-${teamHues[slot] ?? 0})`;
}

/** Native SVG filters also tint groups in WebKit; CSS filter functions do not. */
export function svgArtFilters(): string {
  const bounds =
    'x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"';
  return (
    teamHues
      .map(
        (hue) =>
          `<filter id="nd-art-hue-${hue}" ${bounds}><feColorMatrix type="hueRotate" values="${hue}"/></filter>`,
      )
      .join("") +
    `<filter id="nd-art-shadow" ${bounds}><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>`
  );
}
