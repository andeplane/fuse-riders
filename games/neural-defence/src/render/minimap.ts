import type { World } from "../engine/types.js";
import { hexCenter, hexPoints } from "./board.js";

export function minimapMarkup(world: Readonly<World>): string {
  const last = hexCenter(world.map.width, world.map.cells.length - 1);
  const width = Math.sqrt(3) * 35 * (world.map.width + 0.5) + 35;
  const height = last.y + 35;
  const paths = { blocked: "", biomass: "", insight: "" };
  world.map.cells.forEach((cell, i) => {
    if (cell.terrain === "open") return;
    const key = cell.terrain === "deposit" ? cell.resourceKind : "blocked";
    paths[key] += `M${hexPoints(world.map.width, i).replaceAll(" ", "L")}Z`;
  });
  const colors = ["#62dcff", "#ff6d85", "#9ee394", "#f7d477"];
  return `<section class="tactical-map" aria-label="Tactical map"><div class="tactical-map-title">TACTICAL OVERVIEW <span>LIVE</span></div><svg id="nd-minimap" data-minimap="true" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="button" tabindex="0" aria-label="Tactical map. Click to move camera. Arrow keys move selection."><rect width="${width}" height="${height}" fill="#071a20"/><path d="${paths.blocked}" fill="#536366"/><path d="${paths.biomass}" fill="#b9d860"/><path d="${paths.insight}" fill="#b691e9"/>${world.structures
    .map((s) => {
      const { x, y } = hexCenter(world.map.width, s.cell);
      const slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
      return `<circle cx="${x}" cy="${y}" r="${s.kind === "brain" ? 20 : 11}" fill="${colors[slot]}" opacity="${s.connected ? 1 : 0.4}"/>`;
    })
    .join(
      "",
    )}<rect class="minimap-view" fill="none" stroke="#e1f6eb" stroke-width="5" pointer-events="none"/></svg></section>`;
}

/** Translate a normalized minimap location to an existing selectable cell. */
export function minimapCell(
  world: Readonly<World>,
  nx: number,
  ny: number,
): number {
  const width = Math.sqrt(3) * 35 * (world.map.width + 0.5) + 35;
  const height = hexCenter(world.map.width, world.map.cells.length - 1).y + 35;
  const row = Math.max(
    0,
    Math.min(world.map.height - 1, Math.round((ny * height - 35) / 52.5)),
  );
  const column = Math.max(
    0,
    Math.min(
      world.map.width - 1,
      Math.round((nx * width - 35) / (Math.sqrt(3) * 35) - (row & 1) / 2),
    ),
  );
  return row * world.map.width + column;
}
