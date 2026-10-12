import { ART_BY_ID, type ArtAsset } from "../../art/assets.js";

/**
 * Fuse Lane's pictures: every raster image is loaded by id from the art table (`art/assets.ts`), on first use, and
 * anything whose file is missing (or still loading) is drawn as its placeholder, a coloured shape with a short label.
 * The game is fully playable before a single PNG exists; dropping a file into `public/` at its path is all it takes.
 */
export interface ArtImage {
  readonly complete: boolean;
  readonly naturalWidth: number;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface Art {
  /** The asset for an id, or undefined for an id the table does not have. */
  asset(id: string): ArtAsset | undefined;
  /** The loaded image for an id, or undefined while it loads or when its file is missing. Starts the load. */
  image(id: string): ArtImage | undefined;
  /** Draws an asset with its anchor at (x, y), `width` wide (height by aspect), or its placeholder. */
  draw(
    context: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    width: number,
    frame?: number,
  ): void;
  /** A DOM element showing the asset at `size` px: the placeholder, swapped for the picture once it loads. */
  element(id: string, size: number, className?: string): HTMLElement;
}

export function createArt(
  base: string,
  makeImage: () => ArtImage,
  document?: Document,
): Art {
  const images = new Map<string, ArtImage>();
  const failed = new Set<string>();
  const waiting = new Map<string, (() => void)[]>();
  function load(id: string): ArtImage | undefined {
    const asset = ART_BY_ID.get(id);
    if (!asset || failed.has(id)) return;
    let image = images.get(id);
    if (!image) {
      image = makeImage();
      images.set(id, image);
      image.onload = () => {
        for (const done of waiting.get(id) ?? []) done();
        waiting.delete(id);
      };
      image.onerror = () => {
        failed.add(id);
        waiting.delete(id);
      };
      image.src = `${base}${asset.file}`;
    }
    return image.complete && image.naturalWidth > 0 ? image : undefined;
  }
  return {
    asset: (id) => ART_BY_ID.get(id),
    image: load,
    draw(context, id, x, y, width, frame = 0) {
      const asset = ART_BY_ID.get(id);
      if (!asset) return;
      const frames = asset.frames ?? 1,
        frameWidth = asset.width / frames,
        height = (width * asset.height) / frameWidth,
        left = x - asset.anchor[0] * width,
        top = y - asset.anchor[1] * height;
      const image = load(id);
      if (image) {
        context.drawImage(
          image as unknown as CanvasImageSource,
          (frame % frames) * frameWidth,
          0,
          frameWidth,
          asset.height,
          left,
          top,
          width,
          height,
        );
        return;
      }
      placeholder(context, asset, left, top, width, height);
    },
    element(id, size, className = "") {
      const doc = document ?? globalThis.document;
      const asset = ART_BY_ID.get(id);
      const box = doc.createElement("span");
      box.className = `fl-art ${className}`.trim();
      box.style.setProperty("--art-size", `${size}px`);
      if (!asset) return box;
      box.style.setProperty("--art-color", asset.color);
      box.dataset.label = asset.label;
      box.setAttribute("aria-hidden", "true");
      const show = () => {
        const image = load(id);
        if (!image) return;
        const img = doc.createElement("img");
        img.src = image.src;
        img.alt = "";
        box.classList.add("loaded");
        box.replaceChildren(img);
      };
      if (load(id)) show();
      else if (!failed.has(id)) {
        const list = waiting.get(id) ?? [];
        list.push(show);
        waiting.set(id, list);
      }
      return box;
    },
  };
}

/** A missing picture: a rounded block in the asset's colour with its label, shaped by what kind of asset it is. */
function placeholder(
  context: CanvasRenderingContext2D,
  asset: ArtAsset,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  context.save();
  if (asset.id.startsWith("building-")) {
    // A little house: a body and a roof, on the bottom of the box.
    const w = width * 0.72,
      h = height * 0.5,
      x = left + (width - w) / 2,
      y = top + height * 0.92 - h;
    context.fillStyle = "#0b1d3a33";
    context.beginPath();
    context.ellipse(
      left + width / 2,
      top + height * 0.92,
      w * 0.62,
      h * 0.16,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = asset.color;
    context.strokeStyle = "#16213e";
    context.lineWidth = Math.max(1.5, width * 0.03);
    roundRect(context, x, y, w, h, w * 0.08);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - w * 0.08, y + 1);
    context.lineTo(x + w / 2, y - h * 0.55);
    context.lineTo(x + w * 1.08, y + 1);
    context.closePath();
    context.fillStyle = shade(asset.color, -0.25);
    context.fill();
    context.stroke();
    context.fillStyle = "#16213e";
    roundRect(context, x + w * 0.4, y + h * 0.5, w * 0.2, h * 0.5, w * 0.03);
    context.fill();
    label(context, asset.label, left + width / 2, y + h * 0.3, w * 0.24);
  } else if (asset.id.startsWith("avatar-")) {
    const r = Math.min(width, height) * 0.32;
    const cx = left + width / 2,
      cy = top + height - r * 1.15;
    context.fillStyle = "#0b1d3a40";
    context.beginPath();
    context.ellipse(cx, top + height * 0.95, r, r * 0.3, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = asset.color;
    context.strokeStyle = "#16213e";
    context.lineWidth = Math.max(1.5, r * 0.18);
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    label(context, asset.label, cx, cy, r * 0.9);
  } else {
    context.fillStyle = asset.color;
    roundRect(context, left, top, width, height, Math.min(width, height) * 0.2);
    context.fill();
    if (asset.label)
      label(
        context,
        asset.label,
        left + width / 2,
        top + height / 2,
        Math.min(width, height) * 0.3,
      );
  }
  context.restore();
}

function label(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  context.fillStyle = "#16213e";
  context.font = `700 ${Math.max(6, size)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
}

export function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

/** A hex colour lightened (amount > 0) or darkened (< 0). */
export function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 255;
    return Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
