import Phaser from "phaser";
import type { WorldView, ZonesView } from "../engine/view.js";

/**
 * Neon Spire's procedural grey box (12A–12B): a night-city backdrop, dark
 * steel panels with neon edges, holographic billboards and the zone visuals.
 * Presentation only: geometry, zones and timing all come from the view, and
 * nothing here feeds back into the rules. Static layers are drawn once per
 * map (the backdrop, panels and billboards) or per zone settings (beams,
 * wing, crown, pads); animated parts redraw each frame only while ambient
 * motion is on, otherwise only when gameplay state they show changes.
 */
export interface Neon {
  update(view: WorldView, ms: number, animate: boolean): void;
  destroy(): void;
}
export const NEON = {
  cyan: 0x38e8ff,
  magenta: 0xff45e6,
  amber: 0xffb640,
  violet: 0x9a7bff,
  red: 0xff3350,
  gold: 0xffd45c,
} as const;
const PANEL = 0x0b1122,
  STEEL = 0x141c33,
  GRATE = 0x1d2742;
type Rect = readonly [number, number, number, number];
/** Deterministic noise so the skyline is the same on every device. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const css = (color: number, alpha: number) =>
  `rgba(${color >> 16},${(color >> 8) & 255},${color & 255},${alpha})`;
function dashed(
  g: Phaser.GameObjects.Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dash = 14,
  gap = 10,
): void {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1,
    ux = (x1 - x0) / length,
    uy = (y1 - y0) / length;
  for (let d = 0; d < length; d += dash + gap) {
    const e = Math.min(length, d + dash);
    g.lineBetween(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e);
  }
}
/** The skyline, stars, haze and the tower's scaffold, painted once into a canvas. */
function paintBackdrop(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  scale: number,
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot paint the neon skyline.");
  ctx.scale(scale, scale);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#04051a");
  sky.addColorStop(0.45, "#100a33");
  sky.addColorStop(0.74, "#3a0d50");
  sky.addColorStop(0.88, "#190a31");
  sky.addColorStop(1, "#05050e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  const rand = random(1260);
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.5})`;
    const s = rand() < 0.1 ? 2 : 1;
    ctx.fillRect(rand() * width, rand() * height * 0.62, s, s);
  }
  for (const [x, y, r, color] of [
    [width * 0.28, height * 0.78, width * 0.42, NEON.magenta],
    [width * 0.76, height * 0.8, width * 0.36, NEON.cyan],
  ] as const) {
    const haze = ctx.createRadialGradient(x, y, 0, x, y, r);
    haze.addColorStop(0, css(color, 0.22));
    haze.addColorStop(1, css(color, 0));
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height);
  }
  // Far skyline with sparse lit windows.
  const base = height * 0.86;
  for (let x = -20; x < width;) {
    const w = 40 + rand() * 90,
      h = height * (0.12 + rand() * 0.24);
    ctx.fillStyle = "#130d2d";
    ctx.fillRect(x, base - h, w, h + height);
    for (let wy = base - h + 10; wy < base - 6; wy += 14)
      for (let wx = x + 6; wx < x + w - 6; wx += 11)
        if (rand() < 0.07) {
          ctx.fillStyle = css(rand() < 0.5 ? NEON.amber : NEON.cyan, 0.45);
          ctx.fillRect(wx, wy, 4, 5);
        }
    x += w + rand() * 12;
  }
  // Near skyline: taller, darker, with neon strips and antenna lights.
  for (let x = -40; x < width;) {
    const w = 70 + rand() * 150,
      h = height * (0.18 + rand() * 0.3);
    ctx.fillStyle = "#08081a";
    ctx.fillRect(x, height - h, w, h);
    if (rand() < 0.5) {
      ctx.fillStyle = css(rand() < 0.5 ? NEON.magenta : NEON.cyan, 0.55);
      ctx.fillRect(x + w * (0.2 + rand() * 0.6), height - h + 20, 3, h * 0.5);
    }
    if (rand() < 0.4) {
      ctx.strokeStyle = "#1a1a33";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, height - h);
      ctx.lineTo(x + w / 2, height - h - 40);
      ctx.stroke();
      ctx.fillStyle = css(NEON.red, 0.8);
      ctx.fillRect(x + w / 2 - 2, height - h - 44, 4, 4);
    }
    x += w + rand() * 30;
  }
  // The tower's steel scaffold behind the play: girders and cross bracing.
  const girders = [70, 530, 770, width - 770, width - 530, width - 70];
  ctx.strokeStyle = "#1a2240";
  ctx.lineWidth = 3;
  for (let i = 0; i + 1 < girders.length; i += 2)
    for (let y = 140; y + 160 <= height; y += 160) {
      ctx.beginPath();
      ctx.moveTo(girders[i]!, y);
      ctx.lineTo(girders[i + 1]!, y + 160);
      ctx.moveTo(girders[i + 1]!, y);
      ctx.lineTo(girders[i]!, y + 160);
      ctx.stroke();
    }
  for (const x of girders) {
    ctx.fillStyle = "#121a31";
    ctx.fillRect(x - 7, 100, 14, height);
    ctx.fillStyle = css(NEON.cyan, 0.16);
    ctx.fillRect(x - 7, 100, 1.5, height);
  }
  const vignette = ctx.createRadialGradient(
    width / 2,
    height * 0.45,
    height * 0.35,
    width / 2,
    height / 2,
    width * 0.62,
  );
  vignette.addColorStop(0, "rgba(2,2,8,0)");
  vignette.addColorStop(1, "rgba(2,2,8,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  scene.textures.addCanvas(key, canvas);
}
/** Ledge tops glow by tier; solid blocks are boxed in magenta on every side. */
function tierColor(y: number, height: number): number {
  if (y < height * 0.22) return NEON.gold;
  if (y < height * 0.5) return NEON.magenta;
  if (y < height * 0.75) return NEON.cyan;
  return NEON.amber;
}
function paintPanels(
  g: Phaser.GameObjects.Graphics,
  glow: Phaser.GameObjects.Graphics,
  view: WorldView,
): void {
  const solid = new Set(view.solid);
  view.platforms.forEach(([x, y, w, h], i) => {
    if (solid.has(i)) {
      g.fillStyle(PANEL, 1).fillRect(x, y, w, h);
      if (w > 12 && h > 12) {
        const ix = x + 5,
          iy = y + 5,
          iw = w - 10,
          ih = h - 10;
        g.fillStyle(STEEL, 1).fillRect(ix, iy, iw, ih);
        // 45° hatching clipped to the inset: a solid, braced panel.
        g.lineStyle(1.5, GRATE, 1);
        for (let c = 16; c < iw + ih; c += 20)
          g.lineBetween(
            ix + Math.min(c, iw),
            iy + c - Math.min(c, iw),
            ix + c - Math.min(c, ih),
            iy + Math.min(c, ih),
          );
      }
      g.lineStyle(3, NEON.magenta, 1).strokeRect(
        x + 1.5,
        y + 1.5,
        w - 3,
        h - 3,
      );
      glow.lineStyle(10, NEON.magenta, 0.12).strokeRect(x, y, w, h);
      return;
    }
    const color = tierColor(y, view.size.height);
    g.fillStyle(PANEL, 0.94).fillRect(x, y, w, h);
    g.lineStyle(1, GRATE, 1);
    for (let gx = x + 12; gx < x + w - 4; gx += 16)
      g.lineBetween(gx, y + 7, gx, y + h - 3);
    // A dashed underside says "passable from below".
    g.lineStyle(1.5, color, 0.4);
    dashed(g, x + 4, y + h - 1, x + w - 4, y + h - 1, 10, 8);
    g.lineStyle(3, color, 1).lineBetween(x, y + 1.5, x + w, y + 1.5);
    g.fillStyle(0xffffff, 0.9)
      .fillRect(x, y, 5, 4)
      .fillRect(x + w - 5, y, 5, 4);
    glow.fillStyle(color, 0.13).fillRect(x, y - 8, w, 10);
    glow.fillStyle(color, 0.06).fillRect(x - 6, y - 18, w + 12, 22);
  });
}
const BILLBOARDS: readonly {
  rect: Rect;
  text: string;
  color: number;
}[] = [
  { rect: [80, 120, 300, 104], text: "NEON\nSPIRE", color: NEON.magenta },
  { rect: [1880, 150, 280, 100], text: "HOOK\nHAVOK", color: NEON.cyan },
  {
    rect: [150, 870, 290, 96],
    text: "CLIMB · HOOK\nBOMB",
    color: NEON.amber,
  },
];
export function createNeon(scene: Phaser.Scene, res: number): Neon {
  const backdrop = scene.add.image(0, 0, "__DEFAULT").setOrigin(0).setDepth(0);
  const panels = scene.add.graphics().setDepth(2),
    panelGlow = scene.add
      .graphics()
      .setDepth(2.1)
      .setBlendMode(Phaser.BlendModes.ADD);
  const zoneBase = scene.add.graphics().setDepth(1.5),
    zoneFront = scene.add.graphics().setDepth(2.6),
    back = scene.add.graphics().setDepth(1.6),
    front = scene.add.graphics().setDepth(8.6),
    glow = scene.add
      .graphics()
      .setDepth(8.7)
      .setBlendMode(Phaser.BlendModes.ADD);
  const text = (size: number, color: number, depth: number) =>
    scene.add
      .text(0, 0, "", {
        fontFamily: "sans-serif",
        fontStyle: "bold",
        fontSize: `${size}px`,
        color: `#${color.toString(16).padStart(6, "0")}`,
        stroke: "#05060f",
        strokeThickness: 5,
        align: "center",
        resolution: res,
      })
      .setOrigin(0.5)
      .setDepth(depth);
  const boards = BILLBOARDS.map((b) => {
    const g = scene.add.graphics().setDepth(0.5);
    const [x, y, w, h] = b.rect;
    g.fillStyle(b.color, 0.07).fillRect(x, y, w, h);
    g.lineStyle(1, b.color, 0.16);
    for (let sy = y + 4; sy < y + h; sy += 6) g.lineBetween(x, sy, x + w, sy);
    g.lineStyle(2, b.color, 0.75).strokeRect(x, y, w, h);
    g.lineStyle(4, b.color, 0.9);
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ] as const)
      g.lineBetween(cx, cy, cx + dx * 18, cy).lineBetween(
        cx,
        cy,
        cx,
        cy + dy * 18,
      );
    const label = text(30, b.color, 0.6)
      .setText(b.text)
      .setPosition(x + w / 2, y + h / 2)
      .setAlpha(0.85);
    return { g, label };
  });
  const liftLabels: Phaser.GameObjects.Text[] = [];
  const wingLabel = text(20, NEON.violet, 1.7),
    crownLabel = text(22, NEON.gold, 2.7),
    banner = text(40, NEON.red, 16);
  let map = "",
    zoneKey = "",
    liveKey = "";
  const live = (z: ZonesView) =>
    JSON.stringify([
      z.floor && [z.floor.y, z.floor.warning, z.floor.rising],
      z.lasers.map((l) => [l.phase, l.phase === "live" ? l.progress : 0]),
    ]);
  function build(view: WorldView): void {
    map = view.map;
    zoneKey = liveKey = "";
    const { width, height } = view.size,
      key = `neon-backdrop-${map}`;
    paintBackdrop(scene, key, width, height, Math.min(res, 3200 / width));
    backdrop.setTexture(key).setDisplaySize(width, height);
    panels.clear();
    panelGlow.clear();
    paintPanels(panels, panelGlow, view);
  }
  function paintZones(z: ZonesView, width: number, height: number): void {
    zoneBase.clear();
    zoneFront.clear();
    liftLabels.forEach((l) => l.setVisible(false));
    z.lifts.forEach(([x, y, w, h], i) => {
      zoneBase.fillStyle(NEON.cyan, 0.05).fillRect(x, y, w, h);
      zoneBase.lineStyle(2, NEON.cyan, 0.35);
      dashed(zoneBase, x, y, x, y + h, 18, 12);
      dashed(zoneBase, x + w, y, x + w, y + h, 18, 12);
      zoneBase.lineStyle(3, NEON.cyan, 0.8).lineBetween(x, y, x + w, y);
      (liftLabels[i] ??= text(18, NEON.cyan, 1.7))
        .setVisible(true)
        .setText("LIFT")
        .setPosition(x + w / 2, y - 16);
    });
    wingLabel.setVisible(z.lowGravity.length > 0);
    for (const [x, y, w, h] of z.lowGravity) {
      zoneBase.fillStyle(NEON.violet, 0.06).fillRect(x, y, w, h);
      zoneBase.lineStyle(2, NEON.violet, 0.45);
      dashed(zoneBase, x, y, x, y + h, 12, 10);
      dashed(zoneBase, x, y, x + w, y, 12, 10);
      dashed(zoneBase, x, y + h, x + w, y + h, 12, 10);
      wingLabel.setText("LOW-G  ·  40%").setPosition(x + w / 2, y + h - 20);
    }
    crownLabel.setVisible(!!z.bonus);
    if (z.bonus) {
      const [x, y, w, h] = z.bonus,
        cx = x + w / 2;
      zoneBase.fillStyle(NEON.gold, 0.07).fillRect(x, y, w, h);
      zoneBase.lineStyle(2, NEON.gold, 0.55).strokeRect(x, y, w, h);
      // A crown above the deck.
      zoneFront.fillStyle(NEON.gold, 0.95);
      zoneFront.fillPoints(
        [
          { x: cx - 34, y: y + 76 },
          { x: cx - 38, y: y + 40 },
          { x: cx - 18, y: y + 58 },
          { x: cx, y: y + 30 },
          { x: cx + 18, y: y + 58 },
          { x: cx + 38, y: y + 40 },
          { x: cx + 34, y: y + 76 },
        ].map((p) => new Phaser.Math.Vector2(p.x, p.y)),
        true,
      );
      crownLabel
        .setText(
          z.multiplier > 1 ? `TOP ZONE · ${z.multiplier}× POINTS` : "CROWN",
        )
        .setPosition(cx, y + 104);
    }
    for (const [x, y, w] of z.pads) {
      zoneFront.fillStyle(0x221400, 1).fillRect(x, y - 6, w, 6);
      zoneFront.lineStyle(2, NEON.amber, 1).strokeRect(x, y - 6, w, 6);
    }
    // A gauge on both walls marks how high sudden death can take the floor.
    if (z.floor)
      zoneFront
        .fillStyle(NEON.red, 0.35)
        .fillRect(0, z.floor.cap, 5, height - z.floor.cap)
        .fillRect(width - 5, z.floor.cap, 5, height - z.floor.cap);
  }
  function paintLive(view: WorldView, ms: number, animate: boolean): void {
    const z = view.zones,
      { width, height } = view.size;
    back.clear();
    front.clear();
    glow.clear();
    // Lift beams: chevrons rising up the column.
    for (const [x, y, w, h] of z.lifts)
      for (let i = 0; i < 9; i++) {
        const t = animate ? (ms * 0.00022 + i / 9) % 1 : i / 9,
          cy = y + h - t * h,
          cx = x + w / 2;
        back
          .lineStyle(3, NEON.cyan, 0.18 + 0.3 * Math.sin(t * Math.PI))
          .lineBetween(cx - 20, cy + 10, cx, cy)
          .lineBetween(cx, cy, cx + 20, cy + 10);
      }
    // The low-gravity wing's floating motes.
    for (const [x, y, w, h] of z.lowGravity)
      for (let i = 0; i < 16; i++) {
        const t = animate ? (ms * 0.00005 + i * 0.137) % 1 : (i * 0.37) % 1;
        back
          .fillStyle(NEON.violet, 0.5)
          .fillCircle(
            x +
              ((i * 0.618 * w) % w) +
              (animate ? Math.sin(ms / 900 + i) * 10 : 0),
            y + h - t * h,
            2 + (i % 3),
          );
      }
    if (z.bonus) {
      const [x, y, w, h] = z.bonus,
        pulse = animate ? 0.5 + 0.5 * Math.sin(ms / 420) : 0.6;
      back
        .fillStyle(NEON.gold, 0.04 + 0.05 * pulse)
        .fillRect(x - 8, y, w + 16, h);
    }
    // Pads: chevrons pulsing upward.
    for (const [x, y, w] of z.pads)
      for (let j = 0; j < 3; j++) {
        const a = animate
            ? 0.25 + 0.75 * (1 - ((ms / 650 + (2 - j) / 3) % 1))
            : [1, 0.7, 0.45][j]!,
          cx = x + w / 2,
          cy = y - 18 - j * 15;
        front
          .lineStyle(4, NEON.amber, a)
          .lineBetween(cx - 18, cy + 7, cx, cy - 4)
          .lineBetween(cx, cy - 4, cx + 18, cy + 7);
        glow.fillStyle(NEON.amber, 0.12 * a).fillCircle(cx, cy, 16);
      }
    // The electrified floor, its arcs, and the sudden-death cap it rises to.
    if (z.floor) {
      const { y, cap, rising, warning } = z.floor;
      front.fillStyle(0x2c0010, 0.9).fillRect(0, y, width, height - y);
      front.lineStyle(1, NEON.red, 0.35);
      for (let gx = 20; gx < width; gx += 40)
        front.lineBetween(gx, y + 6, gx, height);
      front.lineStyle(3, NEON.red, 1).lineBetween(0, y, width, y);
      glow
        .fillStyle(NEON.red, rising ? 0.3 : 0.18)
        .fillRect(0, y - 26, width, 26);
      const seed = animate ? Math.floor(ms / 60) : 0,
        rand = random(seed + 17);
      front.lineStyle(1.5, 0xffc2cc, 0.85);
      for (let i = 0; i < 26; i++) {
        let px = (i + rand()) * (width / 26),
          py = y;
        for (let k = 0; k < 4; k++) {
          const nx = px + 6 + rand() * 10,
            ny = y - 4 - rand() * 16;
          front.lineBetween(px, py, nx, ny);
          px = nx;
          py = ny;
        }
      }
      if (rising || warning) {
        const blink = animate ? 0.5 + 0.5 * Math.sin(ms / 140) : 1;
        front.lineStyle(2, NEON.red, 0.4 + 0.5 * blink);
        dashed(front, 0, cap, width, cap, 26, 16);
      }
      banner
        .setVisible(!!warning || rising)
        .setText(
          warning
            ? `SUDDEN DEATH IN ${warning}`
            : "SUDDEN DEATH · THE FLOOR RISES",
        )
        .setPosition(width / 2, 30);
    } else banner.setVisible(false);
    // Laser gates: emitters, a dashed telegraph, then the live sweeping beam.
    for (const l of z.lasers) {
      const [ax, ay, bx, by] = l.from,
        [cx, cy, dx, dy] = l.to;
      front.fillStyle(0x2a0a14, 1).lineStyle(2, NEON.red, 0.9);
      for (const [ex, ey] of [
        [ax, ay],
        [bx, by],
        [cx, cy],
        [dx, dy],
      ] as const)
        front
          .fillRect(ex - 5, ey - 5, 10, 10)
          .strokeRect(ex - 5, ey - 5, 10, 10);
      if (l.phase === "telegraph") {
        const blink = animate ? 0.55 + 0.45 * Math.sin(ms / 70) : 1;
        front.lineStyle(2, NEON.red, 0.9 * blink);
        dashed(front, ax, ay, bx, by, 12, 9);
        front.lineStyle(1, NEON.red, 0.35);
        dashed(front, cx, cy, dx, dy, 6, 12);
        front
          .fillStyle(NEON.red, 0.05)
          .fillRect(
            Math.min(ax, cx),
            Math.min(ay, cy),
            Math.max(bx, dx) - Math.min(ax, cx) || 4,
            Math.max(by, dy) - Math.min(ay, cy) || 4,
          );
      } else if (l.phase === "live") {
        const p = l.progress,
          x0 = ax + (cx - ax) * p,
          y0 = ay + (cy - ay) * p,
          x1 = bx + (dx - bx) * p,
          y1 = by + (dy - by) * p;
        glow.lineStyle(18, NEON.red, 0.28).lineBetween(x0, y0, x1, y1);
        glow.lineStyle(8, NEON.red, 0.5).lineBetween(x0, y0, x1, y1);
        front.lineStyle(3, 0xffe3e8, 1).lineBetween(x0, y0, x1, y1);
      }
    }
  }
  return {
    update(view, ms, animate) {
      if (view.map !== map) build(view);
      const z = view.zones,
        key = JSON.stringify([
          z.pads,
          z.lifts,
          z.lowGravity,
          z.floor && [z.floor.base, z.floor.cap],
          z.bonus,
          z.multiplier,
        ]);
      if (key !== zoneKey) {
        zoneKey = key;
        paintZones(z, view.size.width, view.size.height);
      }
      const state = animate ? `t${Math.floor(ms / 33)}` : live(z);
      if (state !== liveKey) {
        liveKey = state;
        paintLive(view, ms, animate);
      }
      boards.forEach((b, i) => {
        // A holographic flicker with the odd dropout.
        const drop = animate && Math.floor(ms / 130 + i * 37) % 23 === 0;
        const alpha = animate
          ? drop
            ? 0.25
            : 0.52 + 0.14 * Math.sin(ms / 97 + i * 2)
          : 0.6;
        b.g.setAlpha(alpha);
        b.label.setAlpha(alpha);
      });
    },
    destroy() {
      for (const o of [
        backdrop,
        panels,
        panelGlow,
        zoneBase,
        zoneFront,
        back,
        front,
        glow,
        wingLabel,
        crownLabel,
        banner,
        ...liftLabels,
        ...boards.flatMap((b) => [b.g, b.label]),
      ])
        o.destroy();
    },
  };
}
