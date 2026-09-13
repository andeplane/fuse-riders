import { drawInkClouds } from './ink-renderer.js';
import { ControllerPointerBindings } from './controller-pointers.js';
import { createGameAudio } from './game-audio.js';
import { volleyAngles } from '../shared/launch-modifiers.js';
import './viewport-lock.js';
import QRCode from 'qrcode';
import { BOMB_MAX_CHARGE_TICKS, bombLaunchDistance } from '../shared/bomb-launch.js';
import type { ClientMessage, GameEvent, GameSnapshot, MatchPlayerStats, ServerMessage, TrailSegment } from '../shared/protocol.js';
import { ControllerInputState } from './controller-state.js';
import { drawDrunkAura, drawOrbitShield, drawPickups, drawPortalGrace, drawPortalPair, drawStarAura } from './pickup-renderer.js';
import { renderedSnapshot, type SnapshotFrame } from './render-snapshot.js';
import { SnapshotStream, type ViewSnapshot } from './snapshot-stream.js';
import { applyThemeProperties, defaultTheme, loadThemeSprites, themes, type ThemeDefinition, type ThemeId, type ThemeSprites } from './themes.js';
import '@fontsource/press-start-2p/latin.css';
import './style.css';

const app = document.querySelector<HTMLElement>('#app')!;
if (!app) throw new Error('Missing app root');

const HEARTBEAT_MS = 2_000;
const HELD_RESEND_MS = 100;
const PLAYER_TOKEN_KEY = 'fuse-riders-player-token';
const PLAYER_NAME_KEY = 'fuse-riders-player-name';
const HOST_TOKEN_KEY = 'fuse-riders-host-token';
const THEME_KEY = 'fuse-riders-display-theme';

type LeaderboardEntryView = { id: string; name: string; totalScoreUnits: number; roundsPlayed: number; roundWins: number; matchWins: number };
type RoundPlacementView = { playerId: string; name: string; place: number; scoreUnits: number };
type ScoredSnapshot = ViewSnapshot & {
  leaderboard?: ReadonlyArray<LeaderboardEntryView>;
  roundPlacements?: ReadonlyArray<RoundPlacementView>;
  matchStats?: ReadonlyArray<MatchPlayerStats>;
};

function scoreText(scoreUnits: number): string {
  const points = scoreUnits / 60;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function durationText(ticks: number): string {
  const seconds = ticks / 20;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function websocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function escapeColor(value: string): string {
  return /^#[\da-f]{3,8}$/i.test(value) || /^(cyan|magenta|lime|orange|violet)$/i.test(value) ? value : '#ffffff';
}

class SocketClient {
  socket?: WebSocket;
  heartbeat?: number;
  reconnectTimer?: number;
  intentionallyClosed = false;
  retry = 0;
  pingId = 0;
  constructor(
    private readonly authenticate: () => ClientMessage | undefined,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onStatus: (connected: boolean, reason?: 'replaced') => void,
    private readonly onRoundTrip?: (milliseconds: number) => void,
  ) {}

  connect(): void {
    window.clearTimeout(this.reconnectTimer);
    this.intentionallyClosed = false;
    const socket = new WebSocket(websocketUrl());
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.retry = 0;
      this.onStatus(true);
      const auth = this.authenticate();
      if (auth) this.send(auth);
      this.heartbeat = window.setInterval(() => {
        this.send({ type: 'heartbeat' });
        this.send({ type: 'ping', id: this.pingId++, sentAt: performance.now() });
      }, HEARTBEAT_MS);
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'pong') { this.onRoundTrip?.(performance.now() - message.sentAt); return; }
        this.onMessage(message);
      } catch {
        // Ignore malformed server frames; the next complete snapshot repairs the view.
      }
    });
    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return;
      window.clearInterval(this.heartbeat);
      if (event.code === 4001) this.intentionallyClosed = true;
      this.onStatus(false, event.code === 4001 ? 'replaced' : undefined);
      if (!this.intentionallyClosed) {
        const delay = Math.min(3_000, 300 * 2 ** this.retry++);
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
      }
    });
    socket.addEventListener('error', () => socket.close());
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.intentionallyClosed = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.heartbeat);
    this.socket?.close();
  }
}

function phaseLabel(snapshot: ViewSnapshot): string {
  switch (snapshot.phase) {
    case 'lobby': return 'READY ROOM';
    case 'countdown': return 'GET READY';
    case 'playing': return 'ROUND LIVE';
    case 'roundOver': return 'ROUND OVER';
    case 'matchOver': return 'MATCH OVER';
  }
}

function secondsRemaining(snapshot: ViewSnapshot): number | undefined {
  if (snapshot.phaseEndsAtTick !== undefined) return Math.max(0, Math.ceil((snapshot.phaseEndsAtTick - snapshot.tick) / 20));
  if (snapshot.phase === 'playing' && snapshot.roundStartedTick !== undefined) {
    return Math.max(0, 90 - Math.floor((snapshot.tick - snapshot.roundStartedTick) / 20));
  }
  return undefined;
}

function formatTimer(seconds: number | undefined): string {
  if (seconds === undefined) return '--:--';
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${mins}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

interface TrailBatch { path: Path2D; alpha: number; pixels: number[]; fragments: number[] }
const trailBatchCache = new WeakMap<ReadonlyArray<TrailSegment>, TrailBatch[]>();

function prepareTrailBatches(trail: ReadonlyArray<TrailSegment>, tick: number): TrailBatch[] {
  const cached = trailBatchCache.get(trail);
  if (cached) return cached;
  const batches = Array.from({ length: 4 }, (_, index): TrailBatch => ({
    path: new Path2D(), alpha: [.24, .48, .74, 1][index], pixels: [], fragments: [],
  }));
  for (const segment of trail) {
    const life = clamp((segment.expiresAtTick - tick) / 40, .15, 1);
    const batch = batches[Math.min(3, Math.floor(life * 4))];
    const x1 = Math.round(segment.x1); const y1 = Math.round(segment.y1);
    const x2 = Math.round(segment.x2); const y2 = Math.round(segment.y2);
    batch.path.moveTo(x1, y1); batch.path.lineTo(x2, y2);
    const dx = segment.x2 - segment.x1; const dy = segment.y2 - segment.y1; const length = Math.hypot(dx, dy);
    const count = Math.max(1, Math.ceil(length / 4));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count; const x = Math.round(segment.x1 + dx * t); const y = Math.round(segment.y1 + dy * t);
      batch.pixels.push(x, y);
      if ((index + Math.round(segment.x1 + segment.y1)) % 11 === 0) {
        const nx = length ? -dy / length : 0; const ny = length ? dx / length : 0;
        batch.fragments.push(Math.round(x + nx * 5), Math.round(y + ny * 5));
      }
    }
  }
  trailBatchCache.set(trail, batches);
  return batches;
}

function drawPlayerTrail(ctx: CanvasRenderingContext2D, trail: ReadonlyArray<TrailSegment>, tick: number, alive: boolean, color: string, theme: ThemeDefinition): void {
  const batches = prepareTrailBatches(trail, tick);
  const aliveAlpha = alive ? 1 : .55;
  ctx.save(); ctx.lineCap = theme.rendering.trailCap; ctx.lineJoin = theme.rendering.trailCap === 'round' ? 'round' : 'bevel';
  for (const batch of batches) {
    if (!batch.pixels.length) continue;
    ctx.globalAlpha = batch.alpha * aliveAlpha * .5; ctx.strokeStyle = color; ctx.lineWidth = 10;
    ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.stroke(batch.path);
    ctx.shadowBlur = 0; ctx.globalAlpha = batch.alpha * aliveAlpha; ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.stroke(batch.path);
    if (theme.rendering.pixelated) {
      ctx.fillStyle = '#efffff';
      for (let index = 0; index < batch.pixels.length; index += 2) ctx.fillRect(batch.pixels[index] - 1, batch.pixels[index + 1] - 1, 2, 2);
      ctx.globalAlpha = batch.alpha * aliveAlpha * .42; ctx.fillStyle = color;
      for (let index = 0; index < batch.fragments.length; index += 2) ctx.fillRect(batch.fragments[index] - 1, batch.fragments[index + 1] - 1, 3, 3);
    } else {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(batch.path);
    }
  }
  ctx.restore();
}

function drawPixelBrick(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, seed: number): void {
  if (width <= 1 || height <= 1) return;
  ctx.fillStyle = '#211862'; ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color; ctx.globalAlpha = .92; ctx.fillRect(x + 2, y + 2, width - 4, height - 4);
  ctx.fillStyle = 'rgba(182,150,255,.65)'; ctx.fillRect(x + 3, y + 3, width - 6, 2);
  ctx.fillStyle = 'rgba(25,17,78,.65)'; ctx.fillRect(x + 3, y + height - 5, width - 6, 3);
  ctx.globalAlpha = .45;
  ctx.fillStyle = '#241664';
  ctx.fillRect(x + 5 + seed % Math.max(2, width - 11), y + 7 + (seed * 3) % Math.max(2, height - 12), 3, 2);
  ctx.globalAlpha = 1;
}

function drawBoundary(ctx: CanvasRenderingContext2D, width: number, height: number, inset: number, theme: ThemeDefinition): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,2,12,.67)';
  ctx.fillRect(0, 0, width, inset); ctx.fillRect(0, height - inset, width, inset);
  ctx.fillRect(0, inset, inset, height - inset * 2); ctx.fillRect(width - inset, inset, inset, height - inset * 2);
  ctx.strokeStyle = theme.palette.rim; ctx.lineWidth = 4; ctx.shadowColor = theme.palette.rim; ctx.shadowBlur = 18;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.shadowBlur = 7;
  if (!theme.rendering.pixelated) {
    ctx.strokeStyle = theme.palette.wall; ctx.lineWidth = theme.rendering.wallWidth;
    ctx.strokeRect(Math.max(3, inset - 8), Math.max(3, inset - 8), width - Math.max(3, inset - 8) * 2, height - Math.max(3, inset - 8) * 2);
    ctx.restore(); return;
  }
  const depth = Math.max(8, Math.min(18, inset - 2)); const gap = 3; const brick = 32;
  ctx.shadowColor = theme.palette.wall; ctx.shadowBlur = 5;
  let seed = 0;
  for (let x = inset; x < width - inset; x += brick + gap) {
    const w = Math.min(brick, width - inset - x);
    drawPixelBrick(ctx, x, inset - depth, w, depth - 3, theme.palette.wall, seed++);
    drawPixelBrick(ctx, x, height - inset + 3, w, depth - 3, theme.palette.wall, seed++);
  }
  for (let y = inset; y < height - inset; y += brick + gap) {
    const h = Math.min(brick, height - inset - y);
    drawPixelBrick(ctx, inset - depth, y, depth - 3, h, theme.palette.wall, seed++);
    drawPixelBrick(ctx, width - inset + 3, y, depth - 3, h, theme.palette.wall, seed++);
  }
  ctx.strokeStyle = theme.palette.rim; ctx.lineWidth = 4; ctx.shadowColor = theme.palette.rim; ctx.shadowBlur = 17;
  const c = 27; const o = Math.max(2, inset - depth - 3);
  const corners: Array<readonly [number, number, number, number, number, number]> = [
    [o + c, o, o, o, o, o + c], [width - o - c, o, width - o, o, width - o, o + c],
    [o, height - o - c, o, height - o, o + c, height - o], [width - o, height - o - c, width - o, height - o, width - o - c, height - o],
  ];
  for (const [ax, ay, bx, by, cx, cy] of corners) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.stroke(); }
  ctx.shadowColor = '#ff850d'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff19b';
  for (const [x, y] of [[o + 5, o + 5], [width - o - 11, o + 5], [o + 5, height - o - 11], [width - o - 11, height - o - 11]]) {
    ctx.fillStyle = '#ff7b16'; ctx.fillRect(x, y, 7, 7); ctx.fillStyle = '#fff5a4'; ctx.fillRect(x + 2, y + 2, 3, 3);
  }
  ctx.restore();
}

let backgroundCache: { key: string; canvas: HTMLCanvasElement } | undefined;

function arenaBackground(width: number, height: number, inset: number, theme: ThemeDefinition): HTMLCanvasElement {
  const key = `${theme.id}:${width}:${height}:${inset}`;
  if (backgroundCache?.key === key) return backgroundCache.canvas;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const floor = ctx.createRadialGradient(width / 2, height / 2, 30, width / 2, height / 2, width * .7);
  floor.addColorStop(0, theme.palette.floorCenter); floor.addColorStop(1, theme.palette.floorEdge);
  ctx.fillStyle = floor; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.palette.grid; ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += theme.rendering.gridSize) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, height); ctx.stroke(); }
  for (let y = 0; y <= height; y += theme.rendering.gridSize) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(width, y + .5); ctx.stroke(); }
  drawBoundary(ctx, width, height, inset, theme);
  backgroundCache = { key, canvas };
  return canvas;
}

const tintedSpriteCache = new Map<string, HTMLCanvasElement>();

function spriteSource(image: HTMLImageElement, size: number, tint?: string): CanvasImageSource {
  if (!tint) return image;
  const key = `${image.currentSrc || image.src}:${size}:${tint}`;
  const cached = tintedSpriteCache.get(key);
  if (cached) return cached;
  const buffer = document.createElement('canvas');
  buffer.width = size; buffer.height = size;
  const bufferContext = buffer.getContext('2d');
  if (!bufferContext) return image;
  bufferContext.drawImage(image, 0, 0, size, size);
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(tint);
  if (match) {
    const target = match.slice(1).map((part) => Number.parseInt(part, 16));
    const pixels = bufferContext.getImageData(0, 0, size, size);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (pixels.data[index + 3] === 0) continue;
      const high = Math.max(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
      const low = Math.min(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
      // Preserve near-white highlights and dark cockpit/body pixels; recolor
      // the saturated outline pixels which are authored as cyan in the SVG.
      if (high > 210 && low > 180 || high < 105) continue;
      pixels.data[index] = target[0]; pixels.data[index + 1] = target[1]; pixels.data[index + 2] = target[2];
    }
    bufferContext.putImageData(pixels, 0, 0);
  }
  tintedSpriteCache.set(key, buffer);
  return buffer;
}

function drawSprite(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, size: number, rotation = 0, tint?: string, pixelated = true): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(rotation);
  ctx.imageSmoothingEnabled = !pixelated;
  ctx.drawImage(spriteSource(image, size, tint), -size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawArena(ctx: CanvasRenderingContext2D, snapshot: ViewSnapshot, now: number, theme: ThemeDefinition, sprites: ThemeSprites): void {
  const { width, height } = snapshot;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(arenaBackground(width, height, snapshot.boundaryInset, theme), 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(snapshot.boundaryInset, snapshot.boundaryInset,
    width - 2 * snapshot.boundaryInset, height - 2 * snapshot.boundaryInset);
  ctx.clip();
  for (const player of snapshot.players) {
    const color = escapeColor(player.color);
    drawPlayerTrail(ctx, player.trail, snapshot.tick, player.alive, color, theme);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  if ((snapshot.pickups ?? []).length) drawPickups(ctx, snapshot, snapshot.tick, now, theme);
  drawPortalPair(ctx, snapshot, snapshot.tick, now);

  for (const player of snapshot.players) {
    if (player.bombChargeStartedTick === undefined || !player.alive) continue;
    const chargeTicks = Math.max(0, snapshot.tick - player.bombChargeStartedTick);
    const distance = bombLaunchDistance(chargeTicks);
    ctx.save(); ctx.strokeStyle = escapeColor(player.color); ctx.globalAlpha = .62; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 8;
    const angles = player.tripleShotArmed || player.fiveShotArmed ? volleyAngles(player.angle, player.fiveShotArmed ? 5 : 3) : [player.angle];
    for (const angle of angles) {
      const targetX = clamp(player.x + Math.cos(angle) * distance, snapshot.boundaryInset + 20, width - snapshot.boundaryInset - 20);
      const targetY = clamp(player.y + Math.sin(angle) * distance, snapshot.boundaryInset + 20, height - snapshot.boundaryInset - 20);
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(targetX, targetY); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = .8; ctx.strokeRect(targetX - 10, targetY - 10, 20, 20); ctx.setLineDash([8, 8]);
    }
    ctx.restore();
  }

  for (const bomb of snapshot.bombs) {
    const airborne = snapshot.tick < bomb.landsAtTick;
    const flightDuration = Math.max(1, bomb.landsAtTick - bomb.launchedTick);
    const flight = clamp((snapshot.tick - bomb.launchedTick) / flightDuration, 0, 1);
    const path = bomb.flightPath.length > 1 ? bomb.flightPath : [{ x: bomb.launchX, y: bomb.launchY, angle: 0 }, { x: bomb.x, y: bomb.y, angle: 0 }];
    const pathPosition = flight * (path.length - 1); const pathIndex = Math.min(path.length - 2, Math.floor(pathPosition));
    const pathMix = pathPosition - pathIndex; const pathStart = path[pathIndex]!; const pathEnd = path[pathIndex + 1]!;
    const drawX = pathStart.x + (pathEnd.x - pathStart.x) * pathMix;
    const drawY = pathStart.y + (pathEnd.y - pathStart.y) * pathMix - Math.sin(flight * Math.PI) * 56;
    const pulse = 1 + Math.sin(now / 90) * 0.08;
    const remaining = clamp((bomb.explodeAtTick - snapshot.tick) / 40, 0, 1);
    if (airborne) {
      ctx.save(); ctx.globalAlpha = .36 + flight * .35; ctx.strokeStyle = '#ff73c5'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(bomb.x, bomb.y, 14 + flight * 5, 6 + flight * 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalAlpha = .26; ctx.strokeStyle = '#ff73c5'; ctx.setLineDash([5, 7]); ctx.beginPath();
      path.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke(); ctx.restore();
    }
    ctx.save();
    ctx.translate(Math.round(drawX), Math.round(drawY));
    ctx.scale(pulse * (airborne ? 1.12 : 1), pulse * (airborne ? 1.12 : 1));
    ctx.shadowColor = '#ff397e'; ctx.shadowBlur = 12;
    if (sprites.bomb) drawSprite(ctx, sprites.bomb, 0, 0, 44, 0, undefined, theme.rendering.pixelated);
    else { const ball = ctx.createRadialGradient(-5, -7, 1, 0, 0, 18); ball.addColorStop(0, '#7481a8'); ball.addColorStop(.3, '#242a4a'); ball.addColorStop(1, '#070815'); ctx.fillStyle = ball; ctx.strokeStyle = '#8f7bbd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.strokeStyle = airborne ? '#d67cff' : remaining < 0.3 ? '#fff06a' : '#ff2d7d';
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14; ctx.lineWidth = 5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (airborne ? flight : remaining)); ctx.stroke();
    ctx.setLineDash([]);
    if (!sprites.bomb) { ctx.fillStyle = '#ffb52e'; ctx.fillRect(9, -20, 3, 9); }
    const spark = Math.round(now / 80 + bomb.id) % 3;
    ctx.shadowColor = '#ff9a18'; ctx.shadowBlur = 10; ctx.fillStyle = '#fff3a1';
    ctx.fillRect(11 + spark * 2, -25 - spark * 2, 3, 3);
    ctx.fillStyle = '#ff5c17'; ctx.fillRect(17 - spark, -20 - spark * 4, 2, 2);
    ctx.restore();
  }

  for (const blast of snapshot.blasts) {
    const alpha = clamp((blast.expiresAtTick - snapshot.tick) / 8, 0.15, 1);
    const { x, y, radius } = blast.circle;
    ctx.save();
    ctx.beginPath(); ctx.rect(snapshot.boundaryInset, snapshot.boundaryInset, snapshot.width - 2 * snapshot.boundaryInset, snapshot.height - 2 * snapshot.boundaryInset); ctx.clip();
    ctx.globalAlpha = alpha;
    // One bounded polygon per ring keeps five simultaneous explosions cheap.
    for (const [scale, color] of [[1, theme.palette.blast], [.84, '#ffb21e'], [.56, theme.palette.blastCore]] as const) {
      ctx.fillStyle = color; ctx.beginPath();
      const steps = theme.rendering.pixelated ? 32 : 64;
      for (let i = 0; i < steps; i += 1) {
        const angle = i * Math.PI * 2 / steps;
        const px = x + Math.cos(angle) * radius * scale;
        const py = y + Math.sin(angle) * radius * scale;
        const snap = theme.rendering.pixelated ? 6 : 1;
        if (i === 0) ctx.moveTo(Math.round(px / snap) * snap, Math.round(py / snap) * snap);
        else ctx.lineTo(Math.round(px / snap) * snap, Math.round(py / snap) * snap);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  for (const player of snapshot.players) {
    const color = escapeColor(player.color);
    if (player.invulnerableUntilTick > snapshot.tick) drawStarAura(ctx, player, snapshot.tick, now, theme);
    if (player.drunkUntilTick > snapshot.tick) drawDrunkAura(ctx, player, snapshot.tick, now);
    drawOrbitShield(ctx, player, snapshot.tick, now);
    drawPortalGrace(ctx, player, snapshot.tick, now);
    ctx.save(); ctx.globalAlpha = player.alive ? 1 : 0.22; ctx.shadowColor = color; ctx.shadowBlur = 18;
    if (sprites.rider) drawSprite(ctx, sprites.rider, player.x, player.y, 44, player.angle, color, theme.rendering.pixelated);
    else { ctx.translate(player.x, player.y); ctx.rotate(player.angle); ctx.fillStyle = '#f7ffff'; ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-11, -10); ctx.lineTo(-5, 0); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    if (player.alive) {
      ctx.save(); ctx.font = '10px "Press Start 2P"'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.fillText(`P${player.slot + 1}`, Math.round(player.x), Math.round(player.y - 29)); ctx.restore();
    }
  }
  drawInkClouds(ctx, snapshot, snapshot.tick);
}

function startDisplay(): void {
  document.body.className = 'display-page';
  const audio = createGameAudio();
  const root = element('main', 'display-shell');
  const topbar = element('header', 'topbar');
  const brand = element('div', 'brand');
  brand.append(element('span', 'brand-cyan', 'FUSE'), document.createTextNode(' '), element('span', 'brand-pink', 'RIDERS'));
  const scores = element('div', 'scores');
  const timer = element('div', 'timer');
  timer.append(element('span', 'eyebrow', 'ROUND'), element('strong', '', '--:--'));
  const connection = element('span', 'connection', 'CONNECTING');
  const leaderboardButton = element('button', 'leaderboard-toggle hidden', '🏆 SESSION');
  leaderboardButton.type = 'button'; leaderboardButton.setAttribute('aria-expanded', 'false');
  const themeSelect = element('select', 'theme-select');
  themeSelect.setAttribute('aria-label', 'Visual style');
  for (const theme of Object.values(themes)) {
    const option = element('option', '', theme.label); option.value = theme.id; themeSelect.append(option);
  }
  const fullscreen = element('button', 'fullscreen fullscreen-toolbar', '⛶');
  fullscreen.type = 'button'; fullscreen.title = 'Fullscreen'; fullscreen.setAttribute('aria-label', 'Fullscreen');
  topbar.append(brand, scores, timer, leaderboardButton, themeSelect, audio.controls, fullscreen, connection);

  const stage = element('section', 'stage');
  const canvas = element('canvas', 'arena');
  canvas.width = 1200; canvas.height = 700;
  const lobby = element('div', 'lobby-overlay');
  const lobbyCard = element('div', 'lobby-card');
  const lobbyCopy = element('div', 'lobby-copy');
  lobbyCopy.append(element('p', 'kicker', 'PHONE PARTY // 2–5 RIDERS'), element('h1', '', 'Scan. Steer. Survive.'), element('p', 'lede', 'Open the controller, pick a name, then use your phone to carve neon trails and trigger chain reactions.'));
  const pickupLegend = element('div', 'pickup-legend');
  const blastLegendImage = element('img'); blastLegendImage.alt = ''; blastLegendImage.src = '/themes/neon-pixel/pickup-blast.svg';
  const starLegendImage = element('img'); starLegendImage.alt = ''; starLegendImage.src = '/themes/neon-pixel/pickup-star.svg';
  const inkLegendImage = element('img'); inkLegendImage.alt = ''; inkLegendImage.src = '/themes/neon-pixel/pickup-ink.svg';
  const beerLegendImage = element('img'); beerLegendImage.alt = ''; beerLegendImage.src = '/themes/neon-pixel/pickup-beer.svg';
  const tripleLegendImage = element('img'); tripleLegendImage.alt = ''; tripleLegendImage.src = '/themes/neon-pixel/pickup-triple.svg';
  const fiveLegendImage = element('img'); fiveLegendImage.alt = ''; fiveLegendImage.src = '/themes/neon-pixel/pickup-five.svg';
  const shieldLegendImage = element('img'); shieldLegendImage.alt = ''; shieldLegendImage.src = '/themes/neon-pixel/pickup-orbitShield.svg';
  const portalLegendImage = element('img'); portalLegendImage.alt = ''; portalLegendImage.src = '/themes/neon-pixel/pickup-portal.svg';
  const blastLegend = element('span'); blastLegend.append(blastLegendImage, element('b', '', 'BLAST+'), document.createTextNode(' larger explosions'));
  const starLegend = element('span'); starLegend.append(starLegendImage, element('b', '', 'STAR'), document.createTextNode(' 5s invulnerable'));
  const inkLegend = element('span'); inkLegend.append(inkLegendImage, element('b', '', 'INK'), document.createTextNode(' clouds rivals for 1s'));
  const beerLegend = element('span'); beerLegend.append(beerLegendImage, element('b', '', 'BEER'), document.createTextNode(' rivals wobble for 4s'));
  const fiveLegend = element('span'); fiveLegend.append(fiveLegendImage, element('b', '', 'FIVE'), document.createTextNode(' rare: next launch fires 5'));
  const tripleLegend = element('span'); tripleLegend.append(tripleLegendImage, element('b', '', 'TRIPLE'), document.createTextNode(' next launch fires 3'));
  const shieldLegend = element('span'); shieldLegend.append(shieldLegendImage, element('b', '', 'SHIELD'), document.createTextNode(' blocks one crash'));
  const portalLegend = element('span'); portalLegend.append(portalLegendImage, element('b', '', 'PORTAL'), document.createTextNode(' opens linked gates'));
  pickupLegend.append(blastLegend, starLegend, beerLegend, inkLegend, tripleLegend, fiveLegend, shieldLegend, portalLegend); lobbyCopy.append(pickupLegend);
  const joinPanel = element('div', 'join-panel');
  const qrCanvas = element('canvas', 'qr');
  const joinUrl = element('p', 'join-url', 'Loading join link…');
  joinPanel.append(qrCanvas, element('p', 'scan-label', 'SCAN TO JOIN'), joinUrl);
  const roster = element('div', 'roster');
  const lobbyFooter = element('div', 'lobby-footer');
  const action = element('button', 'host-action', 'START RACE');
  action.disabled = true;
  lobbyFooter.append(element('p', 'host-hint', 'Waiting for at least 2 riders'), action);
  lobbyCard.append(lobbyCopy, joinPanel, roster, lobbyFooter);
  lobby.append(lobbyCard);

  const announcement = element('div', 'announcement hidden');
  const leaderboardDrawer = element('aside', 'leaderboard-drawer hidden');
  const leaderboardHeader = element('header');
  const leaderboardClose = element('button', '', '×'); leaderboardClose.type = 'button'; leaderboardClose.setAttribute('aria-label', 'Close leaderboard');
  leaderboardHeader.append(element('div', '', 'SESSION LEADERBOARD'), leaderboardClose);
  const leaderboardRows = element('div', 'leaderboard-rows');
  leaderboardDrawer.append(leaderboardHeader, leaderboardRows, element('p', 'leaderboard-key', 'ROUND POINTS // 5 · 3 · 2 · 1 · 0  // TIES SHARE THE PLACES'));
  const matchRecap = element('section', 'match-recap hidden');
  const recapHeading = element('header', 'recap-heading');
  const recapTitle = element('div');
  recapTitle.append(element('p', 'kicker', 'MATCH COMPLETE // AFTER ACTION REPORT'), element('h2', '', 'Grid legends'));
  const recapAction = element('button', 'host-action recap-rematch', 'REMATCH'); recapAction.type = 'button';
  recapHeading.append(recapTitle, recapAction);
  const podium = element('div', 'recap-podium');
  const awards = element('div', 'recap-awards');
  const comparison = element('div', 'recap-comparison');
  matchRecap.append(recapHeading, podium, awards, comparison);
  const performanceDisplay = element('output', 'perf-overlay hidden', 'FPS --  RENDER --ms');
  const roundBadge = element('div', 'round-badge', 'ROUND 1');
  stage.append(canvas, lobby, roundBadge, announcement, matchRecap, leaderboardDrawer, performanceDisplay);
  root.append(topbar, stage);
  app.replaceChildren(root);

  let hostToken = sessionStorage.getItem(HOST_TOKEN_KEY) ?? '';
  function captureHostToken(): boolean {
    if (location.hash.length <= 1) return false;
    let candidate = '';
    try { candidate = decodeURIComponent(location.hash.slice(1)); } catch { /* invalid URL encoding */ }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    if (!/^[a-f0-9]{32,64}$/.test(candidate)) { connection.textContent = 'INVALID HOST LINK'; return false; }
    hostToken = candidate; sessionStorage.setItem(HOST_TOKEN_KEY, candidate); return true;
  }
  captureHostToken();
  if (!hostToken) connection.textContent = 'HOST LINK REQUIRED';
  let authenticated = false;
  let latest: SnapshotFrame | undefined;
  const snapshotStream = new SnapshotStream();
  const frames: SnapshotFrame[] = [];
  const handledEvents = new Set<string>();
  let configControllerUrl = '';
  let rosterSignature = '';
  let scoresSignature = '';
  let leaderboardSignature = '';
  let recapSignature = '';
  let showPerformance = new URLSearchParams(location.search).get('perf') === '1';
  performanceDisplay.classList.toggle('hidden', !showPerformance);
  const savedTheme = localStorage.getItem(THEME_KEY);
  let activeTheme = savedTheme && savedTheme in themes ? themes[savedTheme as ThemeId] : defaultTheme;
  let activeSprites: ThemeSprites = {};
  themeSelect.value = activeTheme.id;
  applyThemeProperties(activeTheme);
  blastLegendImage.src = `/themes/${activeTheme.id}/pickup-blast.svg`;
  starLegendImage.src = `/themes/${activeTheme.id}/pickup-star.svg`;
  beerLegendImage.src = `/themes/${activeTheme.id}/pickup-beer.svg`;
  inkLegendImage.src = `/themes/${activeTheme.id}/pickup-ink.svg`;
  tripleLegendImage.src = `/themes/${activeTheme.id}/pickup-triple.svg`; fiveLegendImage.src = `/themes/${activeTheme.id}/pickup-five.svg`;

  shieldLegendImage.src = `/themes/${activeTheme.id}/pickup-orbitShield.svg`;
  portalLegendImage.src = `/themes/${activeTheme.id}/pickup-portal.svg`;
  void loadThemeSprites(activeTheme).then((sprites) => { activeSprites = sprites; });

  themeSelect.addEventListener('change', () => {
    const next = themes[themeSelect.value as ThemeId];
    if (!next) return;
    activeTheme = next; activeSprites = {}; localStorage.setItem(THEME_KEY, next.id); applyThemeProperties(next);
    blastLegendImage.src = `/themes/${next.id}/pickup-blast.svg`; starLegendImage.src = `/themes/${next.id}/pickup-star.svg`;
    beerLegendImage.src = `/themes/${next.id}/pickup-beer.svg`;
    inkLegendImage.src = `/themes/${next.id}/pickup-ink.svg`;
    tripleLegendImage.src = `/themes/${next.id}/pickup-triple.svg`; fiveLegendImage.src = `/themes/${next.id}/pickup-five.svg`;  shieldLegendImage.src = `/themes/${next.id}/pickup-orbitShield.svg`;
    portalLegendImage.src = `/themes/${next.id}/pickup-portal.svg`;
    void loadThemeSprites(next).then((sprites) => { if (activeTheme.id === next.id) activeSprites = sprites; });
  });

  function renderRoster(snapshot?: ViewSnapshot): void {
    const signature = snapshot?.players.map((player) => `${player.slot}:${player.name}:${player.color}:${player.connected}`).join('|') ?? 'empty';
    if (signature === rosterSignature) return;
    rosterSignature = signature;
    roster.replaceChildren();
    for (let slot = 0; slot < 5; slot += 1) {
      const player = snapshot?.players.find((candidate) => candidate.slot === slot);
      const seat = element('div', `seat ${player ? 'occupied' : ''}`);
      const marker = element('span', 'seat-marker', player ? '➤' : `${slot + 1}`);
      if (player) marker.style.setProperty('--player-color', escapeColor(player.color));
      const details = element('div', 'seat-details');
      details.append(element('strong', '', player?.name ?? 'OPEN SLOT'), element('small', '', player ? (player.connected ? 'READY' : 'RECONNECTING') : 'SCAN TO JOIN'));
      seat.append(marker, details);
      roster.append(seat);
    }
  }

  function renderScores(snapshot: ViewSnapshot): void {
    const signature = snapshot.players.map((player) => `${player.slot}:${player.name}:${player.color}:${player.alive}:${player.roundWins}`).join('|');
    if (signature === scoresSignature) return;
    scoresSignature = signature;
    scores.replaceChildren();
    for (const player of [...snapshot.players].sort((a, b) => a.slot - b.slot)) {
      const card = element('div', `score-card ${player.alive ? '' : 'out'}`);
      card.style.setProperty('--player-color', escapeColor(player.color));
      const pips = element('span', 'score-pips');
      for (let win = 0; win < 3; win += 1) pips.append(element('i', win < player.roundWins ? 'won' : ''));
      const details = element('span', 'score-details');
      const seatName = player.name.toUpperCase() === `P${player.slot + 1}` ? `P${player.slot + 1}` : `P${player.slot + 1} ${player.name}`;
      details.append(element('span', 'score-name', seatName), pips);
      card.append(element('span', 'score-arrow', '➤'), details);
      scores.append(card);
    }
  }

  function renderLeaderboard(snapshot: ScoredSnapshot): void {
    const entries = [...(snapshot.leaderboard ?? [])].sort((a, b) => b.totalScoreUnits - a.totalScoreUnits || b.matchWins - a.matchWins || a.name.localeCompare(b.name));
    const signature = entries.map((entry) => `${entry.id}:${entry.name}:${entry.totalScoreUnits}:${entry.roundWins}:${entry.matchWins}`).join('|');
    if (signature === leaderboardSignature) return;
    leaderboardSignature = signature; leaderboardRows.replaceChildren();
    if (!entries.length) { leaderboardRows.append(element('p', 'leaderboard-empty', 'Scores appear after round one.')); return; }
    let previousUnits: number | undefined; let displayedRank = 0;
    entries.forEach((entry, index) => {
      if (entry.totalScoreUnits !== previousUnits) displayedRank = index + 1;
      previousUnits = entry.totalScoreUnits;
      const row = element('div', 'leaderboard-row');
      row.append(element('strong', 'leaderboard-rank', `#${displayedRank}`), element('span', 'leaderboard-name', entry.name), element('b', 'leaderboard-points', `${scoreText(entry.totalScoreUnits)} PTS`), element('small', '', `${entry.matchWins} MATCH · ${entry.roundWins} ROUND`));
      leaderboardRows.append(row);
    });
  }

  function renderMatchRecap(snapshot: ScoredSnapshot): void {
    const stats = [...(snapshot.matchStats ?? [])].sort((a, b) => a.matchPlacement - b.matchPlacement || a.slot - b.slot);
    const signature = stats.map((entry) => [entry.playerId, entry.matchPlacement, entry.roundWins, entry.roundsDrawn, entry.survivalTicks,
      entry.distanceUnits, entry.bombsPlaced, entry.bombsExploded, entry.eliminations, entry.pickupsCollected, entry.invulnerableTicks,
      entry.wallBounces, entry.earlyExits, entry.beerPickups, entry.inkPickups, entry.triplePickups, entry.fivePickups,  entry.shieldPickups, entry.portalPickups, entry.portalTransits,
      ...Object.values(entry.deathsByCause)].join(':')).join('|');
    if (signature === recapSignature) return;
    recapSignature = signature;
    podium.replaceChildren(); awards.replaceChildren(); comparison.replaceChildren();
    if (!stats.length) {
      podium.append(element('p', 'recap-empty', 'Compiling the after action report…'));
      return;
    }

    const podiumEntries = stats.filter((candidate) => candidate.matchPlacement <= 3);
    const champions = podiumEntries.filter((entry) => entry.matchPlacement === 1);
    const runners = podiumEntries.filter((entry) => entry.matchPlacement !== 1);
    const centerAt = Math.ceil(runners.length / 2);
    const podiumOrder = [...runners.slice(0, centerAt), ...champions, ...runners.slice(centerAt)];
    for (const entry of podiumOrder) {
      const card = element('article', `podium-card podium-place-${entry.matchPlacement}`);
      card.style.setProperty('--player-color', escapeColor(entry.color));
      card.append(
        element('span', 'podium-place', entry.matchPlacement === 1 ? '♛  #1' : `#${entry.matchPlacement}`),
        element('strong', '', entry.name),
        element('small', '', `${entry.roundWins} ROUND ${entry.roundWins === 1 ? 'WIN' : 'WINS'}`),
      );
      podium.append(card);
    }

    const awardMetrics: Array<{ title: string; icon: string; value: (entry: MatchPlayerStats) => number; detail: (value: number) => string }> = [
      { title: 'DEMOLITION EXPERT', icon: '✹', value: (entry) => entry.bombsExploded, detail: (value) => `${value} BOMBS BOOMED` },
      { title: 'TRAILBLAZER', icon: '⌁', value: (entry) => entry.distanceUnits, detail: (value) => `${Math.round(value)}u TRAVELLED` },
      { title: 'UNTOUCHABLE', icon: '✦', value: (entry) => entry.survivalTicks, detail: (value) => `${durationText(value)} ALIVE` },
      { title: 'COLLECTOR', icon: '◆', value: (entry) => entry.pickupsCollected, detail: (value) => `${value} POWER-UPS` },
    ];
    for (const metric of awardMetrics) {
      const best = Math.max(...stats.map(metric.value));
      if (best <= 0) continue;
      const winners = stats.filter((entry) => metric.value(entry) === best);
      const card = element('article', 'award-card');
      card.append(element('span', 'award-icon', metric.icon), element('small', '', metric.title), element('strong', '', winners.map((entry) => entry.name).join(' + ')), element('em', '', metric.detail(best)));
      awards.append(card);
    }

    comparison.append(element('p', 'comparison-key', 'BOMBS = EXPLODED / PLACED   ·   DEATHS = WALL / TRAIL / BLAST / RIDER'));
    const header = element('div', 'comparison-row comparison-header');
    for (const label of ['RIDER', 'WINS', 'SURVIVED', 'BEST', 'DIST', 'BOMBS', 'KOs', 'PICKUPS', 'STAR', 'DEATHS']) header.append(element('span', '', label));
    comparison.append(header);
    for (const entry of stats) {
      const row = element('div', 'comparison-row'); row.style.setProperty('--player-color', escapeColor(entry.color));
      const rider = element('span', 'comparison-rider');
      const riderCopy = element('span');
      riderCopy.append(element('b', '', `#${entry.matchPlacement} ${entry.name}`), element('small', '', `${entry.wallBounces} BOUNCE · ${entry.earlyExits} EXIT`));
      rider.append(element('i'), riderCopy);
      const deaths = entry.deathsByCause;
      row.append(rider, element('strong', '', String(entry.roundWins)), element('span', '', durationText(entry.survivalTicks)),
        element('span', '', durationText(entry.longestSurvivalTicks)), element('span', '', `${Math.round(entry.distanceUnits)}u`),
        element('span', '', `${entry.bombsExploded}/${entry.bombsPlaced}`), element('span', '', String(entry.eliminations)),
        element('span', 'pickup-counts', `${entry.pickupsCollected} · B${entry.blastPickups} S${entry.starPickups} 🍺${entry.beerPickups} I${entry.inkPickups} T${entry.triplePickups} F${entry.fivePickups} O${entry.shieldPickups} P${entry.portalPickups}/${entry.portalTransits}`), element('span', '', durationText(entry.invulnerableTicks)),
        element('span', 'death-counts', `W${deaths.wall} T${deaths.trail} X${deaths.explosion} R${deaths.rider}`));
      comparison.append(row);
    }
  }

  function updateUi(snapshot: ViewSnapshot): void {
    renderScores(snapshot);
    renderLeaderboard(snapshot as ScoredSnapshot);
    renderMatchRecap(snapshot as ScoredSnapshot);
    timer.querySelector('strong')!.textContent = formatTimer(secondsRemaining(snapshot));
    timer.querySelector('.eyebrow')!.textContent = snapshot.phase === 'playing' ? `ROUND ${snapshot.round}` : phaseLabel(snapshot);
    roundBadge.textContent = `ROUND ${snapshot.round}`;
    const playerCount = snapshot.players.filter((player) => player.connected).length;
    const leaderboardAllowed = snapshot.phase === 'lobby' || snapshot.phase === 'roundOver' || snapshot.phase === 'matchOver';
    leaderboardButton.classList.toggle('hidden', !leaderboardAllowed);
    if (!leaderboardAllowed) { leaderboardDrawer.classList.add('hidden'); leaderboardButton.setAttribute('aria-expanded', 'false'); }
    renderRoster(snapshot);
    lobby.classList.toggle('hidden', snapshot.phase !== 'lobby');
    matchRecap.classList.toggle('hidden', snapshot.phase !== 'matchOver');
    recapAction.disabled = !authenticated || playerCount < 2;
    if (snapshot.phase === 'lobby') {
      action.textContent = 'START RACE'; action.dataset.action = 'start'; action.disabled = !authenticated || playerCount < 2;
      lobbyFooter.querySelector('p')!.textContent = !authenticated
        ? !hostToken ? 'Open the current TV host link to enable Start race.'
          : connection.textContent === 'HOST LINK EXPIRED' ? 'Host link expired — open the newest TV link to enable Start race.'
            : 'Connecting to host — Start race will unlock shortly.'
        : playerCount < 2 ? 'Waiting for at least 2 riders' : `${playerCount} riders ready`;
    } else if (snapshot.phase === 'countdown') {
      const remain = secondsRemaining(snapshot) ?? 0;
      announcement.className = 'announcement countdown';
      announcement.replaceChildren(element('span', 'announcement-small', `ROUND ${snapshot.round}`), element('strong', '', remain > 0 ? String(remain) : 'GO!'));
    } else if (snapshot.phase === 'playing') {
      announcement.className = 'announcement hidden';
      if (snapshot.roundStartedTick !== undefined && snapshot.tick - snapshot.roundStartedTick >= 1_200) {
        announcement.className = 'announcement overtime';
        announcement.textContent = 'OVERTIME // WALLS CLOSING';
      }
    } else if (snapshot.phase === 'roundOver') {
      const winner = snapshot.players.find((player) => player.id === snapshot.roundWinnerId);
      announcement.className = 'announcement result';
      announcement.replaceChildren(
        element('span', 'announcement-small', `ROUND ${snapshot.round}`),
        element('strong', '', winner ? `${winner.name} WINS` : 'DRAW'),
      );
      const placements = (snapshot as ScoredSnapshot).roundPlacements ?? [];
      if (placements.length) {
        const resultRows = element('div', 'round-placements');
        for (const placement of placements) {
          const row = element('span');
          row.append(element('b', '', `#${placement.place}`), document.createTextNode(` ${placement.name}  +${scoreText(placement.scoreUnits)}`));
          resultRows.append(row);
        }
        announcement.append(resultRows);
      }
      action.dataset.action = 'nextRound';
      action.textContent = 'NEXT ROUND';
      action.disabled = !authenticated || playerCount < 2 || (snapshot.phaseEndsAtTick !== undefined && snapshot.tick < snapshot.phaseEndsAtTick);
      announcement.append(action);
    } else {
      announcement.className = 'announcement hidden';
    }
  }

  function handleEvent(event: GameEvent): void {
    if (event.type === 'explosion') {
      canvas.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 180 });
    }
  }

  const socket = new SocketClient(
    () => hostToken ? { type: 'hostAuth', token: hostToken } : undefined,
    (message) => {
      if (message.type === 'hostAuthenticated') { authenticated = true; connection.textContent = 'HOST ONLINE'; connection.classList.add('online'); if (latest) updateUi(latest.snapshot); return; }
      if (message.type === 'error') {
        if (message.code === 'unauthorized') { authenticated = false; connection.classList.remove('online'); connection.textContent = 'HOST LINK EXPIRED'; }
        else connection.textContent = message.code.replaceAll('_', ' ').toUpperCase();
        if (latest) updateUi(latest.snapshot);
        return;
      }
      if (message.type === 'snapshot') {
        const accepted = snapshotStream.accept(message);
        if (!accepted) return;
        if (!document.hidden) audio.director.message(message);
        if (!latest || latest.matchId !== message.matchId || latest.round !== message.round) frames.length = 0;
        latest = { snapshot: accepted, matchId: message.matchId, round: message.round, receivedAt: performance.now() };
        frames.push(latest); if (frames.length > 5) frames.shift();
        updateUi(accepted);
      } else if (message.type === 'event') {
        if (!document.hidden) audio.director.message(message);
        const key = `${message.matchId}:${message.round}:${message.tick}:${JSON.stringify(message.event)}`;
        if (handledEvents.has(key)) return;
        handledEvents.add(key);
        if (handledEvents.size > 100) handledEvents.delete(handledEvents.values().next().value!);
        handleEvent(message.event);
      }
    },
    (connected) => {
      if (!connected) { authenticated = false; audio.director.disconnect(); }
      connection.textContent = connected ? 'AUTHENTICATING' : 'RECONNECTING'; connection.classList.toggle('online', connected && authenticated);
    },
    (milliseconds) => { transportRtt = milliseconds; },
  );
  window.addEventListener('hashchange', () => {
    if (!captureHostToken()) return;
    authenticated = false; connection.classList.remove('online'); connection.textContent = 'AUTHENTICATING';
    socket.send({ type: 'hostAuth', token: hostToken });
  });

  action.addEventListener('click', () => {
    audio.unlock();
    const hostAction = action.dataset.action as 'start' | 'nextRound' | 'rematch' | undefined;
    if (hostAction) socket.send({ type: 'hostAction', action: hostAction });
  });
  recapAction.addEventListener('click', () => { audio.unlock(); socket.send({ type: 'hostAction', action: 'rematch' }); });
  fullscreen.addEventListener('click', () => {
    const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    void request?.catch(() => { fullscreen.title = 'Fullscreen unavailable here — try opening the TV link in Chrome'; });
  });
  leaderboardButton.addEventListener('click', () => {
    const opening = leaderboardDrawer.classList.contains('hidden');
    leaderboardDrawer.classList.toggle('hidden', !opening); leaderboardButton.setAttribute('aria-expanded', String(opening));
  });
  leaderboardClose.addEventListener('click', () => { leaderboardDrawer.classList.add('hidden'); leaderboardButton.setAttribute('aria-expanded', 'false'); });
  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'p' || event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    showPerformance = !showPerformance; performanceDisplay.classList.toggle('hidden', !showPerformance);
  });
  fetch('/api/config').then((response) => response.json()).then((data: { controllerUrl?: unknown }) => {
    if (typeof data.controllerUrl !== 'string') throw new Error('Missing controller URL');
    configControllerUrl = data.controllerUrl;
    joinUrl.textContent = configControllerUrl.replace(/^https?:\/\//, '');
    return QRCode.toCanvas(qrCanvas, configControllerUrl, { width: 220, margin: 2, color: { dark: '#041027', light: '#f3fcff' } });
  }).catch(() => { joinUrl.textContent = 'Open /controller on this Wi-Fi'; });
  renderRoster();
  socket.connect();

  const ctx = canvas.getContext('2d');
  let previousFrameAt = performance.now();
  let averageFrameMs = 16.7;
  let averageRenderMs = 0;
  let lastMetricsAt = 0;
  let transportRtt: number | undefined;
  function frame(now: number): void {
    const renderStartedAt = performance.now();
    averageFrameMs = averageFrameMs * .94 + Math.min(250, now - previousFrameAt) * .06;
    previousFrameAt = now;
    const snapshot = renderedSnapshot(frames, now);
    if (snapshot && (canvas.width !== snapshot.width || canvas.height !== snapshot.height)) {
      canvas.width = snapshot.width; canvas.height = snapshot.height;
    }
    if (ctx && snapshot) drawArena(ctx, snapshot, now, activeTheme, activeSprites);
    else if (ctx) drawIdleArena(ctx, canvas.width, canvas.height, now, activeTheme);
    averageRenderMs = averageRenderMs * .9 + (performance.now() - renderStartedAt) * .1;
    if (showPerformance && now - lastMetricsAt > 500) {
      const age = latest ? Math.max(0, now - latest.receivedAt) : 0;
      performanceDisplay.value = `FPS ${Math.round(1000 / Math.max(1, averageFrameMs))}  RENDER ${averageRenderMs.toFixed(1)}ms  SNAP ${age.toFixed(0)}ms${transportRtt === undefined ? '' : `  RTT ${transportRtt.toFixed(0)}ms`}`;
      lastMetricsAt = now;
    }
    if (!document.hidden) audio.director.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function drawIdleArena(ctx: CanvasRenderingContext2D, width: number, height: number, now: number, theme: ThemeDefinition): void {
  ctx.fillStyle = theme.palette.floorEdge; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = theme.palette.grid; ctx.lineWidth = 1;
  const grid = theme.rendering.gridSize; const offset = (now / 100) % grid;
  for (let x = -grid + offset; x <= width; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = -grid + offset; y <= height; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.strokeStyle = theme.palette.rim; ctx.lineWidth = 4; ctx.shadowColor = theme.palette.rim; ctx.shadowBlur = 18; ctx.strokeRect(3, 3, width - 6, height - 6); ctx.shadowBlur = 0;
}

function startController(): void {
  document.body.className = 'controller-page';
  const root = element('main', 'controller-shell');
  const header = element('header', 'controller-header');
  const logo = element('div', 'controller-logo');
  logo.append(element('span', 'brand-cyan', 'FUSE'), document.createTextNode(' '), element('span', 'brand-pink', 'RIDERS'));
  const socketPill = element('span', 'socket-pill', 'OFFLINE');
  header.append(logo, socketPill);

  const join = element('section', 'join-screen');
  join.append(element('p', 'kicker', 'PHONE CONTROLLER'), element('h1', '', 'Choose your callsign'));
  const form = element('form', 'join-form');
  const input = element('input', 'name-input');
  input.type = 'text'; input.maxLength = 18; input.setAttribute('autocomplete', 'nickname'); input.placeholder = 'Rider name'; input.value = localStorage.getItem(PLAYER_NAME_KEY) ?? '';
  const joinButton = element('button', 'join-button', 'JOIN THE GRID'); joinButton.type = 'submit';
  const joinStatus = element('p', 'join-status', 'Connect to the same Wi-Fi as the TV.');
  form.append(input, joinButton); join.append(form, joinStatus);

  const controls = element('section', 'controls hidden');
  const identity = element('div', 'controller-identity');
  const identityMarker = element('span', 'identity-marker', '➤');
  const identityCopy = element('div'); identityCopy.append(element('small', '', 'YOU ARE'), element('strong', '', 'RIDER'));
  const stateBadge = element('span', 'state-badge', 'LOBBY');
  identity.append(identityMarker, identityCopy, stateBadge);
  const instruction = element('p', 'controller-instruction', 'Waiting for the host to start…');
  const powerStrip = element('div', 'power-strip');
  const blastPower = element('span', 'power-chip blast-power', 'BLAST · BASE');
  const starPower = element('span', 'power-chip star-power', 'STAR · --');
  const inkPower = element('span', 'power-chip', 'INK · --');
  const wobblePower = element('span', 'power-chip wobble-power', 'WOBBLE · --');
  const triplePower = element('span', 'power-chip triple-power', 'TRIPLE · --');
  const shieldPower = element('span', 'power-chip shield-power', 'SHIELD · --');
  const portalPower = element('span', 'power-chip portal-power', 'PORTAL · --');
  const sessionPoints = element('span', 'power-chip points-power', 'PTS · 0');
  powerStrip.append(blastPower, starPower, wobblePower, inkPower, triplePower, shieldPower, portalPower, sessionPoints);
  const pad = element('div', 'control-pad');
  const left = element('button', 'control-button steer', '↶'); left.dataset.control = 'left'; left.type = 'button'; left.setAttribute('aria-label', 'Turn left');
  const bomb = element('button', 'control-button bomb', '✦'); bomb.dataset.control = 'bomb'; bomb.type = 'button'; bomb.setAttribute('aria-label', 'Drop bomb');
  const bombLabel = element('span', 'bomb-label', 'BOMB READY'); bomb.append(bombLabel);
  const right = element('button', 'control-button steer', '↷'); right.dataset.control = 'right'; right.type = 'button'; right.setAttribute('aria-label', 'Turn right');
  pad.append(left, bomb, right);
  const leave = element('button', 'leave-button', 'LEAVE GAME'); leave.type = 'button';
  const controllerPerformance = element('output', 'perf-overlay controller-perf hidden', 'RTT --ms  ACK --ms');
  let showControllerPerformance = new URLSearchParams(location.search).get('perf') === '1';
  controllerPerformance.classList.toggle('hidden', !showControllerPerformance);
  controls.append(identity, instruction, powerStrip, pad, leave);
  root.append(header, join, controls, controllerPerformance);
  app.replaceChildren(root);

  let playerToken = localStorage.getItem(PLAYER_TOKEN_KEY) ?? '';
  let name = localStorage.getItem(PLAYER_NAME_KEY) ?? '';
  let playerId = '';
  let latestSnapshot: ViewSnapshot | undefined;
  const snapshotStream = new SnapshotStream();
  let resendTimer: number | undefined;
  let explicitJoinRequested = false;
  let hasLeft = false;
  let socket!: SocketClient;
  const inputSentAt = new Map<number, number>();
  let controllerRtt: number | undefined;
  let inputAckMs: number | undefined;
  let lastLaunchKey = '';
  function updateControllerDiagnostics(): void {
    controllerPerformance.value = `RTT ${controllerRtt === undefined ? '--' : controllerRtt.toFixed(0)}ms  ACK ${inputAckMs === undefined ? '--' : inputAckMs.toFixed(0)}ms`;
  }
  const inputState = new ControllerInputState({ send: (message) => {
    const sent = Boolean(playerId) && socket.send(message);
    if (sent) {
      inputSentAt.set(message.seq, performance.now());
      if (inputSentAt.size > 60) inputSentAt.delete(inputSentAt.keys().next().value!);
    }
    return sent;
  } });

  function status(text: string, error = false): void { joinStatus.textContent = text; joinStatus.classList.toggle('error', error); }
  function currentJoin(reconnectOnly = true): ClientMessage | undefined {
    if (!name || (reconnectOnly && !playerToken)) return undefined;
    return playerToken ? { type: 'join', name, playerToken } : { type: 'join', name };
  }
  function updateResend(): void {
    window.clearInterval(resendTimer);
    if (inputState.hasHeld()) resendTimer = window.setInterval(() => inputState.resend(), HELD_RESEND_MS);
  }
  function clearControls(send = true, force = false): void {
    pointerBindings.clear(send, force);
  }
  function updateFromSnapshot(snapshot: ViewSnapshot): void {
    const phaseChanged = latestSnapshot !== undefined && latestSnapshot.phase !== snapshot.phase;
    latestSnapshot = snapshot;
    if (phaseChanged) clearControls(true, true);
    const player = snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    const scored = snapshot as ScoredSnapshot;
    identityMarker.style.setProperty('--player-color', escapeColor(player.color));
    identityCopy.querySelector('strong')!.textContent = player.name;
    stateBadge.textContent = phaseLabel(snapshot);
    blastPower.textContent = player.blastLevel > 0 ? `BLAST · +${player.blastLevel}` : 'BLAST · BASE';
    const starTicks = player.invulnerableUntilTick - snapshot.tick;
    starPower.textContent = starTicks > 0 ? `STAR · ${(starTicks / 20).toFixed(1)}s` : 'STAR · --';
    const inkTicks = player.inkUntilTick - snapshot.tick;
    inkPower.textContent = inkTicks > 0 ? `INK · ${(inkTicks / 20).toFixed(1)}s` : 'INK · --';
    const drunkTicks = player.drunkUntilTick - snapshot.tick;
    wobblePower.textContent = drunkTicks > 0 ? `WOBBLE · ${(drunkTicks / 20).toFixed(1)}s` : 'WOBBLE · --';
    triplePower.textContent = player.fiveShotArmed ? 'FIVE · ARMED' : player.tripleShotArmed ? 'TRIPLE · ARMED' : 'TRIPLE · --';
    shieldPower.textContent = player.shielded ? 'SHIELD · READY' : player.shieldGraceUntilTick > snapshot.tick ? 'SHIELD · SPENT' : 'SHIELD · --';
    const portalGraceTicks = player.portalGraceUntilTick - snapshot.tick;
    const portalCooldownTicks = player.portalCooldownUntilTick - snapshot.tick;
    portalPower.textContent = portalGraceTicks > 0 ? `PORTAL · PHASE ${(portalGraceTicks / 20).toFixed(1)}s` : portalCooldownTicks > 0 ? `PORTAL · ${(portalCooldownTicks / 20).toFixed(1)}s` : 'PORTAL · --';
    const leaderboardEntry = (scored.leaderboard ?? []).find((entry) => entry.id === playerId);
    const placement = (scored.roundPlacements ?? []).find((entry) => entry.playerId === playerId);
    sessionPoints.textContent = placement && (snapshot.phase === 'roundOver' || snapshot.phase === 'matchOver')
      ? `#${placement.place} · +${scoreText(placement.scoreUnits)} · ${scoreText(leaderboardEntry?.totalScoreUnits ?? 0)}PTS`
      : `PTS · ${scoreText(leaderboardEntry?.totalScoreUnits ?? 0)}`;
    if (!player.connected) instruction.textContent = 'Reconnecting to your rider…';
    else if (snapshot.phase === 'lobby') instruction.textContent = 'You’re in. Look at the TV!';
    else if (snapshot.phase === 'countdown') instruction.textContent = `Get ready — ${secondsRemaining(snapshot) ?? 0}`;
    else if (!player.alive) instruction.textContent = 'Wiped out! Watch the TV for the next round.';
    else if (snapshot.phase === 'playing') instruction.textContent = 'Hold to steer. Hold bomb to charge, release to launch!';
    else if (snapshot.phase === 'matchOver') instruction.textContent = snapshot.matchWinnerId === playerId ? 'You rule the grid!' : 'Match complete.';
    else instruction.textContent = snapshot.roundWinnerId === playerId ? 'Round winner!' : 'Round complete.';
    const readyTicks = player.bombReadyAtTick - snapshot.tick;
    const charging = player.bombChargeStartedTick !== undefined;
    const chargePercent = charging ? Math.min(100, Math.round((snapshot.tick - player.bombChargeStartedTick!) / BOMB_MAX_CHARGE_TICKS * 100)) : 0;
    const ready = readyTicks <= 0 && snapshot.phase === 'playing' && player.alive;
    bomb.disabled = !ready && !charging;
    bomb.style.setProperty('--charge', `${chargePercent}%`);
    bomb.classList.toggle('charging', charging);
    bombLabel.textContent = charging ? `CHARGING ${chargePercent}% · RELEASE` : ready ? 'HOLD TO CHARGE' : readyTicks > 0 ? `${Math.ceil(readyTicks / 20)}s RECHARGE` : 'BOMB LOCKED';
  }

  socket = new SocketClient(
    () => currentJoin(!explicitJoinRequested),
    (message) => {
      if (message.type === 'inputAck') {
        const sentAt = inputSentAt.get(message.seq);
        if (sentAt !== undefined) { inputAckMs = performance.now() - sentAt; inputSentAt.delete(message.seq); updateControllerDiagnostics(); }
      } else if (message.type === 'joined') {
        explicitJoinRequested = false;
        hasLeft = false;
        playerId = message.playerId; playerToken = message.playerToken; inputState.setNextSequence(message.nextInputSeq);
        localStorage.setItem(PLAYER_TOKEN_KEY, playerToken); localStorage.setItem(PLAYER_NAME_KEY, name);
        identityMarker.style.setProperty('--player-color', escapeColor(message.color));
        join.classList.add('hidden'); controls.classList.remove('hidden');
        socketPill.textContent = `P${message.slot + 1} ONLINE`; socketPill.classList.add('online');
        clearControls(true, true);
      } else if (message.type === 'snapshot') {
        const accepted = snapshotStream.accept(message);
        if (accepted) updateFromSnapshot(accepted);
      } else if (message.type === 'event') {
        if (message.event.type === 'bombPlaced' && message.event.playerId === playerId) {
          const launchKey = `${message.matchId}:${message.round}:${message.tick}:${playerId}`;
          if (launchKey !== lastLaunchKey) {
            lastLaunchKey = launchKey; bomb.classList.remove('launching'); void bomb.offsetWidth; bomb.classList.add('launching');
            window.setTimeout(() => bomb.classList.remove('launching'), 280);
            if (navigator.vibrate) navigator.vibrate(45);
          }
        }
        if (message.event.type === 'explosion' && navigator.vibrate) navigator.vibrate([35, 25, 55]);
        if (message.event.type === 'playerEliminated' && message.event.playerId === playerId && navigator.vibrate) navigator.vibrate(180);
      } else if (message.type === 'error') {
        clearControls(false);
        if (message.code === 'unauthorized') {
          localStorage.removeItem(PLAYER_TOKEN_KEY); playerToken = ''; playerId = '';
          join.classList.remove('hidden'); controls.classList.add('hidden');
          status('Your old seat expired. Tap join to claim a new one.', true);
        } else {
          const messages: Record<string, string> = { full: 'All five seats are taken.', invalid_phase: 'A round is underway. Join after it ends.', stale: 'Controller resynced.', not_enough_players: 'Waiting for more riders.' };
          status(messages[message.code] ?? 'The game could not accept that action.', message.code !== 'stale');
        }
      }
    },
    (connected, reason) => {
      socketPill.textContent = hasLeft ? 'OFFLINE' : reason === 'replaced' ? 'OPEN ELSEWHERE' : connected ? 'CONNECTING' : 'RECONNECTING'; socketPill.classList.toggle('online', connected && !hasLeft);
      if (reason === 'replaced') instruction.textContent = 'This rider moved to another controller.';
      if (!connected) clearControls(false);
    },
    (milliseconds) => { controllerRtt = milliseconds; updateControllerDiagnostics(); },
  );

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'p' || event.repeat || event.target instanceof HTMLInputElement) return;
    showControllerPerformance = !showControllerPerformance;
    controllerPerformance.classList.toggle('hidden', !showControllerPerformance);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const trimmed = [...input.value.trim()].slice(0, 18).join('');
    if (!trimmed) { status('Enter a rider name.', true); input.focus(); return; }
    name = trimmed; localStorage.setItem(PLAYER_NAME_KEY, name); joinButton.disabled = true; status('Claiming a seat…');
    hasLeft = false;
    explicitJoinRequested = true;
    if (socket.send(currentJoin(false)!)) explicitJoinRequested = false;
    else socket.connect();
    window.setTimeout(() => { joinButton.disabled = false; }, 600);
  });

  const pointerBindings = new ControllerPointerBindings(inputState, [[left, 'left'], [bomb, 'bomb'], [right, 'right']], window, updateResend);
  leave.addEventListener('click', () => {
    hasLeft = true; clearControls(); socket.send({ type: 'leave' }); socket.close();
    localStorage.removeItem(PLAYER_TOKEN_KEY); playerToken = ''; playerId = ''; latestSnapshot = undefined;
    controls.classList.add('hidden'); join.classList.remove('hidden'); status('You left the game.');
  });
  window.addEventListener('blur', () => clearControls());
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearControls(); });
  window.addEventListener('pagehide', () => clearControls());
  socket.connect();
}

if (location.pathname.startsWith('/controller')) startController();
else startDisplay();
