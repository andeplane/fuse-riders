import { FLOOR_TOP_PX, VIEW_H, VIEW_W } from "../../engine/view-kit.js";
import { dither, hash, Raster, type Brush, type StageArt } from "./kit.js";

/**
 * Camp between stages: a night clearing, one screen that never scrolls. A starry sky with a low moon, a dark tree line,
 * two tents with the party's packs at the back of the clearing, and the campfire in the middle of it, whose glow is
 * painted once into the grass. Only the fire moves: its flames, a few embers, and a warm flicker of light over the
 * ground about it, a dozen flat rectangles a frame.
 */

const FLOOR = FLOOR_TOP_PX;
const SKY = [0x05030c, 0x090616, 0x0f0a22, 0x17102e, 0x21173a, 0x2c1f44];
const GRASS = [0x120d1c, 0x1a1426, 0x221a2e, 0x2b2034, 0x3a2a36, 0x5a3c34];
const TREE = 0x0a0812;
const TREE_EDGE = 0x161024;
const HILL = 0x110c1e;
const CANVAS = [0x9a7a56, 0x6e5640, 0x3e3030] as const;
const STONE = [0x7a7280, 0x4e4858] as const;
const LOG = 0x4a2a2e;
const PACK = [0x8a6040, 0x5a3c2c] as const;
const INK = 0x150c1f;
const FLAME = ["#fff6b8", "#ffc22e", "#f86420", "#a82434"];

/** The fire: the middle of its base, on the floor at the back of the clearing, and how far its glow reaches. */
export const FIRE = { x: 162, y: FLOOR + 16, reach: 70 } as const;

function sky(r: Raster) {
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < VIEW_W; x++)
      r.px(x, y, dither(SKY, y / (FLOOR - 1), x, y));
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash(i, 1) * VIEW_W),
      y = 22 + Math.floor(hash(i, 2) * 50);
    r.px(x, y, hash(i, 3) > 0.8 ? 0xfff6dc : 0x8c84b0);
  }
  // The moon, low over the trees on the right (below the HUD), lit from the left.
  for (let y = -6; y <= 6; y++)
    for (let x = -6; x <= 6; x++)
      if (x * x + y * y <= 36)
        r.px(276 + x, 42 + y, x + y > 3 ? 0xb8b0a0 : 0xece6d2);
  // Far hills, then the tree line in front of them.
  for (let x = 0; x < VIEW_W; x++) {
    const top = Math.round(
      70 + 6 * Math.sin(x * 0.021) + 3 * Math.sin(x * 0.07),
    );
    r.rect(x, top, 1, FLOOR - top, HILL);
  }
  for (let n = 0; n < 24; n++) {
    const cx = Math.floor(n * 14 + hash(n, 4) * 10),
      th = 26 + Math.floor(hash(n, 5) * 22);
    for (let j = 0; j < th; j++) {
      const w = Math.floor((j % 6) * 0.6 + j * 0.22);
      r.rect(cx - w, FLOOR - th + j, 2 * w + 1, 1, TREE);
      r.px(cx + w, FLOOR - th + j, TREE_EDGE);
    }
  }
}

/** A tent at the back of the clearing: a canvas ridge from its apex down to the floor, lit on the fire's side. */
function tent(r: Raster, cx: number, w: number, h: number) {
  const lit = cx < FIRE.x ? 1 : -1;
  for (let j = 0; j <= h; j++) {
    const half = Math.round((j / h) * w);
    for (let i = -half; i <= half; i++)
      r.px(
        cx + i,
        FLOOR - h + j,
        Math.abs(i) === half ? INK : i * lit > 0 ? CANVAS[0] : CANVAS[1],
      );
  }
  // Its open flap, dark inside.
  for (let j = 0; j < h / 2; j++)
    r.rect(
      cx - Math.floor(j / 2),
      FLOOR - Math.floor(h / 2) + j,
      j + 1,
      1,
      INK,
    );
  r.rect(cx - w - 1, FLOOR, 2 * w + 3, 1, CANVAS[2]);
}

/** A pack leaning by a tent, a rounded sack tied at the neck. */
function pack(r: Raster, x: number, y: number) {
  for (let j = 0; j < 7; j++)
    for (let i = 0; i < 6; i++)
      if ((i - 2.5) ** 2 / 9 + (j - 4) ** 2 / 12 <= 1)
        r.px(x + i, y + j, i < 3 ? PACK[0] : PACK[1]);
  r.rect(x + 2, y, 2, 1, INK);
}

function clearing(r: Raster) {
  sky(r);
  for (let y = FLOOR; y < VIEW_H; y++)
    for (let x = 0; x < VIEW_W; x++) {
      const d = Math.hypot((x - FIRE.x) / FIRE.reach, (y - FIRE.y) / 30);
      const lit = Math.max(0, 1 - d) * 0.6;
      r.px(
        x,
        y,
        dither(GRASS, ((y - FLOOR) / (VIEW_H - FLOOR)) * 0.4 + lit, x, y),
      );
    }
  for (let x = 0; x < VIEW_W; x++) r.px(x, FLOOR, INK);
  tent(r, 56, 30, 30);
  tent(r, 268, 26, 26);
  pack(r, 92, FLOOR - 6);
  pack(r, 100, FLOOR - 5);
  pack(r, 230, FLOOR - 6);
  // The fire pit: crossed logs in a ring of stones.
  r.rect(FIRE.x - 8, FIRE.y - 1, 16, 2, LOG);
  r.rect(FIRE.x - 5, FIRE.y - 3, 10, 2, 0x6a4034);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = Math.round(FIRE.x + 11 * Math.cos(a)),
      y = Math.round(FIRE.y + 1 + 4 * Math.sin(a));
    r.rect(x - 1, y - 1, 3, 2, k % 2 ? STONE[0] : STONE[1]);
  }
}

/** Tufts along the front edge. */
function grass(r: Raster) {
  for (let x = 0; x < r.width; x++)
    if (hash(x, 9) > 0.7)
      for (let j = 0, n = 2 + Math.floor(hash(x, 10) * 4); j < n; j++)
        r.px(x, VIEW_H - 1 - j, GRASS[0]);
}

/** The fire's flames, its embers and the flicker of its light, from `frame` alone. */
function fire(brush: Brush, frame: number) {
  const t = frame / 60;
  // The light: three faint nested ellipses of warm bands over the ground, brightest at the fire, breathing with it.
  const glow = 0.03 + 0.015 * Math.sin(t * 11) + 0.008 * Math.sin(t * 23);
  brush.fillStyle = `rgba(255, 150, 60, ${glow.toFixed(3)})`;
  for (const ring of [1, 0.7, 0.45]) {
    const rx = FIRE.reach * 0.8 * ring,
      ry = 22 * ring;
    for (let y = -ry; y < ry; y += 2) {
      const half = Math.round(rx * Math.sqrt(1 - ((y + 1) / ry) ** 2));
      brush.fillRect(FIRE.x - half, Math.round(FIRE.y + y), 2 * half, 2);
    }
  }
  for (let i = -5; i <= 5; i++) {
    const env = 1 - Math.abs(i) / 6;
    const lick =
      0.3 * Math.sin(i * 1.7 + t * 12) + 0.2 * Math.sin(i * 0.6 - t * 7);
    const h = Math.max(1, Math.round(14 * env * (0.7 + lick)));
    for (let j = 0; j < h; j++) {
      brush.fillStyle =
        FLAME[Math.min(3, Math.floor((j / h) * 3.4 + (1 - env)))]!;
      brush.fillRect(FIRE.x + i, FIRE.y - 3 - j, 1, 1);
    }
  }
  for (let i = 0; i < 6; i++) {
    const life = (t * (0.4 + hash(i, 11) * 0.3) + hash(i, 12)) % 1;
    const x = Math.round(
      FIRE.x + (hash(i, 13) - 0.5) * 10 + Math.sin(life * 8 + i) * 3,
    );
    brush.fillStyle = FLAME[Math.min(3, Math.floor(life * 4))]!;
    brush.fillRect(x, Math.round(FIRE.y - 16 - life * 40), 1, 1);
  }
}

export const CAMP_ART: StageArt = {
  back: [{ rate: [0, 1], top: 0, height: VIEW_H, paint: clearing }],
  front: { rate: [0, 1], top: VIEW_H - 8, height: 8, paint: grass },
  animate: (brush, _camX, frame) => fire(brush, frame),
};
