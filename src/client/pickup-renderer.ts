import type { GameSnapshot } from '../shared/protocol.js';
import type { ThemeDefinition } from './themes.js';

const TICK_HZ = 20;
const PICKUP_FADE_TICKS = 2 * TICK_HZ;
const imageCache = new Map<string, HTMLImageElement | null>();

function pickupImage(theme: ThemeDefinition, type: 'blast' | 'star' | 'beer'): HTMLImageElement | null {
  const key = `${theme.id}:${type}`;
  if (imageCache.has(key)) return imageCache.get(key) ?? null;
  const image = new Image();
  image.decoding = 'async';
  image.addEventListener('error', () => imageCache.set(key, null), { once: true });
  image.addEventListener('load', () => imageCache.set(key, image), { once: true });
  image.src = `/themes/${theme.id}/pickup-${type}.svg`;
  imageCache.set(key, image);
  return image;
}

function fallbackCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const arm = size * 0.3;
  ctx.fillStyle = '#ff7b16';
  ctx.fillRect(x - arm, y - size / 2, arm * 2, size);
  ctx.fillRect(x - size / 2, y - arm, size, arm * 2);
  ctx.fillStyle = '#fff6b0';
  ctx.fillRect(x - arm * 0.42, y - arm * 0.42, arm * 0.84, arm * 0.84);
}

function fallbackStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? size / 2 : size / 4.5;
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffdb35';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 2, y - 2, 4, 4);
}

function fallbackBeer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const left = x - size * 0.27; const top = y - size * 0.35;
  ctx.fillStyle = '#ff9d19'; ctx.fillRect(left, top, size * 0.46, size * 0.67);
  ctx.fillStyle = '#ffe37a'; ctx.fillRect(left, top, size * 0.46, size * 0.13);
  ctx.strokeStyle = '#d9f7ff'; ctx.lineWidth = 3; ctx.strokeRect(left - 1, top - 1, size * 0.5, size * 0.72);
  ctx.strokeRect(x + size * 0.18, y - size * 0.15, size * 0.2, size * 0.32);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.save();
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#030817';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Draws public pickups in world coordinates. `tick` is authoritative snapshot time. */
export function drawPickups(
  ctx: CanvasRenderingContext2D,
  snapshot: GameSnapshot,
  tick: number,
  now: number,
  theme: ThemeDefinition,
): void {
  for (const pickup of snapshot.pickups) {
    const remaining = pickup.expiresAtTick - tick;
    if (remaining <= 0) continue;
    const alpha = remaining < PICKUP_FADE_TICKS ? Math.max(0.15, remaining / PICKUP_FADE_TICKS) : 1;
    const pulse = 1 + Math.sin(now / 180 + pickup.id) * 0.06;
    const size = 34 * pulse;
    const image = pickupImage(theme, pickup.type);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = pickup.type === 'blast' ? '#ff7b16' : pickup.type === 'beer' ? '#b85cff' : '#ffe45c';
    ctx.shadowBlur = 5;
    if (image?.complete && image.naturalWidth > 0) ctx.drawImage(image, pickup.x - size / 2, pickup.y - size / 2, size, size);
    else if (pickup.type === 'blast') fallbackCross(ctx, pickup.x, pickup.y, size);
    else if (pickup.type === 'beer') fallbackBeer(ctx, pickup.x, pickup.y, size);
    else fallbackStar(ctx, pickup.x, pickup.y, size);
    ctx.restore();
    const text = pickup.type === 'blast' ? 'BLAST+' : pickup.type === 'beer' ? 'BEER' : 'STAR';
    const color = pickup.type === 'blast' ? '#ffbd3e' : pickup.type === 'beer' ? '#d89cff' : '#fff04a';
    label(ctx, text, pickup.x, pickup.y + size * 0.62, color);
  }
}

/** Draws the authoritative drunk timer as a restrained amber/purple orbit. */
export function drawDrunkAura(
  ctx: CanvasRenderingContext2D,
  player: GameSnapshot['players'][number],
  tick: number,
  now: number,
): void {
  const remaining = player.drunkUntilTick - tick;
  if (remaining <= 0) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(Math.sin(now / 170) * 0.18);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#b75cff'; ctx.shadowColor = '#ff9d20'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.ellipse(0, 0, 23, 16, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffb32c';
  for (let index = 0; index < 3; index += 1) {
    const angle = now / 310 + index * Math.PI * 2 / 3;
    ctx.fillRect(Math.cos(angle) * 25 - 2, Math.sin(angle) * 18 - 2, 4, 4);
  }
  ctx.restore();
  label(ctx, `WOBBLE ${(remaining / TICK_HZ).toFixed(1)}s`, player.x, player.y + 30, '#d89cff');
}

/** Draws a bounded visual aura; it does not modify gameplay geometry or hitboxes. */
export function drawStarAura(
  ctx: CanvasRenderingContext2D,
  player: GameSnapshot['players'][number],
  tick: number,
  now: number,
  theme: ThemeDefinition,
): void {
  const remaining = player.invulnerableUntilTick - tick;
  if (remaining <= 0) return;
  const radius = 19 + Math.sin(now / 130) * 1.5;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `hsl(${(now / 7) % 360} 100% 65%)`;
  ctx.shadowColor = theme.palette.rim;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff04a';
  for (let i = 0; i < 6; i += 1) {
    const angle = now / 700 + i * Math.PI / 3;
    ctx.fillRect(player.x + Math.cos(angle) * radius - 1, player.y + Math.sin(angle) * radius - 1, 2, 2);
  }
  ctx.restore();
  label(ctx, `STAR ${(remaining / TICK_HZ).toFixed(1)}s`, player.x, player.y - radius - 7, '#fff04a');
}
