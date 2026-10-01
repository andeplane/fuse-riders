import type { StructureKind } from "../engine/types.js";

/** Sprite identity for buildings. Neurons are procedural (`neuron-art.ts`); this is their fallback sprite. */
export function structureArt(kind: StructureKind): string {
  if (kind === "brain") return "brain-v3";
  if (kind === "harvester") return "harvester-v1";
  if (kind === "bastion") return "tower-bastion-v1";
  if (kind === "neuron") return "neuron-v3";
  return `tower-${kind === "tower" ? "pulse" : kind}-v3`;
}

/** Hue rotations of the blue painted art, one per team (see TEAM_PALETTES). */
const teamHues = [0, 145, 265, 205, 55, 180, 305, 95] as const;
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
