import Phaser from "phaser";
import { boil } from "./art.js";

/**
 * Painterly light and texture, all cosmetic: additive light shafts with drifting
 * motes, a lantern halo around each keeper, and a faint paper grain that gives
 * the flat vector work a hand-drawn surface. Nothing here reads the rules.
 */
export interface Light {
  setMap(map: string): void;
  update(
    ms: number,
    animate: boolean,
    keepers: readonly { x: number; y: number; color: number; alpha: number }[],
  ): void;
  destroy(): void;
}
/** Where the backdrop's light comes from: Crossroads' rose window, Belfry's moon. */
const SOURCES: Record<
  string,
  { x: number; y: number; spread: number; tint: number }
> = {
  crossroads: { x: 800, y: 130, spread: 1, tint: 0xa9b8ff },
  belfry: { x: 520, y: 60, spread: 0.8, tint: 0xb8c4ee },
};
const MOTES = 36;

function grainTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot prepare the paper texture.");
  const image = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    // Fibrous paper: fine noise plus faint horizontal tooth.
    const fibre = Math.sin((i % 256) * 0.21 + Math.floor(i / 256) * 1.7) * 5;
    const v = 238 + boil(i, 3) * 14 + fibre;
    image.data.set([v, v, v * 0.985, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  scene.textures.addCanvas(key, canvas);
}

export function createLight(scene: Phaser.Scene): Light {
  const rays = scene.add
      .graphics()
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.ADD),
    motes = scene.add
      .graphics()
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.ADD);
  grainTexture(scene, "hook-havok-grain");
  const grain = scene.add
    .tileSprite(800, 450, 1600, 900, "hook-havok-grain")
    .setDepth(18)
    .setBlendMode(Phaser.BlendModes.MULTIPLY)
    .setAlpha(0.55);
  const halos: Phaser.GameObjects.Image[] = [];
  let source = SOURCES.crossroads!,
    lastRays = -1;
  return {
    setMap(map) {
      source = SOURCES[map] ?? SOURCES.crossroads!;
      lastRays = -1;
    },
    update(ms, animate, keepers) {
      // Shafts breathe slowly; redraw at 10 fps.
      const frame = animate ? Math.floor(ms / 100) : 0;
      if (frame !== lastRays) {
        lastRays = frame;
        rays.clear();
        for (let beam = 0; beam < 5; beam++) {
          const angle = (beam - 2) * 0.2 * source.spread,
            breathe = animate
              ? 0.75 + 0.25 * Math.sin(frame / 14 + beam * 1.9)
              : 0.85,
            reach = 980,
            tipX = source.x + Math.sin(angle) * reach,
            tipY = source.y + Math.cos(angle) * reach;
          // Nested wedges fake a soft falloff across the shaft.
          for (const [width, alpha] of [
            [110, 0.018],
            [70, 0.022],
            [34, 0.03],
          ] as const) {
            const w = width * (0.8 + (beam % 2) * 0.4),
              ox = Math.cos(angle) * w,
              oy = -Math.sin(angle) * w;
            rays
              .fillStyle(source.tint, alpha * breathe)
              .fillPoints(
                [
                  new Phaser.Math.Vector2(source.x - 6, source.y),
                  new Phaser.Math.Vector2(source.x + 6, source.y),
                  new Phaser.Math.Vector2(tipX + ox, tipY + oy),
                  new Phaser.Math.Vector2(tipX - ox, tipY - oy),
                ],
                true,
              );
          }
        }
      }
      motes.clear();
      if (animate)
        for (let i = 0; i < MOTES; i++) {
          const beam = (i % 5) - 2,
            angle = beam * 0.2 * source.spread,
            t = ((ms * (0.00004 + (i % 4) * 0.00001) + i * 0.137) % 1) * 0.9,
            wobble = Math.sin(ms / 1300 + i) * 18;
          motes
            .fillStyle(0xfff0cf, 0.22 + 0.2 * Math.sin(ms / 600 + i * 2.3))
            .fillCircle(
              source.x + Math.sin(angle) * 900 * t + wobble,
              source.y + Math.cos(angle) * 900 * t,
              1 + (i % 3) * 0.6,
            );
        }
      keepers.forEach((k, i) => {
        const halo = (halos[i] ??= scene.add
          .image(0, 0, "warm")
          .setDepth(9.5)
          .setBlendMode(Phaser.BlendModes.ADD));
        const flicker = animate ? 0.9 + 0.1 * Math.sin(ms / 170 + i * 3) : 1;
        halo
          .setVisible(true)
          .setPosition(k.x, k.y)
          .setDisplaySize(120, 120)
          .setTint(k.color)
          .setAlpha(0.3 * k.alpha * flicker);
      });
      for (let i = keepers.length; i < halos.length; i++)
        halos[i]!.setVisible(false);
    },
    destroy() {
      rays.destroy();
      motes.destroy();
      grain.destroy();
      halos.forEach((h) => h.destroy());
    },
  };
}

/**
 * A heavy inked stone keel under a ledge, like the concept art’s floating
 * slabs, baked once into a painted canvas (gradient shading, brush-dab
 * texture, joints, drips, ink outline). It sits behind the ledge art and
 * hangs at most 32 units below it, so the next row down stays clear.
 * Returns the texture key and its world rectangle.
 */
export function keelTexture(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  shown: number,
  index: number,
): { key: string; x: number; y: number; width: number; height: number } {
  const top = y + shown * 0.45,
    height = shown * 0.55 + 34,
    key = `keel-${index}-${width}-${shown}`,
    area = { key, x, y: top, width, height };
  if (scene.textures.exists(key)) return area;
  const k = 2,
    canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * k);
  canvas.height = Math.ceil(height * k);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot prepare ledge stonework.");
  ctx.scale(k, k);
  const inset = width * 0.07,
    steps = Math.max(4, Math.round(width / 34)),
    variant = index % 3,
    base = shown * 0.55;
  const points: [number, number][] = [[inset * 0.4, 0]];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      // Three silhouettes: a central drop, a double drop and a broken shelf.
      shape =
        variant === 0
          ? Math.sin(t * Math.PI)
          : variant === 1
            ? Math.abs(Math.sin(t * Math.PI * 2)) * 0.8 + 0.2
            : 0.55 + 0.45 * Math.sin(t * Math.PI) * (t > 0.6 ? 0.5 : 1);
    points.push([
      inset + (width - inset * 2) * t,
      base + shape * 18 + boil(index * 31 + i, 7) * 4 + 4,
    ]);
  }
  points.push([width - inset * 0.4, 0]);
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(...points[0]!);
    for (const p of points.slice(1)) ctx.lineTo(...p);
    ctx.closePath();
  };
  ctx.save();
  outline();
  ctx.clip();
  // Upper-left light: pale slate at the shoulder falling into violet shadow.
  const shade = ctx.createLinearGradient(0, 0, width * 0.3, height);
  shade.addColorStop(0, "#5a5c74");
  shade.addColorStop(0.45, "#34354a");
  shade.addColorStop(1, "#12121c");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  // Brush dabs give the flat fill a painted surface.
  for (let i = 0; i < width * 0.9; i++) {
    const dx = ((boil(index, i) + 1) / 2) * width,
      dy = ((boil(index + 5, i) + 1) / 2) * height,
      light = boil(i, index + 2) > 0;
    ctx.fillStyle = light ? "rgba(150,150,180,0.13)" : "rgba(5,6,12,0.18)";
    ctx.beginPath();
    ctx.ellipse(
      dx,
      dy,
      3 + Math.abs(boil(i, 9)) * 5,
      1.5 + Math.abs(boil(i, 4)) * 2,
      0.3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(5,6,11,0.55)";
  ctx.lineWidth = 1.3;
  for (let i = 1; i < steps; i++)
    if ((i + variant) % 2) {
      const [px, py] = points[i + 1]!;
      ctx.beginPath();
      ctx.moveTo(px + boil(index, i) * 4, 3);
      ctx.lineTo(px, py - 5);
      ctx.stroke();
    }
  ctx.restore();
  // Stalactite drips below the outline, then the ink over everything.
  ctx.fillStyle = "#1d1e2b";
  ctx.strokeStyle = "#05060b";
  ctx.lineWidth = 1.5;
  for (let i = 2; i < steps; i += 3) {
    const [px, py] = points[i]!,
      drop = 7 + Math.abs(boil(index, i + 9)) * 9;
    ctx.beginPath();
    ctx.moveTo(px - 5, py - 2);
    ctx.lineTo(px + 5, py - 2);
    ctx.lineTo(px + boil(index, i) * 2, Math.min(height - 1, py + drop));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  outline();
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.strokeStyle = "rgba(200,196,215,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(points[1]![0], points[1]![1] - 4);
  ctx.lineTo(
    points[Math.ceil(steps / 3)]![0],
    points[Math.ceil(steps / 3)]![1] - 5,
  );
  ctx.stroke();
  scene.textures.addCanvas(key, canvas);
  return area;
}
