import type { World } from "../engine/types.js";
import { hexCenter, hexPoints, boardSize, groundCell } from "./projection.js";
import { POWERUP_STYLE } from "./powerup-art.js";

export function minimapMarkup(world: Readonly<World>): string {
  const { width, height } = boardSize(world.map.width, world.map.height);
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
    .join("")}${world.powerups
    .map((p) => {
      const { x, y } = hexCenter(world.map.width, p.cell);
      return `<circle class="minimap-powerup" cx="${x}" cy="${y}" r="13" fill="${POWERUP_STYLE[p.kind].color}" stroke="#fff" stroke-width="4"/>`;
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
  const { width, height } = boardSize(world.map.width, world.map.height);
  return groundCell(world.map.width, world.map.height, nx * width, ny * height);
}
