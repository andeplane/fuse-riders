import type { StructureKind } from "../engine/types.js";

/** One visual identity shared by battlefield, command card and inspection. */
export const NEURON_ART = [
  "neuron-v3",
  "neuron-lobed-v4",
  "neuron-folded-v4",
] as const;

export function structureArt(kind: StructureKind, cell?: number): string {
  if (kind === "brain") return "brain-v3";
  if (kind === "neuron") {
    if (cell === undefined) return NEURON_ART[0];
    const seed = (Math.imul(cell + 1, 0x45d9f3b) ^ ((cell + 1) >>> 3)) >>> 0;
    return NEURON_ART[seed % NEURON_ART.length]!;
  }
  return `tower-${kind === "tower" ? "pulse" : kind}-v3`;
}

export function teamArtFilter(slot: number): string {
  return `hue-rotate(${[0, 145, 265, 205][slot] ?? 0}deg)`;
}
