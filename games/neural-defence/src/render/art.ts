import type { StructureKind } from "../engine/types.js";

/** One visual identity shared by battlefield, command card and inspection. */
export function structureArt(kind: StructureKind): string {
  if (kind === "brain") return "brain-v3";
  if (kind === "neuron") return "neuron-v3";
  return `tower-${kind === "tower" ? "pulse" : kind}-v3`;
}

export function teamArtFilter(slot: number): string {
  return `hue-rotate(${[0, 145, 265, 205][slot] ?? 0}deg)`;
}
