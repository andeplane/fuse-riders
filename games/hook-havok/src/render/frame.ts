import Phaser from "phaser";

/**
 * Foreground framing in the concept art's manner: dark inked pillars, hanging
 * chains and bells at the edges, plus a vignette. Decorative only: it stays in
 * the outer 60 units and above y 130 at the corners, where no map has a ledge,
 * and never participates in collision.
 */
export interface Frame {
  update(ms: number, animate: boolean): void;
  destroy(): void;
}
const INK = 0x04050a,
  STONE = 0x0b0d16,
  RIM = 0xd9a35a;

function pillar(g: Phaser.GameObjects.Graphics, side: -1 | 1): void {
  const x = (v: number) => (side < 0 ? v : 1600 - v);
  // Irregular hand-cut outline: wider at the base and crown, pinched mid-height.
  const edge = [
    [0, 0],
    [74, 0],
    [66, 38],
    [52, 60],
    [44, 150],
    [38, 330],
    [30, 520],
    [36, 700],
    [48, 820],
    [62, 900],
    [0, 900],
  ] as const;
  g.fillStyle(STONE, 0.94).beginPath();
  g.moveTo(x(edge[0][0]), edge[0][1]);
  for (const [px, py] of edge.slice(1)) g.lineTo(x(px), py);
  g.closePath().fillPath();
  g.lineStyle(4, INK, 1).beginPath();
  g.moveTo(x(edge[1][0]), edge[1][1]);
  for (const [px, py] of edge.slice(2, -1)) g.lineTo(x(px), py);
  g.strokePath();
  // Warm rim light along the inner edge, broken like a brush stroke.
  g.lineStyle(1.5, RIM, 0.32);
  for (let i = 3; i < edge.length - 2; i += 2) {
    const [ax, ay] = edge[i]!,
      [bx, by] = edge[i + 1]!;
    g.lineBetween(x(ax - 3), ay + 6, x(bx - 3), by - 10);
  }
  // Mortar courses.
  g.lineStyle(2, INK, 0.7);
  for (let y = 90; y < 880; y += 74 + ((y * 7) % 23))
    g.lineBetween(x(0), y, x(28 + ((y * 13) % 11)), y + 3);
}

function chain(
  g: Phaser.GameObjects.Graphics,
  x: number,
  length: number,
  sway: number,
): { x: number; y: number } {
  let px = x,
    py = 0;
  g.lineStyle(3, INK, 1);
  for (let i = 0; i < length; i += 12) {
    const t = i / length,
      nx = x + Math.sin(t * 1.4) * sway * t * 18,
      ny = i + 12;
    g.strokeEllipse((px + nx) / 2, (py + ny) / 2, 7, 13);
    px = nx;
    py = ny;
  }
  return { x: px, y: py };
}

function bell(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  tilt: number,
): void {
  const at = (dx: number, dy: number) =>
    new Phaser.Math.Vector2(
      x + dx * Math.cos(tilt) - dy * Math.sin(tilt),
      y + dx * Math.sin(tilt) + dy * Math.cos(tilt),
    );
  const outline = [
    [-8, 0],
    [8, 0],
    [16, 12],
    [20, 34],
    [30, 54],
    [34, 62],
    [-34, 62],
    [-30, 54],
    [-20, 34],
    [-16, 12],
  ].map(([dx, dy]) => at(dx!, dy!));
  g.fillStyle(STONE, 1).fillPoints(outline, true);
  g.lineStyle(3.5, INK, 1).strokePoints(outline, true);
  const lip = [at(-30, 56), at(-10, 50), at(12, 50), at(30, 56)];
  g.lineStyle(1.5, RIM, 0.45).strokePoints(lip, false);
  const clapper = at(0, 68);
  g.fillStyle(INK, 1).fillCircle(clapper.x, clapper.y, 6);
}

export function createFrame(scene: Phaser.Scene): Frame {
  // Pillars sit just behind keepers so a keeper at the wall stays readable.
  const still = scene.add.graphics().setDepth(4),
    swinging = scene.add.graphics().setDepth(17);
  pillar(still, -1);
  pillar(still, 1);
  // Ivy fronds low at the corners, below every ledge.
  still.fillStyle(INK, 0.9);
  for (const [cx, dir] of [
    [0, 1],
    [1600, -1],
  ] as const)
    for (let i = 0; i < 5; i++)
      still.fillEllipse(cx + dir * (18 + i * 16), 900 - (i % 2) * 14, 34, 16);
  const key = "hook-havok-vignette";
  if (!scene.textures.exists(key)) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 288;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot prepare the arena frame.");
    const gradient = ctx.createRadialGradient(256, 130, 90, 256, 144, 300);
    gradient.addColorStop(0, "rgba(4,5,10,0)");
    gradient.addColorStop(0.62, "rgba(4,5,10,0.12)");
    gradient.addColorStop(1, "rgba(4,5,10,0.62)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 288);
    scene.textures.addCanvas(key, canvas);
  }
  const vignette = scene.add
    .image(800, 450, key)
    .setDisplaySize(1600, 900)
    .setDepth(19);
  let last = -1;
  return {
    update(ms, animate) {
      // Redraw at about 20 fps: the sway is slow and the cost stays small.
      const frame = animate ? Math.floor(ms / 50) : 0;
      if (frame === last) return;
      last = frame;
      const t = frame / 20;
      swinging.clear();
      for (const [x, length, phase] of [
        [120, 70, 0],
        [1480, 86, 1.7],
      ] as const) {
        const sway = animate ? Math.sin(t * 0.9 + phase) : 0;
        const end = chain(swinging, x, length, sway);
        bell(swinging, end.x, end.y, sway * 0.05);
      }
      for (const [x, length, phase] of [
        [44, 230, 0.6],
        [1556, 190, 2.4],
      ] as const)
        chain(swinging, x, length, animate ? Math.sin(t * 0.7 + phase) : 0);
    },
    destroy() {
      still.destroy();
      swinging.destroy();
      vignette.destroy();
    },
  };
}
