import { CHUNK, type WorldView } from "../engine/view.js";
import { terrainSolid } from "../engine/view-kit.js";

export const GUTTER = 8;
export const TEXELS = 2;
export const TILE_SIZE = (CHUNK + GUTTER * 2) * TEXELS;

/** Content identity includes the shading gutter, so equal revision numbers after rollback are safe. */
export function terrainKey(view: WorldView, cx: number, cy: number): number {
  let hash = 2166136261;
  const left = Math.max(0, cx * CHUNK - GUTTER),
    right = Math.min(view.width, (cx + 1) * CHUNK + GUTTER);
  const top = Math.max(0, cy * CHUNK - GUTTER),
    bottom = Math.min(view.height, (cy + 1) * CHUNK + GUTTER);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x += 8) {
      hash = Math.imul(
        hash ^ view.terrain.bits[(y * view.width + x) >>> 3]!,
        16777619,
      );
    }
  return hash >>> 0;
}

/** World-anchored painted material, clipped to the exact authoritative occupancy. */
export function paintTerrain(
  ctx: CanvasRenderingContext2D,
  mask: CanvasRenderingContext2D,
  rock: CanvasImageSource,
  view: WorldView,
  cx: number,
  cy: number,
): void {
  const ox = cx * CHUNK - GUTTER,
    oy = cy * CHUNK - GUTTER;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.save();
  ctx.scale(TEXELS, TEXELS);
  const tile = 768;
  for (
    let y = Math.floor(oy / tile) * tile;
    y < oy + CHUNK + GUTTER * 2;
    y += tile
  )
    for (
      let x = Math.floor(ox / tile) * tile;
      x < ox + CHUNK + GUTTER * 2;
      x += tile
    )
      ctx.drawImage(rock, x - ox, y - oy, tile, tile);
  const shade = ctx.createLinearGradient(0, -oy, 0, view.height - oy);
  shade.addColorStop(0, "rgba(24,53,84,0)");
  shade.addColorStop(1, "rgba(0,3,18,.65)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CHUNK + GUTTER * 2, CHUNK + GUTTER * 2);
  // Thin world-aligned mineral bands retain their phase across chunk seams and craters.
  ctx.lineWidth = 1.15;
  for (let band = 0; band < 22; band++) {
    ctx.strokeStyle =
      band % 3 === 0 ? "rgba(79,51,169,.5)" : "rgba(37,37,94,.5)";
    ctx.beginPath();
    for (let x = -GUTTER; x <= CHUNK + GUTTER * 3; x += 4) {
      const wx = ox + x;
      const y =
        292 +
        band * 24 +
        Math.sin(wx / 93 + band * 0.8) * 14 +
        Math.sin(wx / 37) * 4 -
        oy;
      if (x === -GUTTER) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  const alpha = mask.createImageData(TILE_SIZE, TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++)
    for (let x = 0; x < TILE_SIZE; x++) {
      if (
        terrainSolid(
          view,
          ox + Math.floor(x / TEXELS),
          oy + Math.floor(y / TEXELS),
        )
      )
        alpha.data[(y * TILE_SIZE + x) * 4 + 3] = 255;
    }
  mask.putImageData(alpha, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask.canvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.scale(TEXELS, TEXELS);
  const rim = new Path2D();
  for (let y = 0; y < CHUNK + GUTTER * 2; y++)
    for (let x = 0; x < CHUNK + GUTTER * 2; x++) {
      const wx = ox + x,
        wy = oy + y;
      if (!terrainSolid(view, wx, wy)) continue;
      const above = !terrainSolid(view, wx, wy - 1),
        side =
          !terrainSolid(view, wx - 1, wy) || !terrainSolid(view, wx + 1, wy);
      if (above || side || !terrainSolid(view, wx, wy + 1)) {
        ctx.fillStyle = above ? "#a7fff8" : side ? "#328bcc" : "#6950ad";
        ctx.fillRect(x, y, 1, 1);
        if (above) {
          rim.moveTo(x, y + 0.3);
          rim.lineTo(x + 1, y + 0.3);
        }
        if (!terrainSolid(view, wx - 1, wy)) {
          rim.moveTo(x + 0.3, y);
          rim.lineTo(x + 0.3, y + 1);
        }
        if (!terrainSolid(view, wx + 1, wy)) {
          rim.moveTo(x + 0.7, y);
          rim.lineTo(x + 0.7, y + 1);
        }
      } else if (!terrainSolid(view, wx, wy - 3)) {
        ctx.fillStyle = "rgba(40,164,202,.65)";
        ctx.fillRect(x, y, 1, 1);
      } else if (
        !terrainSolid(view, wx - 3, wy) ||
        !terrainSolid(view, wx + 3, wy)
      ) {
        ctx.fillStyle = "rgba(28,77,148,.65)";
        ctx.fillRect(x, y, 1, 1);
      } else if (
        !terrainSolid(view, wx, wy - 6) ||
        !terrainSolid(view, wx - 5, wy)
      ) {
        ctx.fillStyle = "rgba(2,8,29,.45)";
        ctx.fillRect(x, y, 1, 1);
      }
      // Sparse tiny plants stay attached to real support, including newly cut terrain.
      if (
        above &&
        wx % 23 === 0 &&
        wy < view.water - 8 &&
        terrainSolid(view, wx + 2, wy)
      ) {
        ctx.strokeStyle = wx % 46 === 0 ? "#60efdb" : "#31acbe";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - 3, y - 5, x - 1, y - 7);
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 4, y - 2, x + 3, y - 5);
        ctx.stroke();
      }
    }
  ctx.strokeStyle = "rgba(36,221,255,.7)";
  ctx.lineWidth = 0.7;
  ctx.shadowColor = "#00c9ff";
  ctx.shadowBlur = 4;
  ctx.stroke(rim);
  ctx.restore();
}
