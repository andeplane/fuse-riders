// The game's art, made in code: sprites are small inline SVGs fed to Phaser's loader, and the backdrop and ground
// material are painted with the Canvas 2D API. Only the crate and the fuse's flame and bomb are files, shared
// with Fuse Riders from the site root's public/ (round-scene.ts loads them).

import type Phaser from "phaser";
import { CARDS, type Card } from "../engine/index.js";
import { css, THEMES, type Theme } from "./palette.js";

export const CASTLE_SIZE = { width: 100, height: 80 } as const;
export const SHIELD_SIZE = 128;
/** Launcher texture width and the x of its pivot. */
export const LAUNCHER = { width: 38, pivot: 5 } as const;
/** Rocket texture width and the x of the body centre (the smoke streak trails behind it). */
export const ROCKET = { width: 48, body: 38 } as const;

const INK = "#262a36";
const STONE = "#dfe2e8";
const DOOR = "#3a2a22";

/** Castle on treads; the bottom centre is the ground contact and the launcher pivot sits on the turret dome. */
const castle = (roof: string): string => `
<g stroke="${INK}" stroke-width="2" stroke-linejoin="round">
  <path d="M40 30a10 10 0 0 1 20 0v8H40z" fill="#7d8594"/>
  <path d="M26 38h48v30H26zM29 33h7v5h-7zM41 33h7v5h-7zM53 33h7v5h-7zM65 33h7v5h-7z" fill="${STONE}"/>
  <path d="M27 46h46M27 54h46M27 62h46M32 39v7M44 39v7M56 39v7M68 39v7M38 46v8M50 46v8M62 46v8M32 54v8M44 54v8M56 54v8M68 54v8"
    stroke="#aeb4c2" stroke-width="1.5"/>
  <path d="M43 68v-10a7 7 0 0 1 14 0v10z" fill="${DOOR}"/>
  <path d="M15 30h16v38H15zM69 30h16v38H69z" fill="${STONE}"/>
  <path d="M21 38h4v8h-4zM75 38h4v8h-4z" fill="${DOOR}" stroke="none"/>
  <path d="M11 31h24L23 6zM65 31h24L77 6z" fill="${roof}"/>
  <path d="M16 30h5l2-20zM70 30h5l2-20z" fill="#fff" fill-opacity=".35" stroke="none"/>
  <path d="M30.5 33a4.5 4.5 0 0 1 9 0a4.5 4.5 0 0 1-9 0zM60.5 33a4.5 4.5 0 0 1 9 0a4.5 4.5 0 0 1-9 0z"
    fill="#fbfbf2" stroke-width="1.5"/>
  <path d="M32.5 32h2v2h-2zM35.5 32h2v2h-2zM62.5 32h2v2h-2zM65.5 32h2v2h-2z" fill="${INK}" stroke="none"/>
  <rect x="14" y="66" width="72" height="13" rx="6.5" fill="#3d424f" stroke="#171a21" stroke-width="2.5"/>
  <g fill="#9aa2b3" stroke="#171a21" stroke-width="1.5">
    ${[24, 37, 50, 63, 76].map((x) => `<circle cx="${x}" cy="72.5" r="4.5"/>`).join("")}
  </g>
</g>`;

const launcher = (band: string): string => `
<linearGradient id="m" x2="0" y2="1"><stop stop-color="#8f98a8"/><stop offset="1" stop-color="#343a47"/></linearGradient>
<g stroke="${INK}" stroke-width="2">
  <rect x="2" y="3" width="32" height="10" rx="4" fill="url(#m)"/>
  <rect x="16" y="4" width="6" height="8" fill="${band}" stroke="none"/>
  <rect x="29" y="1" width="7" height="14" rx="2" fill="#5d6575"/>
</g>`;

/** Flying right, with its smoke streak baked in so a thousand rockets cost one image each. */
const rocket = (body: string): string => `
<linearGradient id="s"><stop stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".75"/></linearGradient>
<path d="M0 7L30 3v8z" fill="url(#s)"/>
<ellipse cx="30" cy="7" rx="5" ry="3" fill="#ffb52e"/>
<path d="M32 3h10q6 4 0 8H32z" fill="${body}" stroke="${INK}" stroke-width="1.5"/>
<path d="M38 4.5h2v5h-2z" fill="#fff"/>`;

/** Ghost blimp texture size; the envelope's centre (the engine's ghost position) sits at `centerY`. */
export const BLIMP = { width: 96, height: 56, centerY: 24 } as const;

/** A friendly ghost blimp heading right: the player's colour, tail fins, big eyes and a gondola. */
const blimp = (body: string): string => `
<g stroke="${INK}" stroke-width="2" stroke-linejoin="round">
  <path d="M22 18L4 5h11l14 11zM22 30L4 43h11l14-11z" fill="${body}"/>
  <ellipse cx="52" cy="24" rx="40" ry="18" fill="${body}"/>
  <path d="M38 41h26l-4 10H42z" fill="#3d424f"/>
  <path d="M44 41l-3-4M58 41l3-4" stroke-width="1.5"/>
  <ellipse cx="74" cy="19" rx="5" ry="6.5" fill="#fbfbf2" stroke-width="1.5"/>
  <ellipse cx="85" cy="19" rx="4" ry="6" fill="#fbfbf2" stroke-width="1.5"/>
</g>
<path d="M22 14q30-12 62 0" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
<path d="M75 18h3v4h-3zM86 18h2.5v4H86z" fill="${INK}"/>
<path d="M45 44h3v4h-3zM51 44h3v4h-3zM57 44h3v4h-3z" fill="#ffe28a"/>`;

/** A ghost's bomb, nose right: fat and dark with fins and a band in the owner's colour, no smoke streak. */
const ghostBomb = (fins: string): string => `
<path d="M2 3l9 5-9 5z" fill="${fins}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
<ellipse cx="18" cy="8" rx="11" ry="6.5" fill="#2a2d38" stroke="#0c0d12" stroke-width="1.5"/>
<path d="M12 2.8h3.5v10.4H12z" fill="${fins}"/>
<ellipse cx="22" cy="5.5" rx="3.5" ry="1.6" fill="#fff" fill-opacity=".5"/>`;

/** The castle sprite as standalone SVG markup, for menus drawn outside Phaser. */
export function castleSvg(color: number): string {
  const { width, height } = CASTLE_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${castle(css(color))}</svg>`;
}

const BOMB = `
<circle cx="10" cy="12" r="7" fill="#2a2d38" stroke="#0c0d12" stroke-width="1.5"/>
<circle cx="7.5" cy="9.5" r="2" fill="#fff" fill-opacity=".45"/>
<circle cx="14" cy="4" r="2.5" fill="#ffcf3a"/>`;

/** White bubble with a hexagon lattice; tinted per player. */
const SHIELD = `
<radialGradient id="g"><stop offset=".3" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity=".4"/></radialGradient>
<pattern id="h" width="19.05" height="33" patternUnits="userSpaceOnUse">
  <path d="M0 5.5L9.53 0l9.52 5.5v11l-9.52 5.5L0 16.5zM9.53 22v11" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.5"/>
</pattern>
<clipPath id="c"><circle cx="64" cy="64" r="61"/></clipPath>
<circle cx="64" cy="64" r="61" fill="url(#g)"/>
<rect width="128" height="128" fill="url(#h)" clip-path="url(#c)"/>
<circle cx="64" cy="64" r="61" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="3"/>
<path d="M22 46A46 46 0 0 1 44 22" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"/>`;

/** Badge colour and symbol (an SVG path, or text) per card. */
const CARD_ART: Record<Card, readonly [string, string]> = {
  unit: ["#e8403a", "+1"],
  shield: ["#2f86e8", "M18 7l9 4-1 9-8 9-8-9-1-9z"],
  rapid: ["#f0a800", "M21 5L11 20h6l-3 11 11-16h-6z"],
  repair: ["#3fbf4a", "M15 8h6v7h7v6h-7v7h-6v-7H8v-6h7z"],
  mega: ["#a258e0", "x3"],
};

const card = ([color, symbol]: readonly [string, string]): string => `
<circle cx="18" cy="18" r="15" fill="#fffdf4" stroke="${color}" stroke-width="3"/>
${
  symbol.startsWith("M")
    ? `<path d="${symbol}" fill="${color}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`
    : `<text x="18" y="23.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif"
        font-weight="900" font-size="15" fill="${color}">${symbol}</text>`
}`;

/** Texture key of a player-coloured sprite in `color`, e.g. `castle-e8403a`. */
export function spriteKey(
  kind: "castle" | "launcher" | "rocket" | "blimp" | "ghost-bomb",
  color: number,
): string {
  return `${kind}-${css(color).slice(1)}`;
}

/** Queues every sprite on the scene's loader; call from `preload`. Keys: `spriteKey(kind, color)` per colour,
 * `rocket-bomb`, `shield`, `card-<card>`. */
export function loadSprites(
  scene: Phaser.Scene,
  colors: readonly number[],
): void {
  const add = (key: string, width: number, height: number, body: string) => {
    if (scene.textures.exists(key)) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
    const url = `data:image/svg+xml;base64,${btoa(svg)}`;
    scene.load.svg(key, url, { width, height });
  };
  for (const color of new Set(colors)) {
    const [w, h] = [CASTLE_SIZE.width, CASTLE_SIZE.height];
    add(spriteKey("castle", color), w, h, castle(css(color)));
    add(spriteKey("launcher", color), LAUNCHER.width, 16, launcher(css(color)));
    add(spriteKey("rocket", color), ROCKET.width, 14, rocket(css(color)));
    add(
      spriteKey("blimp", color),
      BLIMP.width,
      BLIMP.height,
      blimp(css(color)),
    );
    add(spriteKey("ghost-bomb", color), 30, 16, ghostBomb(css(color)));
  }
  add("rocket-bomb", 20, 20, BOMB);
  add("shield", SHIELD_SIZE, SHIELD_SIZE, SHIELD);
  for (const c of CARDS) add(`card-${c}`, 36, 36, card(CARD_ART[c]));
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const ctx = element.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas");
  return { element, ctx };
}

/** Sky, sun, clouds and two mountain ranges; the arena terrain is drawn on top. */
function backdrop(theme: Theme, w: number, h: number): HTMLCanvasElement {
  const { element, ctx } = canvas(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  theme.sky.forEach((c, i) => sky.addColorStop(i / (theme.sky.length - 1), c));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(1240, 190, 30, 1240, 190, 170);
  sun.addColorStop(0, theme.sun);
  sun.addColorStop(0.35, `${theme.sun}88`);
  sun.addColorStop(1, `${theme.sun}00`);
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  const random = lcg(7);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (let i = 0; i < 6; i++) {
    const x = random() * w;
    const y = 90 + random() * 200;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(x + k * 28, y - (k % 2) * 12, 34, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const range = (base: number, peak: number, step: number): void => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = -step; x <= w + step; x += step)
      ctx.lineTo(x + random() * step * 0.4, base - random() * peak);
    ctx.lineTo(w, h);
  };
  range(560, 260, 130);
  ctx.fillStyle = theme.far;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = theme.snow;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 20)
    ctx.lineTo(x, 390 + Math.sin(x / 23) * 10 + random() * 12);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.fill();
  ctx.restore();
  range(660, 140, 170);
  ctx.fillStyle = theme.near;
  ctx.fill();
  return element;
}

/** Adds one backdrop texture per theme (`backdrop-N`); call from `create`. */
export function paintBackdrops(
  scene: Phaser.Scene,
  width: number,
  height: number,
): void {
  THEMES.forEach((theme, i) => {
    const key = `backdrop-${i}`;
    if (!scene.textures.exists(key))
      scene.textures.addCanvas(key, backdrop(theme, width, height));
  });
}

/** A full-arena canvas of ground material (layered earth with strata) that the terrain layer cuts to shape. */
export function groundMaterial(
  theme: Theme,
  w: number,
  h: number,
): HTMLCanvasElement {
  const { element, ctx } = canvas(w, h);
  const body = ctx.createLinearGradient(0, h * 0.35, 0, h);
  theme.ground.forEach((c, i) =>
    body.addColorStop(i / (theme.ground.length - 1), c),
  );
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ctx.fillStyle = theme.strata;
  ctx.lineWidth = 5;
  for (let y = 300; y < h; y += 38) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 16)
      ctx.lineTo(x, y + Math.sin(x / 90 + y) * 8);
    ctx.stroke();
  }
  const random = lcg(11);
  for (let i = 0; i < 260; i++) {
    const [x, y] = [random() * w, 300 + random() * (h - 300)];
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + random() * 6, 2 + random() * 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return element;
}
