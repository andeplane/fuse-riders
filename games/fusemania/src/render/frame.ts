import { pixelFont } from "./palette.js";
import type { Pen } from "./pen.js";
import type { Icons, Sprite } from "./sprites.js";

/** What every part of one frame draws with: the pen, the moment, and the player's settings. */
export interface Frame {
  pen: Pen;
  /** Device pixels per CSS pixel. */
  unit: number;
  songMs: number;
  beat: number;
  speed: number;
  down: boolean;
  /** Reduced motion: no pulses, bounces, flashes or shakes of the chrome. */
  calm: boolean;
  /** A battle: item notes are capsules. */
  battle: boolean;
  seed: number;
  itemKey: string;
  /** More than one rider: places and gaps are shown. */
  multi: boolean;
  icons: Icons;
}

/**
 * Draws a sprite centred on (x, y). Upright and full size it lands on whole pixels, which keeps its edges crisp;
 * scaled or turned it is drawn where it is.
 */
export function blit(
  g: Pen,
  sprite: Sprite,
  x: number,
  y: number,
  alpha: number,
  scale: number,
  rotation: number,
): void {
  if (alpha <= 0.004) return;
  g.globalAlpha = alpha > 1 ? 1 : alpha;
  if (rotation !== 0) {
    const cos = Math.cos(rotation) * scale,
      sin = Math.sin(rotation) * scale;
    g.setTransform(cos, sin, -sin, cos, x, y);
    g.drawImage(sprite.canvas, -sprite.half, -sprite.half);
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else if (scale !== 1) {
    const size = sprite.size * scale;
    g.drawImage(sprite.canvas, x - size / 2, y - size / 2, size, size);
  } else
    g.drawImage(
      sprite.canvas,
      Math.round(x - sprite.half),
      Math.round(y - sprite.half),
    );
}

/** One line of pixel text. The baseline is the frame's ("middle"). */
export function label(
  g: Pen,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign,
  maxWidth: number,
): void {
  g.font = pixelFont(size);
  g.textAlign = align;
  g.fillStyle = color;
  g.fillText(text, x, y, Math.max(1, maxWidth));
}

/** The same with a dark outline under it, for words drawn over the notes. */
export function outlined(
  g: Pen,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  maxWidth: number,
): void {
  g.font = pixelFont(size);
  g.textAlign = "center";
  g.lineJoin = "round";
  // Thick enough to read over a note, and not a blob round a big number.
  g.lineWidth = Math.max(2, Math.min(size * 0.3, 6 + size * 0.1));
  g.strokeStyle = "rgba(3,9,25,0.92)";
  g.strokeText(text, x, y, Math.max(1, maxWidth));
  g.fillStyle = color;
  g.fillText(text, x, y, Math.max(1, maxWidth));
}

// ---- text that changes seldom, built when it changes and not every frame ----

export interface NumberText {
  value: number;
  text: string;
}
export const numberText = (): NumberText => ({ value: Number.NaN, text: "" });

/** A score, seven digits wide. */
export function scoreText(memo: NumberText, value: number): string {
  if (memo.value !== value) {
    memo.value = value;
    memo.text = String(Math.max(0, value)).padStart(7, "0");
  }
  return memo.text;
}
/** A count after a fixed prefix: "x12", "MAX 40". */
export function countText(
  memo: NumberText,
  prefix: string,
  value: number,
): string {
  if (memo.value !== value) {
    memo.value = value;
    memo.text = prefix + value;
  }
  return memo.text;
}
/** A session total with thousands after its label: "TOTAL 1,812,440". */
export function totalText(memo: NumberText, value: number): string {
  if (memo.value !== value) {
    memo.value = value;
    memo.text = `TOTAL ${Math.max(0, value).toLocaleString("en-US")}`;
  }
  return memo.text;
}
/** A gap with its sign and thousands: "+12,340". */
export function gapText(memo: NumberText, value: number): string {
  if (memo.value !== value) {
    memo.value = value;
    memo.text =
      (value < 0 ? "-" : "+") + Math.abs(value).toLocaleString("en-US");
  }
  return memo.text;
}

export interface FittedText {
  source: string;
  chars: number;
  text: string;
}
export const fittedText = (): FittedText => ({
  source: "",
  chars: -1,
  text: "",
});
/** A name in capitals, cut to `chars` characters. */
export function fitText(
  memo: FittedText,
  source: string,
  chars: number,
): string {
  if (memo.source !== source || memo.chars !== chars) {
    memo.source = source;
    memo.chars = chars;
    memo.text = chars <= 0 ? "" : source.toUpperCase().slice(0, chars);
  }
  return memo.text;
}

/** "PRESS SPACE", for the key that throws the power-up. */
export function pressText(memo: FittedText, key: string): string {
  if (memo.source !== key) {
    memo.source = key;
    memo.text = `PRESS ${key.toUpperCase()}`;
  }
  return memo.text;
}

/** One rider's texts, on its field and on its leaderboard box. */
export interface RiderTexts {
  score: NumberText;
  combo: NumberText;
  broken: NumberText;
  gap: NumberText;
  name: FittedText;
  chart: FittedText;
  press: FittedText;
  boxScore: NumberText;
  boxCombo: NumberText;
  boxBest: NumberText;
  boxBroken: NumberText;
  boxTotal: NumberText;
  boxName: FittedText;
  boxChart: FittedText;
}
export const riderTexts = (): RiderTexts => ({
  score: numberText(),
  combo: numberText(),
  broken: numberText(),
  gap: numberText(),
  name: fittedText(),
  chart: fittedText(),
  press: fittedText(),
  boxScore: numberText(),
  boxCombo: numberText(),
  boxBest: numberText(),
  boxBroken: numberText(),
  boxTotal: numberText(),
  boxName: fittedText(),
  boxChart: fittedText(),
});
