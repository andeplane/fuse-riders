import { assetUrl } from './asset-url.js';
import type { GameSnapshot } from '../shared/protocol.js';
import type { ThemeDefinition } from './themes.js';

const TICK_HZ = 20;
const PICKUP_FADE_TICKS = 2 * TICK_HZ;
const imageCache = new Map<string, HTMLImageElement | null>();

type PickupType = GameSnapshot['pickups'][number]['type'];

function pickupImage(theme: ThemeDefinition, type: PickupType): HTMLImageElement | null {
  const key = `${theme.id}:${type}`;
  if (imageCache.has(key)) return imageCache.get(key) ?? null;
  const image = new Image();
  image.decoding = 'async';
  image.addEventListener('error', () => imageCache.set(key, null), { once: true });
  image.addEventListener('load', () => imageCache.set(key, image), { once: true });
  image.src = assetUrl(`/themes/${theme.id}/pickup-${type}.svg`);
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

function fallbackPowerup(ctx: CanvasRenderingContext2D, type: PickupType, x: number, y: number, size: number): void {
  if (type === 'stopwatch') {
    ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y + 2, size * .35, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - size * .2); ctx.stroke(); ctx.fillStyle = '#ffe28a'; ctx.fillRect(x - 4, y - size * .48, 8, 4);
  } else if (type === 'gun') {
    ctx.fillStyle = '#b9fff8'; ctx.fillRect(x - size * .4, y - size * .2, size * .8, size * .3); ctx.fillRect(x - size * .3, y, size * .2, size * .3);
  } else if (type === 'shell') {
    ctx.fillStyle = '#48dc55'; ctx.strokeStyle = '#dcffd1'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, size * .4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (type === 'target') {
    ctx.strokeStyle = '#75ffe0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, size * .32, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - size / 2, y); ctx.lineTo(x + size / 2, y); ctx.moveTo(x, y - size / 2); ctx.lineTo(x, y + size / 2); ctx.stroke();
  } else if (type === 'ink') {
    ctx.fillStyle = '#171026'; ctx.beginPath(); ctx.arc(x, y, size * .4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d399ff'; ctx.lineWidth = 2; ctx.stroke();
  } else if (type === 'triple' || type === 'five') {
    ctx.fillStyle = '#ff55bd';
    for (const offset of (type === 'five' ? [-.36, -.18, 0, .18, .36] : [-.24, 0, .24])) { ctx.beginPath(); ctx.arc(x + size * offset, y, size * .13, 0, Math.PI * 2); ctx.fill(); }
  } else if (type === 'orbitShield') {
    ctx.strokeStyle = '#5cf4ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, size * .35, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.strokeStyle = '#b76cff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x - size * .12, y, size * .25, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ff9b32'; ctx.beginPath(); ctx.arc(x + size * .18, y, size * .25, 0, Math.PI * 2); ctx.stroke();
  }
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
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = pickup.type === 'blast' ? '#ff7b16' : pickup.type === 'beer' ? '#b85cff' : pickup.type === 'orbitShield' ? '#5cf4ff' : (pickup.type === 'triple' || pickup.type === 'five') ? '#ff55bd' : pickup.type === 'portal' ? '#b76cff' : '#ffe45c';
    ctx.shadowBlur = 5;
    if (image?.complete && image.naturalWidth > 0) ctx.drawImage(image, pickup.x - size / 2, pickup.y - size / 2, size, size);
    else if (pickup.type === 'blast') fallbackCross(ctx, pickup.x, pickup.y, size);
    else if (pickup.type === 'beer') fallbackBeer(ctx, pickup.x, pickup.y, size);
    else if (pickup.type === 'star') fallbackStar(ctx, pickup.x, pickup.y, size);
    else fallbackPowerup(ctx, pickup.type, pickup.x, pickup.y, size);
    ctx.restore();
    const labels: Record<PickupType, string> = { stopwatch: 'FUSE', gun: 'GUN', shell: 'SHELL', blast: 'BLAST+', star: 'STAR', beer: 'BEER', ink: 'INK', triple: 'TRIPLE', five: 'FIVE', target: 'TARGET', orbitShield: 'SHIELD', portal: 'PORTAL' };
    const text = labels[pickup.type];
    const color = pickup.type === 'blast' ? '#ffbd3e' : pickup.type === 'beer' ? '#d89cff' : pickup.type === 'orbitShield' ? '#8ff8ff' : (pickup.type === 'triple' || pickup.type === 'five') ? '#ff8ed2' : pickup.type === 'portal' ? '#d79aff' : '#fff04a';
    label(ctx, text, pickup.x, pickup.y + size * 0.62, color);
  }
}

export function drawOrbitShield(ctx: CanvasRenderingContext2D, player: GameSnapshot['players'][number], tick: number, now: number): void {
  if (!player.shielded && player.shieldGraceUntilTick <= tick) return;
  ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(now / 430);
  if (player.shielded) {
    ctx.strokeStyle = '#69efff'; ctx.shadowColor = '#35dfff'; ctx.shadowBlur = 9; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#eaffff'; ctx.fillRect(22, -4, 8, 8); ctx.fillStyle = '#6aefff'; ctx.fillRect(24, -2, 4, 4);
  } else {
    ctx.fillStyle = '#a8faff'; ctx.shadowColor = '#6aefff'; ctx.shadowBlur = 8;
    for (let index = 0; index < 8; index += 1) { const angle = index * Math.PI / 4; const radius = 19 + (index % 2) * 8; ctx.fillRect(Math.cos(angle) * radius - 2, Math.sin(angle) * radius - 2, 4, 4); }
  }
  ctx.restore();
}

export function drawPortalPair(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot, tick: number, now: number): void {
  const pair = snapshot.portalPair;
  if (!pair || pair.expiresAtTick <= tick) return;
  const colors = ['#b968ff', '#ff9b32'] as const;
  ctx.save(); ctx.globalAlpha = .2; ctx.strokeStyle = '#d697ff'; ctx.lineWidth = 2; ctx.setLineDash([5, 12]);
  ctx.beginPath(); ctx.moveTo(pair.gates[0].x, pair.gates[0].y); ctx.lineTo(pair.gates[1].x, pair.gates[1].y); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  pair.gates.forEach((gate, index) => {
    ctx.save(); ctx.translate(gate.x, gate.y);
    ctx.strokeStyle = colors[index]; ctx.shadowColor = colors[index]; ctx.shadowBlur = 16; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, -gate.halfLength); ctx.lineTo(0, gate.halfLength); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#effcff'; ctx.setLineDash([8, 5]); ctx.lineDashOffset = (index ? -1 : 1) * now / 40;
    ctx.beginPath(); ctx.moveTo(0, -gate.halfLength); ctx.lineTo(0, gate.halfLength); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors[index];
    for (const y of [-gate.halfLength, gate.halfLength]) ctx.fillRect(-8, y - 4, 16, 8);
    ctx.lineWidth = 2; ctx.strokeStyle = colors[1 - index]; ctx.globalAlpha = .75;
    for (let y = -gate.halfLength + 20; y < gate.halfLength; y += 40) {
      ctx.beginPath(); ctx.moveTo(-9, y - 5); ctx.lineTo(-14, y); ctx.lineTo(-9, y + 5);
      ctx.moveTo(9, y - 5); ctx.lineTo(14, y); ctx.lineTo(9, y + 5); ctx.stroke();
    }
    ctx.restore();
  });
}

export function drawPortalGrace(ctx: CanvasRenderingContext2D, player: GameSnapshot['players'][number], tick: number, now: number): void {
  if (player.portalGraceUntilTick <= tick) return;
  ctx.save(); ctx.globalAlpha = .48; ctx.strokeStyle = '#d48aff'; ctx.shadowColor = '#ff9b32'; ctx.shadowBlur = 10; ctx.lineWidth = 3;
  for (let index = 0; index < 3; index += 1) {
    const radius = 18 + index * 7 + Math.sin(now / 90 + index) * 2;
    ctx.beginPath(); ctx.arc(player.x, player.y, radius, index * .8, index * .8 + Math.PI * 1.25); ctx.stroke();
  }
  ctx.restore();
}

/** Bright dizziness feedback; steering itself stays within the bounded sway. */
export function drawDrunkAura(
  ctx: CanvasRenderingContext2D,
  player: GameSnapshot['players'][number],
  tick: number,
  now: number,
): void {
  const remaining = player.drunkUntilTick - tick;
  if (remaining <= 0) return;
  ctx.save(); ctx.translate(player.x, player.y - 12);
  ctx.lineWidth = 3; ctx.strokeStyle = '#d89cff';
  ctx.beginPath(); ctx.ellipse(0, 0, 34, 20, -.15, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#ffe24f'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 28, 16, .2, now / 200, now / 200 + Math.PI * 1.5); ctx.stroke();
  for (let index = 0; index < 4; index += 1) {
    const angle = now / 250 + index * Math.PI / 2;
    const x = Math.cos(angle) * 36; const y = Math.sin(angle) * 21;
    ctx.fillStyle = index % 2 ? '#fff4a0' : '#ffb32c';
    ctx.beginPath();
    for (let vertex = 0; vertex < 10; vertex += 1) {
      const a = vertex * Math.PI / 5 - Math.PI / 2;
      const radius = vertex % 2 ? 3 : 8;
      const px = x + Math.cos(a) * radius; const py = y + Math.sin(a) * radius;
      if (vertex === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  label(ctx, `DIZZY ${(remaining / TICK_HZ).toFixed(1)}s`, player.x, player.y + 35, '#fff078');
}

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
