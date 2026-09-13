import QRCode from 'qrcode';
import type { ClientMessage, GameEvent, GameSnapshot, ServerMessage, TrailSegment } from '../shared/protocol.js';
import { ControllerInputState, type ControllerControl } from './controller-state.js';
import { SnapshotStream, type ViewSnapshot } from './snapshot-stream.js';
import { applyThemeProperties, defaultTheme, loadThemeSprites, themes, type ThemeDefinition, type ThemeId, type ThemeSprites } from './themes.js';
import '@fontsource/press-start-2p/latin.css';
import './style.css';

const app = document.querySelector<HTMLElement>('#app')!;
if (!app) throw new Error('Missing app root');

const HEARTBEAT_MS = 2_000;
const HELD_RESEND_MS = 100;
const TICK_MS = 50;
const PLAYER_TOKEN_KEY = 'fuse-riders-player-token';
const PLAYER_NAME_KEY = 'fuse-riders-player-name';
const HOST_TOKEN_KEY = 'fuse-riders-host-token';
const THEME_KEY = 'fuse-riders-display-theme';

type SnapshotFrame = { snapshot: ViewSnapshot; matchId: string; round: number; receivedAt: number };

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

function interpolateAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

function renderedSnapshot(frames: SnapshotFrame[], now: number): ViewSnapshot | undefined {
  if (!frames.length) return undefined;
  const newer = frames[frames.length - 1];
  const older = frames.length > 1 ? frames[frames.length - 2] : newer;
  if (older === newer || older.matchId !== newer.matchId || older.round !== newer.round) return newer.snapshot;
  const sampleDuration = Math.max(1, newer.receivedAt - older.receivedAt);
  const projectionDuration = clamp(now - newer.receivedAt, 0, TICK_MS);
  const t = projectionDuration / sampleDuration;
  const oldById = new Map(older.snapshot.players.map((player) => [player.id, player]));
  return {
    ...newer.snapshot,
    players: newer.snapshot.players.map((player) => {
      const previous = oldById.get(player.id);
      if (!previous || !player.alive || !previous.alive) return player;
      return {
        ...player,
        x: player.x + (player.x - previous.x) * t,
        y: player.y + (player.y - previous.y) * t,
        angle: interpolateAngle(player.angle, player.angle + Math.atan2(Math.sin(player.angle - previous.angle), Math.cos(player.angle - previous.angle)), t),
      };
    }),
  };
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

  for (const player of snapshot.players) {
    const color = escapeColor(player.color);
    drawPlayerTrail(ctx, player.trail, snapshot.tick, player.alive, color, theme);
  }
  ctx.globalAlpha = 1;

  for (const bomb of snapshot.bombs) {
    const pulse = 1 + Math.sin(now / 90) * 0.08;
    const remaining = clamp((bomb.explodeAtTick - snapshot.tick) / 40, 0, 1);
    ctx.save();
    ctx.translate(Math.round(bomb.x), Math.round(bomb.y));
    ctx.scale(pulse, pulse);
    ctx.shadowColor = '#ff397e'; ctx.shadowBlur = 12;
    if (sprites.bomb) drawSprite(ctx, sprites.bomb, 0, 0, 44, 0, undefined, theme.rendering.pixelated);
    else { const ball = ctx.createRadialGradient(-5, -7, 1, 0, 0, 18); ball.addColorStop(0, '#7481a8'); ball.addColorStop(.3, '#242a4a'); ball.addColorStop(1, '#070815'); ctx.fillStyle = ball; ctx.strokeStyle = '#8f7bbd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.strokeStyle = remaining < 0.3 ? '#fff06a' : '#ff2d7d';
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14; ctx.lineWidth = 5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining); ctx.stroke();
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
    for (const rect of blast.rects) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = theme.palette.blast; ctx.shadowColor = theme.palette.blast; ctx.shadowBlur = 34;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      const horizontal = rect.width >= rect.height;
      const minor = horizontal ? rect.height : rect.width;
      const pad = Math.min(4, minor / 5);
      if (sprites.flame) {
        const length = horizontal ? rect.width : rect.height;
        for (const t of [.06, .94]) {
          const x = horizontal ? rect.x + t * length : rect.x + rect.width / 2;
          const y = horizontal ? rect.y + rect.height / 2 : rect.y + t * length;
          drawSprite(ctx, sprites.flame, x, y, 38, horizontal ? Math.PI / 2 : 0, undefined, theme.rendering.pixelated);
        }
      }
      ctx.fillStyle = '#ffb21e'; ctx.shadowBlur = 15;
      ctx.fillRect(rect.x + pad / 2, rect.y + pad / 2, rect.width - pad, rect.height - pad);
      ctx.fillStyle = theme.palette.blastCore; ctx.shadowColor = '#fff5a4'; ctx.shadowBlur = 12;
      ctx.fillRect(rect.x + pad, rect.y + pad, rect.width - pad * 2, rect.height - pad * 2);
      if (theme.rendering.pixelated) {
        const length = horizontal ? rect.width : rect.height;
        for (let index = 0; index < Math.floor(length / 18); index += 1) {
          const along = (index + .35) * length / Math.max(1, Math.floor(length / 18));
          const side = index % 2 ? 1 : -1;
          const x = horizontal ? rect.x + along : rect.x + rect.width / 2 + side * (minor / 2 + 3 + index % 4);
          const y = horizontal ? rect.y + rect.height / 2 + side * (minor / 2 + 3 + index % 4) : rect.y + along;
          ctx.globalAlpha = alpha * .7; ctx.fillStyle = index % 3 ? '#ff7618' : '#ffe14a'; ctx.shadowBlur = 8;
          ctx.fillRect(Math.round(x), Math.round(y), index % 3 === 0 ? 5 : 3, index % 3 === 0 ? 5 : 3);
        }
      }
      ctx.restore();
    }
    const horizontal = blast.rects.find((rect) => rect.width >= rect.height);
    const vertical = blast.rects.find((rect) => rect.height > rect.width);
    if (horizontal && vertical) {
      const cx = vertical.x + vertical.width / 2; const cy = horizontal.y + horizontal.height / 2;
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(Math.round(cx), Math.round(cy));
      ctx.shadowColor = '#ff6b12'; ctx.shadowBlur = 35;
      if (sprites.flame) drawSprite(ctx, sprites.flame, 0, 9, 74, 0, undefined, theme.rendering.pixelated);
      ctx.fillStyle = '#ff5c12';
      ctx.beginPath(); ctx.moveTo(-42, -7); ctx.lineTo(-25, -16); ctx.lineTo(-12, -25); ctx.lineTo(-7, -43); ctx.lineTo(6, -43); ctx.lineTo(13, -24); ctx.lineTo(27, -16); ctx.lineTo(43, -7); ctx.lineTo(43, 7); ctx.lineTo(25, 13); ctx.lineTo(14, 27); ctx.lineTo(7, 43); ctx.lineTo(-7, 43); ctx.lineTo(-14, 26); ctx.lineTo(-27, 15); ctx.lineTo(-43, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd52f'; ctx.shadowBlur = 18; ctx.fillRect(-22, -22, 44, 44);
      ctx.fillStyle = '#fffde1'; ctx.shadowColor = '#fff7a1'; ctx.shadowBlur = 15; ctx.fillRect(-12, -31, 24, 62); ctx.fillRect(-31, -12, 62, 24);
      for (let index = 0; index < 13; index += 1) {
        const angle = index * 2.4; const radius = 47 + index % 4 * 6;
        const size = index % 3 === 0 ? 6 : 3;
        ctx.fillStyle = index % 2 ? '#ff6417' : '#ffd32d';
        ctx.fillRect(Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius), size, size);
      }
      ctx.restore();
    }
  }

  for (const player of snapshot.players) {
    const color = escapeColor(player.color);
    ctx.save(); ctx.globalAlpha = player.alive ? 1 : 0.22; ctx.shadowColor = color; ctx.shadowBlur = 18;
    if (sprites.rider) drawSprite(ctx, sprites.rider, player.x, player.y, 44, player.angle, color, theme.rendering.pixelated);
    else { ctx.translate(player.x, player.y); ctx.rotate(player.angle); ctx.fillStyle = '#f7ffff'; ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-11, -10); ctx.lineTo(-5, 0); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    if (player.alive) {
      ctx.save(); ctx.font = '10px "Press Start 2P"'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.fillText(`P${player.slot + 1}`, Math.round(player.x), Math.round(player.y - 29)); ctx.restore();
    }
  }
}

function startDisplay(): void {
  document.body.className = 'display-page';
  const root = element('main', 'display-shell');
  const topbar = element('header', 'topbar');
  const brand = element('div', 'brand');
  brand.append(element('span', 'brand-cyan', 'FUSE'), document.createTextNode(' '), element('span', 'brand-pink', 'RIDERS'));
  const scores = element('div', 'scores');
  const timer = element('div', 'timer');
  timer.append(element('span', 'eyebrow', 'ROUND'), element('strong', '', '--:--'));
  const connection = element('span', 'connection', 'CONNECTING');
  const themeSelect = element('select', 'theme-select');
  themeSelect.setAttribute('aria-label', 'Visual style');
  for (const theme of Object.values(themes)) {
    const option = element('option', '', theme.label); option.value = theme.id; themeSelect.append(option);
  }
  topbar.append(brand, scores, timer, themeSelect, connection);

  const stage = element('section', 'stage');
  const canvas = element('canvas', 'arena');
  canvas.width = 1200; canvas.height = 700;
  const lobby = element('div', 'lobby-overlay');
  const lobbyCard = element('div', 'lobby-card');
  const lobbyCopy = element('div', 'lobby-copy');
  lobbyCopy.append(element('p', 'kicker', 'PHONE PARTY // 2–5 RIDERS'), element('h1', '', 'Scan. Steer. Survive.'), element('p', 'lede', 'Open the controller, pick a name, then use your phone to carve neon trails and trigger chain reactions.'));
  const joinPanel = element('div', 'join-panel');
  const qrCanvas = element('canvas', 'qr');
  const joinUrl = element('p', 'join-url', 'Loading join link…');
  joinPanel.append(qrCanvas, element('p', 'scan-label', 'SCAN TO JOIN'), joinUrl);
  const roster = element('div', 'roster');
  const lobbyFooter = element('div', 'lobby-footer');
  const action = element('button', 'host-action', 'START RACE');
  action.disabled = true;
  const fullscreen = element('button', 'fullscreen', '⛶ FULLSCREEN');
  lobbyFooter.append(element('p', 'host-hint', 'Waiting for at least 2 riders'), action, fullscreen);
  lobbyCard.append(lobbyCopy, joinPanel, roster, lobbyFooter);
  lobby.append(lobbyCard);

  const announcement = element('div', 'announcement hidden');
  const performanceDisplay = element('output', 'perf-overlay hidden', 'FPS --  RENDER --ms');
  const roundBadge = element('div', 'round-badge', 'ROUND 1');
  stage.append(canvas, lobby, roundBadge, announcement, performanceDisplay);
  root.append(topbar, stage);
  app.replaceChildren(root);

  const hostToken = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : sessionStorage.getItem(HOST_TOKEN_KEY) ?? '';
  if (location.hash) {
    sessionStorage.setItem(HOST_TOKEN_KEY, hostToken);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  let authenticated = false;
  let latest: SnapshotFrame | undefined;
  const snapshotStream = new SnapshotStream();
  const frames: SnapshotFrame[] = [];
  const handledEvents = new Set<string>();
  let configControllerUrl = '';
  let rosterSignature = '';
  let scoresSignature = '';
  let showPerformance = new URLSearchParams(location.search).get('perf') === '1';
  performanceDisplay.classList.toggle('hidden', !showPerformance);
  const savedTheme = localStorage.getItem(THEME_KEY);
  let activeTheme = savedTheme && savedTheme in themes ? themes[savedTheme as ThemeId] : defaultTheme;
  let activeSprites: ThemeSprites = {};
  themeSelect.value = activeTheme.id;
  applyThemeProperties(activeTheme);
  void loadThemeSprites(activeTheme).then((sprites) => { activeSprites = sprites; });

  themeSelect.addEventListener('change', () => {
    const next = themes[themeSelect.value as ThemeId];
    if (!next) return;
    activeTheme = next; activeSprites = {}; localStorage.setItem(THEME_KEY, next.id); applyThemeProperties(next);
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
      for (let win = 0; win < 5; win += 1) pips.append(element('i', win < player.roundWins ? 'won' : ''));
      const details = element('span', 'score-details');
      const seatName = player.name.toUpperCase() === `P${player.slot + 1}` ? `P${player.slot + 1}` : `P${player.slot + 1} ${player.name}`;
      details.append(element('span', 'score-name', seatName), pips);
      card.append(element('span', 'score-arrow', '➤'), details);
      scores.append(card);
    }
  }

  function updateUi(snapshot: ViewSnapshot): void {
    renderScores(snapshot);
    timer.querySelector('strong')!.textContent = formatTimer(secondsRemaining(snapshot));
    timer.querySelector('.eyebrow')!.textContent = snapshot.phase === 'playing' ? `ROUND ${snapshot.round}` : phaseLabel(snapshot);
    roundBadge.textContent = `ROUND ${snapshot.round}`;
    const playerCount = snapshot.players.filter((player) => player.connected).length;
    renderRoster(snapshot);
    lobby.classList.toggle('hidden', snapshot.phase !== 'lobby');
    if (snapshot.phase === 'lobby') {
      action.textContent = 'START RACE'; action.dataset.action = 'start'; action.disabled = !authenticated || playerCount < 2;
      lobbyFooter.querySelector('p')!.textContent = playerCount < 2 ? 'Waiting for at least 2 riders' : `${playerCount} riders ready`;
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
    } else {
      const winnerId = snapshot.phase === 'matchOver' ? snapshot.matchWinnerId : snapshot.roundWinnerId;
      const winner = snapshot.players.find((player) => player.id === winnerId);
      announcement.className = 'announcement result';
      announcement.replaceChildren(
        element('span', 'announcement-small', snapshot.phase === 'matchOver' ? 'CHAMPION' : `ROUND ${snapshot.round}`),
        element('strong', '', winner ? `${winner.name} WINS` : 'DRAW'),
      );
      action.dataset.action = snapshot.phase === 'matchOver' ? 'rematch' : 'nextRound';
      action.textContent = snapshot.phase === 'matchOver' ? 'REMATCH' : 'NEXT ROUND';
      action.disabled = !authenticated || playerCount < 2 || (snapshot.phaseEndsAtTick !== undefined && snapshot.tick < snapshot.phaseEndsAtTick);
      announcement.append(action);
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
      if (message.type === 'hostAuthenticated') { authenticated = true; connection.textContent = 'HOST ONLINE'; connection.classList.add('online'); return; }
      if (message.type === 'error') { connection.textContent = message.code.replaceAll('_', ' ').toUpperCase(); return; }
      if (message.type === 'snapshot') {
        const accepted = snapshotStream.accept(message);
        if (!accepted) return;
        if (!latest || latest.matchId !== message.matchId || latest.round !== message.round) frames.length = 0;
        latest = { snapshot: accepted, matchId: message.matchId, round: message.round, receivedAt: performance.now() };
        frames.push(latest); if (frames.length > 5) frames.shift();
        updateUi(accepted);
      } else if (message.type === 'event') {
        const key = `${message.matchId}:${message.round}:${message.tick}:${JSON.stringify(message.event)}`;
        if (handledEvents.has(key)) return;
        handledEvents.add(key);
        if (handledEvents.size > 100) handledEvents.delete(handledEvents.values().next().value!);
        handleEvent(message.event);
      }
    },
    (connected) => {
      if (!connected) authenticated = false;
      connection.textContent = connected ? 'AUTHENTICATING' : 'RECONNECTING'; connection.classList.toggle('online', connected && authenticated);
    },
    (milliseconds) => { transportRtt = milliseconds; },
  );

  action.addEventListener('click', () => {
    const hostAction = action.dataset.action as 'start' | 'nextRound' | 'rematch' | undefined;
    if (hostAction) socket.send({ type: 'hostAction', action: hostAction });
  });
  fullscreen.addEventListener('click', () => document.documentElement.requestFullscreen?.());
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
  controls.append(identity, instruction, pad, leave);
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
    inputState.clear(send, force);
    for (const button of pad.querySelectorAll('.active')) button.classList.remove('active');
    updateResend();
  }
  function updateFromSnapshot(snapshot: ViewSnapshot): void {
    const phaseChanged = latestSnapshot !== undefined && latestSnapshot.phase !== snapshot.phase;
    latestSnapshot = snapshot;
    if (phaseChanged) clearControls(true, true);
    const player = snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    identityMarker.style.setProperty('--player-color', escapeColor(player.color));
    identityCopy.querySelector('strong')!.textContent = player.name;
    stateBadge.textContent = phaseLabel(snapshot);
    if (!player.connected) instruction.textContent = 'Reconnecting to your rider…';
    else if (snapshot.phase === 'lobby') instruction.textContent = 'You’re in. Look at the TV!';
    else if (snapshot.phase === 'countdown') instruction.textContent = `Get ready — ${secondsRemaining(snapshot) ?? 0}`;
    else if (!player.alive) instruction.textContent = 'Wiped out! Watch the TV for the next round.';
    else if (snapshot.phase === 'playing') instruction.textContent = 'Hold to steer. Tap bomb, then move!';
    else if (snapshot.phase === 'matchOver') instruction.textContent = snapshot.matchWinnerId === playerId ? 'You rule the grid!' : 'Match complete.';
    else instruction.textContent = snapshot.roundWinnerId === playerId ? 'Round winner!' : 'Round complete.';
    const readyTicks = player.bombReadyAtTick - snapshot.tick;
    const ready = readyTicks <= 0 && snapshot.phase === 'playing' && player.alive;
    bomb.disabled = !ready;
    bombLabel.textContent = ready ? 'BOMB READY' : readyTicks > 0 ? `${Math.ceil(readyTicks / 20)}s RECHARGE` : 'BOMB LOCKED';
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

  for (const button of pad.querySelectorAll<HTMLButtonElement>('[data-control]')) {
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const control = button.dataset.control as ControllerControl;
      button.setPointerCapture(event.pointerId); inputState.pointerDown(event.pointerId, control); button.classList.add('active'); updateResend();
    });
    const release = (event: PointerEvent) => {
      event.preventDefault();
      const control = button.dataset.control as ControllerControl;
      inputState.pointerRelease(event.pointerId);
      button.classList.toggle('active', inputState.isHeld(control)); updateResend();
    };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  }
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
