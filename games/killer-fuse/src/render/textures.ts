/**
 * Loading the art and putting a frame of it on a canvas. Everything is drawn at whole art pixels, anchored the way
 * the manifest says, so nothing is ever filtered.
 */
import { wrapOffsets } from "./layout.js";
import {
  frameRect,
  parseManifest,
  type ArtManifest,
  type SheetDef,
} from "./manifest.js";

export type Ctx = CanvasRenderingContext2D;

export interface Art {
  readonly manifest: ArtManifest;
  readonly images: ReadonlyMap<string, CanvasImageSource>;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

/** Sheets the arena never draws. */
const SKIPPED = new Set(["cover", "logo"]);

export async function loadArt(artUrl: string): Promise<Art> {
  const response = await fetch(`${artUrl}manifest.json`);
  if (!response.ok) throw new Error(`could not load ${artUrl}manifest.json`);
  const manifest = parseManifest(await response.json());
  const ids = Object.keys(manifest.assets).filter((id) => !SKIPPED.has(id));
  const loaded = await Promise.all(
    ids.map(async (id) => {
      const def = manifest.assets[id];
      return [id, await loadImage(`${artUrl}${def?.file ?? ""}`)] as const;
    }),
  );
  return { manifest, images: new Map(loaded) };
}

export function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** Draws sheets by manifest id and keeps the tinted silhouettes it has made. */
export class Sprites {
  private readonly tinted = new Map<string, HTMLCanvasElement>();

  constructor(readonly art: Art) {}

  def(id: string): SheetDef | undefined {
    return this.art.manifest.assets[id];
  }

  /** The team's ramp, dark to light. */
  ramp(team: number): readonly string[] {
    const teams = this.art.manifest.teams;
    return (
      (team === 1 ? teams.pink : teams.cyan) ?? ["#000", "#888", "#ccc", "#fff"]
    );
  }

  /**
   * One frame with its anchor on (x, y). `flip` mirrors it about the anchor column. The anchor row of a standing
   * thing is its lowest row, so callers pass the surface's y minus one.
   */
  draw(
    ctx: Ctx,
    id: string,
    frame: number,
    x: number,
    y: number,
    flip = false,
    source: CanvasImageSource | undefined = this.art.images.get(id),
  ): void {
    const def = this.def(id);
    if (!def || !source) return;
    const { sx, sy, sw, sh } = frameRect(def, frame);
    const px = Math.round(x),
      py = Math.round(y);
    const [ax, ay] = def.anchor;
    if (!flip) {
      ctx.drawImage(source, sx, sy, sw, sh, px - ax, py - ay, sw, sh);
      return;
    }
    ctx.save();
    ctx.translate(px + ax + 1, py - ay);
    ctx.scale(-1, 1);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.restore();
  }

  /** As `draw`, and again a screen away when the frame hangs over the left or right edge. */
  drawWrapped(
    ctx: Ctx,
    id: string,
    frame: number,
    x: number,
    y: number,
    flip = false,
    source?: CanvasImageSource,
  ): void {
    const def = this.def(id);
    if (!def) return;
    for (const offset of wrapOffsets(x - def.frameWidth, x + def.frameWidth))
      this.draw(
        ctx,
        id,
        frame,
        x + offset,
        y,
        flip,
        source ?? this.art.images.get(id),
      );
  }

  /** The sheet `id` with every opaque pixel in `color`: after-images and glows. */
  silhouette(id: string, color: string): CanvasImageSource | undefined {
    const key = `${id}|${color}`;
    const made = this.tinted.get(key);
    if (made) return made;
    const def = this.def(id);
    const image = this.art.images.get(id);
    if (!def || !image) return undefined;
    const { canvas, ctx } = makeCanvas(def.width, def.height);
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, def.width, def.height);
    this.tinted.set(key, canvas);
    return canvas;
  }
}
