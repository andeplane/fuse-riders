import type { Cell } from "../engine/types.js";

/** Art may vary within a terrain category, never change its gameplay meaning. */
const variants = {
  open: ["terrain-walkable-v5"],
  blocked: [
    "blocker-rock-cluster-a",
    "blocker-boulder",
    "blocker-rock-ridge-a",
    "blocker-water",
    "blocker-void",
  ],
} as const;

export const WALKABLE_GROUND = variants.open[0];

export function terrainArt(cell: Cell, index: number): string | null {
  if (cell.terrain === "deposit") return `deposit-${cell.resourceKind}`;
  const allowed: readonly string[] = variants[cell.terrain];
  if (cell.variant && allowed.includes(cell.variant)) return cell.variant;
  return cell.terrain === "blocked" ? variants.blocked[index % 3]! : null;
}
