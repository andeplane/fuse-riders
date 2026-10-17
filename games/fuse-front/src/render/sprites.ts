/**
 * Every sprite variant the battlefield draws (kind × team × facing × frame), painted once by the pixel library into
 * an RGBA image and turned into a drawable surface by the composition root. The renderer then only blits.
 */
import type { BuildingKind, UnitKind } from "../engine/view.js";
import { boom, flame, puffs, selRing } from "./pixel/effects.js";
import { Img } from "./pixel/image.js";
import type { TeamId } from "./pixel/palette.js";
import { factory, flag, fort, turret } from "./pixel/structures.js";
import { scorch } from "./pixel/terrain.js";
import { BRICK, GRUNT, TORCH, robot, tank } from "./pixel/units.js";

/** A sprite's recipe: its cache key, canvas size, the anchor drawn at the thing's position, and how to paint it. */
export interface SpriteArt {
  key: string;
  w: number;
  h: number;
  ax: number;
  ay: number;
  paint(img: Img): void;
}

export interface Sprite<S> {
  surface: S;
  ax: number;
  ay: number;
}

/** Paints each key once, on first use. `toSurface` turns the painted image into something the screen can blit. */
export class SpriteCache<S> {
  private readonly sprites = new Map<string, Sprite<S>>();
  constructor(private readonly toSurface: (img: Img) => S) {}
  get(art: SpriteArt): Sprite<S> {
    let sprite = this.sprites.get(art.key);
    if (!sprite) {
      const img = new Img(art.w, art.h);
      art.paint(img);
      sprite = { surface: this.toSurface(img), ax: art.ax, ay: art.ay };
      this.sprites.set(art.key, sprite);
    }
    return sprite;
  }
  get size(): number {
    return this.sprites.size;
  }
}

/** A view team (0, 1, or −1 for neutral) as a palette team. */
export const teamId = (team: number): TeamId =>
  team === 0 ? "red" : team === 1 ? "blue" : "neutral";

/** Smoke frames a factory chimney cycles through. */
export const SMOKE_FRAMES = 4;

// prettier-ignore
const recipe = (key: readonly (string | number)[], w: number, h: number, ax: number, ay: number, paint: (img: Img) => void): SpriteArt =>
  ({ key: key.join(":"), w, h, ax, ay, paint });

/** A unit, anchored at its feet (a tank at its centre); `dir` 1 faces east, −1 west. */
export function unitArt(kind: UnitKind, team: number, dir: number): SpriteArt {
  const key = ["unit", kind, team, dir];
  if (kind === "lightTank")
    return recipe(key, 22, 16, 10, 8, (img) =>
      tank(img, 1, 1, teamId(team), { dir }),
    );
  const rows = kind === "torch" ? TORCH : GRUNT;
  return recipe(key, 12, 12, 6, 10, (img) =>
    robot(img, rows, 1, 1, teamId(team), dir),
  );
}

/** Brick, the hero, anchored at his feet. */
export const heroArt = (team: number, dir: number): SpriteArt =>
  recipe(["hero", team, dir], 16, 17, 8, 15, (img) =>
    robot(img, BRICK, 1, 1, teamId(team), dir),
  );

/**
 * A building anchored at the bottom centre of its tile (a turret at the tile's centre), burnt out over a scorch mark
 * once ruined. Only a standing factory uses `frame` (its chimney smoke) and only a standing turret `dir`.
 */
// prettier-ignore
export function buildingArt(kind: BuildingKind, team: number, ruined: boolean, frame: number, dir: number): SpriteArt {
  const tm: TeamId = ruined ? "wreck" : teamId(team);
  const smoke = kind.endsWith("Factory") && !ruined ? frame % SMOKE_FRAMES : 0;
  const turned = kind === "turret" && !ruined ? dir : 1;
  const key = ["building", kind, ruined ? "ruin" : team, smoke, turned];
  const char = (img: Img, cx: number, cy: number, r: number) =>
    ruined && scorch(img, cx, cy, r, Math.ceil(r / 2), cx + cy);
  if (kind === "fort")
    return recipe(key, 72, 58, 33, 52, (img) => (fort(img, 4, 2, tm), char(img, 33, 40, 26)));
  if (kind === "turret")
    return recipe(key, 24, 16, 12, 9, (img) => (turret(img, 12, 9, tm, turned), char(img, 12, 10, 7)));
  const W = kind === "vehicleFactory" ? 48 : 40;
  return recipe(key, W + 8, 64, 2 + W / 2, 60, (img) => {
    // The chimney's puffs are seeded by where the factory is drawn, so each frame paints it shifted and slides back.
    const layer = new Img(W + 8 + SMOKE_FRAMES, 64);
    factory(layer, 2 + smoke, 28, tm, W === 48 ? "vehicle" : "robot");
    img.blit(layer, -smoke, 0);
    char(img, 2 + W / 2, 48, W / 2);
    if (ruined) puffs(img, 2 + W / 2, 40, 3, 7);
  });
}

/** A capture flag, its pole's foot at the anchor. */
export const flagArt = (team: number): SpriteArt =>
  recipe(["flag", team], 14, 20, 2, 18, (img) =>
    flag(img, 2, 18, teamId(team)),
  );

// The effects below are centred, a flame on its nozzle.
// prettier-ignore
export const boomArt = (r: number, seed: number, half = Math.ceil(r * 2.4) + 2): SpriteArt =>
  recipe(["boom", r, seed], half * 2, half * 2, half, half, (img) => boom(img, half, half, r, seed));
// prettier-ignore
export const flameArt = (len: number, dir: number, w = Math.ceil(1 + len * 0.35) + 1): SpriteArt =>
  recipe(["flame", len, dir], len + 2, w * 2 + 1, dir > 0 ? 1 : len, w, (img) => flame(img, dir > 0 ? 1 : len, w, dir, len));
/** A ground ring (selection or spell) of radius `r`. */
// prettier-ignore
export const ringArt = (r: number, colour: string, cy = Math.ceil(r / 2) + 2): SpriteArt =>
  recipe(["ring", r, colour], r * 2 + 4, r + 5, r + 2, cy, (img) => selRing(img, r + 2, cy, r, r / 2, colour));
// prettier-ignore
export const scorchArt = (r: number, seed: number, ry = Math.ceil(r / 2)): SpriteArt =>
  recipe(["scorch", r, seed], r * 2 + 2, r + 2, r + 1, ry + 1, (img) => scorch(img, r + 1, ry + 1, r, ry, seed));

/** The marker over a stunned (twinkling stars, two frames) or rallied (a green chevron) unit. */
export const markArt = (mark: "stun" | "rally", frame: number): SpriteArt =>
  recipe(["mark", mark, frame % 2], 9, 5, 4, 2, (img) => {
    if (mark === "rally")
      for (let i = 0; i < 4; i++) {
        img.px(4 - i, 1 + i, "#7cfc5a");
        img.px(4 + i, 1 + i, "#7cfc5a");
      }
    else
      for (const x of [1, 4, 7]) {
        const y = (x === 4) === (frame % 2 === 0) ? 1 : 3;
        img.rect(x - 1, y, 3, 1, "#a07010");
        img.px(x, y, "#f8d030");
      }
  });
