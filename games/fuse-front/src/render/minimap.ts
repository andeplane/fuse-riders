/**
 * The minimap: one art pixel per tile, terrain tinted by each sector's owning team, with the lanes, then markers
 * (`minimapMarks`): towers, gates and forts in their team's colour (hollow once razed), jungle camps, units as dots
 * and heroes, this device's highlighted. The terrain and lanes are painted once per match (`minimapBase`);
 * `paintMinimap` copies them and adds the live layer into a reused image, so the page redraws it only when the world
 * changes, never per animation frame.
 */
import {
  STEPS_PER_SECOND,
  SUB,
  TILE_PX,
  type WorldView,
} from "../engine/view.js";
import { Img, type Rgba } from "./pixel/image.js";

const GROUND: Readonly<Record<string, Rgba>> = {
  "#": [92, 84, 74, 255],
  "^": [120, 86, 54, 255],
  "~": [40, 90, 136, 255],
  "=": [138, 98, 56, 255],
};
const SAND: Rgba = [176, 146, 98, 255];
const LANE: Rgba = [214, 196, 150, 255];
/** Translucent team tints over territory, then solid dots: red, blue. */
const TINT: readonly Rgba[] = [
  [224, 68, 44, 110],
  [58, 110, 232, 110],
];
const DOT: readonly Rgba[] = [
  [255, 120, 96, 255],
  [140, 190, 255, 255],
];
const CAMP: Rgba = [240, 200, 60, 255],
  CAMP_DOWN: Rgba = [120, 104, 70, 255];

export function minimapBase(
  world: Pick<WorldView, "width" | "height" | "terrain" | "lanes">,
): Img {
  const img = new Img(world.width, world.height);
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++)
      img.px(x, y, GROUND[world.terrain[y]?.[x] ?? "#"] ?? SAND);
  for (const { path } of world.lanes)
    for (let i = 1; i < path.length; i++)
      img.line(path[i - 1]!.x, path[i - 1]!.y, path[i]!.x, path[i]!.y, LANE);
  return img;
}

const tile = (sub: number) => Math.floor(sub / SUB / TILE_PX);

/** One minimap marker, in tiles: `team` -1 is neutral; `down` is a razed structure or a camp waiting to respawn. */
export interface MiniMark {
  kind: "structure" | "fort" | "building" | "camp" | "unit" | "hero";
  x: number;
  y: number;
  team: number;
  down: boolean;
  self: boolean;
}

/** What the minimap marks, bottom to top, for this device's `seat`. */
export function minimapMarks(world: WorldView, seat: number): MiniMark[] {
  const marks: MiniMark[] = [];
  const add = (
    kind: MiniMark["kind"],
    x: number,
    y: number,
    team: number,
    down = false,
    self = false,
  ) => marks.push({ kind, x, y, team, down, self });
  world.camps.forEach((c, i) =>
    add("camp", c.x, c.y, -1, (world.campRespawn[i] ?? 0) > 0),
  );
  for (const b of world.buildings) {
    const kind =
      b.kind === "fort" ? "fort" : b.tier >= 0 ? "structure" : "building";
    // A razed lane structure or fort stays as a hollow mark; any other ruin goes.
    if (b.hp > 0 || kind !== "building") add(kind, b.x, b.y, b.team, b.hp <= 0);
  }
  for (const u of world.units)
    if (u.team >= 0) add("unit", tile(u.x), tile(u.y), u.team);
  for (const h of world.heroes)
    if (h.hp > 0)
      add("hero", tile(h.x), tile(h.y), h.team, false, h.seat === seat);
  return marks;
}

/** A camp's hover text when `at` (tiles) is within 3 tiles of one: guarded, or how long until its guards return. */
export function campTip(
  world: WorldView,
  at: { x: number; y: number },
): string | undefined {
  const i = world.camps.findIndex(
    (c) => Math.abs(c.x - at.x) <= 3 && Math.abs(c.y - at.y) <= 3,
  );
  if (i < 0) return undefined;
  const left = Math.ceil((world.campRespawn[i] ?? 0) / STEPS_PER_SECOND);
  return left > 0 ? `Jungle camp: back in ${left}s` : "Jungle camp: guarded";
}

/** Paints `base` plus territory and `minimapMarks` into `out` (the same size), in place. */
export function paintMinimap(
  out: Img,
  base: Img,
  world: WorldView,
  seat = -1,
): Img {
  out.d.set(base.d);
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const sector = world.sectorOf[y * world.width + x] ?? -1;
      const owner = sector < 0 ? -1 : world.sectorOwners[sector]!;
      if (owner >= 0) out.px(x, y, TINT[owner % 2]);
    }
  for (const m of minimapMarks(world, seat)) {
    const colour = m.team < 0 ? "#d8d8d8" : DOT[m.team]!;
    if (m.kind === "unit") out.px(m.x, m.y, colour);
    else if (m.kind === "camp")
      out.rect(m.x - 1, m.y - 1, 2, 2, m.down ? CAMP_DOWN : CAMP);
    else if (m.kind === "building") out.rect(m.x, m.y, 2, 2, colour);
    else if (m.kind === "hero") {
      if (m.self) out.rect(m.x - 2, m.y - 2, 5, 5, "#ffffff");
      out.rect(m.x - 1, m.y - 1, 3, 3, m.self ? "#ffe070" : colour);
    } else {
      // A standing tower, gate or fort is a solid square; a razed one only its outline.
      const r = m.kind === "fort" ? 2 : 1,
        [x0, y0, x1, y1] = [m.x - r, m.y - r, m.x + r, m.y + r];
      if (!m.down) out.rect(x0, y0, 2 * r + 1, 2 * r + 1, colour);
      else
        for (const [ax, ay, bx, by] of [
          [x0, y0, x1, y0],
          [x1, y0, x1, y1],
          [x1, y1, x0, y1],
          [x0, y1, x0, y0],
        ] as const)
          out.line(ax, ay, bx, by, colour);
    }
  }
  return out;
}
