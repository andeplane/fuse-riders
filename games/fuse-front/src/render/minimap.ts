/**
 * The minimap: one art pixel per tile, terrain tinted by each sector's owning team, with buildings, units and heroes
 * as dots. The terrain is painted once per match (`minimapBase`); `paintMinimap` copies it and adds the live layer
 * into a reused image, so the page redraws it only when the world changes, never per animation frame.
 */
import { SUB, TILE_PX, type WorldView } from "../engine/view.js";
import { Img, type Rgba } from "./pixel/image.js";

const GROUND: Readonly<Record<string, Rgba>> = {
  "#": [92, 84, 74, 255],
  "^": [120, 86, 54, 255],
  "~": [40, 90, 136, 255],
  "=": [138, 98, 56, 255],
};
const SAND: Rgba = [176, 146, 98, 255];
/** Translucent team tints over territory, then solid dots: red, blue. */
const TINT: readonly Rgba[] = [
  [200, 48, 28, 110],
  [42, 90, 208, 110],
];
const DOT: readonly Rgba[] = [
  [255, 120, 96, 255],
  [140, 190, 255, 255],
];

export function minimapBase(
  world: Pick<WorldView, "width" | "height" | "terrain">,
): Img {
  const img = new Img(world.width, world.height);
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++)
      img.px(x, y, GROUND[world.terrain[y]?.[x] ?? "#"] ?? SAND);
  return img;
}

const tile = (sub: number) => Math.floor(sub / SUB / TILE_PX);

/** Paints `base` plus territory, buildings, units and heroes into `out` (the same size), in place. */
export function paintMinimap(out: Img, base: Img, world: WorldView): Img {
  out.d.set(base.d);
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const sector = world.sectorOf[y * world.width + x] ?? -1;
      const owner = sector < 0 ? -1 : world.sectorOwners[sector]!;
      if (owner >= 0) out.px(x, y, TINT[owner % 2]);
    }
  for (const b of world.buildings)
    if (b.hp > 0)
      out.rect(b.x, b.y, 2, 2, b.team < 0 ? "#d8d8d8" : DOT[b.team]!);
  for (const u of world.units) out.px(tile(u.x), tile(u.y), DOT[u.team]);
  for (const h of world.heroes)
    if (h.hp > 0) out.rect(tile(h.x) - 1, tile(h.y) - 1, 3, 3, "#ffe070");
  return out;
}
