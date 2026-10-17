/**
 * Bakes a map's terrain into one image, once per match: biome ground, rocks for `#`, cliff faces for `^`, water with
 * banks for `~` and plank bridges for `=`, `TILE_PX` art pixels per tile. Cosmetic only: wobbled edges and craters
 * never change which tiles the engine walks.
 */
import { TILE_PX } from "../engine/view.js";
import { Img, SHADOW } from "./pixel/image.js";
import { hash, vnoise } from "./pixel/noise.js";
import { BIOME, type Biome } from "./pixel/palette.js";
import { blob, bridge, crater, terrain } from "./pixel/terrain.js";

export interface Terrain {
  width: number;
  height: number;
  terrain: readonly string[];
}

/** The tiles that read as water: rivers, and the water a bridge spans. */
const WET = new Set(["~", "="]);

export function bakeGround(
  map: Terrain,
  seed = 3,
  biome: Biome = BIOME.desert,
): Img {
  const W = map.width * TILE_PX,
    H = map.height * TILE_PX;
  const img = new Img(W, H);
  const tileAt = (x: number, y: number) =>
    map.terrain[Math.floor(y / TILE_PX)]?.[Math.floor(x / TILE_PX)] ?? "#";
  terrain(img, biome, seed);

  // Water: a pixel is wet when its wobbled sample point lands on a wet tile; dry pixels near water become bank.
  const wobble = (x: number, y: number, s: number) =>
    (vnoise(x, y, 6, seed + s) - 0.5) * 5;
  const wet = (x: number, y: number) =>
    WET.has(tileAt(x + wobble(x, y, 1), y + wobble(x, y, 2)));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (![x - 4, x, x + 4].some((at) => WET.has(tileAt(at, y)))) continue;
      if (wet(x, y)) {
        const deep = wet(x - 3, y) && wet(x + 3, y);
        let c = deep ? biome.water[0] : biome.water[1];
        if ((x + y * 3) % 9 === 0 && hash(x, y, seed) < 0.6) c = biome.water[2];
        if ((x + y * 5) % 23 === 0) c = biome.water[3];
        img.px(x, y, c);
      } else if (
        wet(x + 2, y) ||
        wet(x - 2, y) ||
        wet(x, y + 2) ||
        wet(x, y - 2)
      )
        img.px(x, y, biome.bank);
      else if (wet(x + 3, y)) img.px(x, y, SHADOW);
    }

  // Each tile of one kind, top to bottom so later rows overlap earlier ones.
  const each = (ch: string, draw: (tx: number, ty: number) => void) => {
    for (let ty = 0; ty < map.height; ty++)
      for (let tx = 0; tx < map.width; tx++)
        if (map.terrain[ty]![tx] === ch) draw(tx, ty);
  };
  const rock = biome.rock;
  // Cliffs: each `^` tile a rock face, lit along its top, with a shadow under its foot.
  // prettier-ignore
  each("^", (tx, ty) => {
    for (let j = 0; j < TILE_PX; j++)
      for (let i = 0; i < TILE_PX; i++) {
        const x = tx * TILE_PX + i, y = ty * TILE_PX + j, band = hash(x >> 1, ty, seed);
        const top = j === 0 && map.terrain[ty - 1]?.[tx] !== "^";
        img.px(x, y, top ? rock[4] : hash(x, y, seed) < 0.06 ? rock[0] : band < 0.35 ? rock[1] : band < 0.8 ? rock[2] : rock[3]);
      }
    if (map.terrain[ty + 1]?.[tx] !== "^") img.rect(tx * TILE_PX, (ty + 1) * TILE_PX, TILE_PX, 3, SHADOW);
  });
  // Craters scattered over open ground, a few per screen.
  each(".", (tx, ty) => {
    if (hash(tx, ty, seed + 5) < 0.012)
      crater(img, biome, tx * TILE_PX + 4, ty * TILE_PX + 4, 5, 3, tx * ty);
  });
  // Bridges: one deck over each connected patch of `=` tiles.
  const seen = new Set<number>();
  // prettier-ignore
  each("=", (tx, ty) => {
    if (seen.has(ty * map.width + tx)) return;
    const box = [tx, ty, tx, ty], stack = [[tx, ty] as const];
    seen.add(ty * map.width + tx);
    for (let at = stack.pop(); at; at = stack.pop()) {
      const [x, y] = at;
      box.splice(0, 4, Math.min(box[0]!, x), Math.min(box[1]!, y), Math.max(box[2]!, x), Math.max(box[3]!, y));
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const)
        if (map.terrain[ny]?.[nx] === "=" && !seen.has(ny * map.width + nx)) {
          seen.add(ny * map.width + nx);
          stack.push([nx, ny]);
        }
    }
    const [x0, y0, x1, y1] = box.map((v) => v * TILE_PX) as [number, number, number, number];
    bridge(img, x0, y0, x1 - x0 + TILE_PX, y1 - y0 + TILE_PX);
  });
  // Rocks last, so boulders overlap whatever lies under their edge.
  each("#", (tx, ty) =>
    blob(img, tx * TILE_PX + 4, ty * TILE_PX + 4, 5.5, 4.8, rock, tx * 31 + ty),
  );
  return img;
}
