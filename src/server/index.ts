import { unknownDevice } from '../shared/device-profile.js';
import { BotController, BOT_ID_PREFIX, botRandom, type BotDependencies } from '../shared/bot-controller.js';
import http from 'node:http';
import { BombInputBuffer } from '../shared/bomb-input.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import type { ViteDevServer } from 'vite';
import { createDevRoomService, type DevRoomService } from '../service/dev.js';
import { parseClientMessage, type ErrorCode, type ServerMessage, type GameSnapshot } from '../shared/protocol.js';
import {
  createGame, addPlayer, removePlayer, startMatch, startNextRound, resetMatch, returnToLobby,
  setPlayerConnected, eliminatePlayer, step, toSnapshot, type InputIntent,
} from '../shared/game.js';

const COLORS = ['#00d9ff', '#ff3aaf', '#b5ff36', '#ff963b', '#b76bff'];
const NEUTRAL: InputIntent = { left: false, right: false, bomb: false };
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const secret = () => randomBytes(24).toString('hex');
interface Seat {
  id: string; token: string; slot: number; socket?: WebSocket;
  seq: number; appliedSeq: number; intent: InputIntent; inputTick: number;
  bombInput: BombInputBuffer; leaving: boolean;
}
interface Connection { host: boolean; seat?: Seat; lastSeen: number; window: number; count: number }
export interface ServerDependencies {
  now: () => number;
  botRandom: BotDependencies['random'];
  token: () => string;
  schedule: (callback: () => void, intervalMs: number) => () => void;
}
/** `roomApi` proxies `/api/*` and its WebSocket upgrades to a room service so the home page's online rooms work from this server. */
export interface ServerOptions { port?: number; hostname?: string; lanAddress?: string; dev?: boolean; manualTicks?: boolean; buildDirectory?: string; roomApi?: string; dependencies?: Partial<ServerDependencies> }
/** Dev-only forwarding to the local room service; it only admits same-origin loopback pages, so Host and Origin are both rewritten. */
function proxyHeaders(target: URL, headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const forwarded: http.OutgoingHttpHeaders = {};
  // Client-supplied address headers would let a caller pick its own rate-limit key at the room service.
  for (const [key, value] of Object.entries(headers)) if (value !== undefined && !/^(cf-connecting-ip|x-real-ip|x-forwarded-.*)$/.test(key)) forwarded[key] = value;
  forwarded.host = target.host;
  // Only a page served by this server gets its Origin rewritten; any other origin still fails the room service's check.
  if (headers.origin) forwarded.origin = headers.origin === `http://${headers.host}` ? target.origin : headers.origin;
  return forwarded;
}
/**
 * A single `bytes=start-end` range against a file of `size` bytes. `undefined` means no range was requested
 * (or it was a form we don't support, e.g. multi-range) and the whole file should be served; `'unsatisfiable'`
 * means a range was requested but falls outside the file, which is a 416 rather than a silent full response.
 */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  if (!header || size === 0) return undefined;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  const start = match[1] ? Number(match[1]) : Math.max(size - Number(match[2]), 0);
  const end = Math.min(match[1] && match[2] ? Number(match[2]) : size - 1, size - 1);
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end ? { start, end } : 'unsatisfiable';
}
function proxyRequest(target: URL, req: http.IncomingMessage, res: http.ServerResponse): void {
  const upstream = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: proxyHeaders(target, req.headers) }, upstreamResponse => {
    res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Room service unavailable: start it with npm run dev:online or set ROOM_API' })); });
  req.pipe(upstream);
}
function proxyUpgrade(target: URL, req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
  const upstream = http.request({ host: target.hostname, port: target.port, method: 'GET', path: req.url, headers: proxyHeaders(target, req.headers) });
  // Node drops its own error listener when it emits 'upgrade'; a client reset before the upstream answers must not be uncaught.
  socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
  upstream.setTimeout(10_000, () => upstream.destroy());
  upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const lines = ['HTTP/1.1 101 Switching Protocols'];
    for (const [key, value] of Object.entries(upstreamResponse.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) lines.push(`${key}: ${item}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket); socket.pipe(upstreamSocket);
    socket.on('error', () => upstreamSocket.destroy()); upstreamSocket.on('error', () => socket.destroy());
  });
  upstream.on('response', upstreamResponse => { socket.end(`HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? ''}\r\nConnection: close\r\n\r\n`); });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}

export function controllerSnapshot(state: GameSnapshot): GameSnapshot {
  return { ...state, players: state.players.map(player => ({ ...player, trail: [] })), bombs: [], blasts: [], pickups: [], portalPairs: [], gravityFields: [], matchStats: [], moments: [] };
}

export function lanAddress() {
  const ips = Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x!.address);
  return process.env.HOST_IP || ips.find(x => /^192\.168\./.test(x)) || ips.find(x => /^10\./.test(x)) || ips.find(x => /^172\.(1[6-9]|2\d|3[01])\./.test(x)) || '127.0.0.1';
}
export function catchUpSteps(elapsed: number) { return Math.min(5, Math.max(0, Math.floor(elapsed / 50))); }

// Parallel worktrees and stale processes hold the usual ports; walk up rather than die on EADDRINUSE.
export async function listenFree(server: http.Server, port: number, hostname: string, tries = 20): Promise<number> {
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, hostname, () => { server.off('error', reject); resolve(); });
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || --tries <= 0) throw error;
      port++;
    }
  }
}

export async function createGameServer(options: ServerOptions = {}) {
  const dependencies: ServerDependencies = {
    now: () => performance.now(), token: secret, botRandom,
    schedule: (callback, interval) => { const timer = setInterval(callback, interval); return () => clearInterval(timer); },
    ...options.dependencies,
  };
  const game = createGame(dependencies.token());
  const hostToken = dependencies.token();
  const seats = new Map<string, Seat>();
  const bots=new Set<string>(),botController=new BotController({random:dependencies.botRandom});
  const connections = new Map<WebSocket, Connection>();
  const joins = new Map<string, { since: number; count: number }>();
  let controllerUrl = '';
  let vite: ViteDevServer | undefined;
  const roomApi = options.roomApi ? new URL(options.roomApi) : undefined;
  if (roomApi && roomApi.protocol !== 'http:') throw new Error(`ROOM_API must be an http:// URL, got ${options.roomApi}`);
  const server = http.createServer(async (req, res) => {
    // Devices post their runtime telemetry here in development; one NDJSON file per room under artifacts/telemetry.
    if (req.method === 'POST' && req.url?.split('?')[0] === '/telemetry') {
      const chunks: Buffer[] = []; let size = 0; req.on('data', (chunk: Buffer) => { chunks.push(chunk); size += chunk.length; if (size > 2_000_000) req.destroy(); });
      req.on('end', async () => {
        try {
          const { device, events } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { device: Record<string, unknown>; events: Record<string, unknown>[] };
          const room = String(device?.room ?? 'none').replace(/[^A-Za-z0-9_-]/g, '') || 'none', dir = path.join(ROOT, 'artifacts', 'telemetry');
          await mkdir(dir, { recursive: true });
          await appendFile(path.join(dir, `${room}.ndjson`), events.map(event => JSON.stringify({ ...event, device, received: Date.now() })).join('\n') + '\n');
          res.writeHead(204);
        } catch { res.writeHead(400); }
        res.end();
      });
      return;
    }
    if (req.url?.split('?')[0] === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ controllerUrl })); return;
    }
    if (roomApi && req.url?.startsWith('/api/')) { proxyRequest(roomApi, req, res); return; }
    if (vite) { vite.middlewares(req, res); return; }
    try {
      const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://local').pathname);
      const isPage = ['/', '/display', '/controller'].includes(urlPath);
      const dist = path.resolve(options.buildDirectory ?? path.join(ROOT, 'dist'));
      const filename = path.resolve(dist, isPage ? 'index.html' : '.' + urlPath);
      if (!filename.startsWith(dist + path.sep)) throw new Error('not found');
      const fileStat = await stat(filename);
      if (!fileStat.isFile()) throw new Error('not found');
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.m4a': 'audio/mp4' };
      // A build-hashed asset's name changes whenever its content does, so it can be cached forever; everything else
      // (index.html, and public/ files like music that keep the same name across edits) must revalidate on every
      // load, which the ETag below turns into a cheap 304 instead of a full re-download once it's already cached.
      const cacheControl = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      const etag = `W/"${fileStat.size.toString(16)}-${fileStat.mtimeMs.toString(16)}"`;
      const headers: http.OutgoingHttpHeaders = {
        'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': cacheControl,
        ETag: etag, 'Last-Modified': fileStat.mtime.toUTCString(), 'Accept-Ranges': 'bytes',
      };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
      const range = parseRange(req.headers.range, fileStat.size);
      if (range === 'unsatisfiable') { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${fileStat.size}` }); res.end(); return; }
      if (range) res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`, 'Content-Length': range.end - range.start + 1 });
      else res.writeHead(200, { ...headers, 'Content-Length': fileStat.size });
      if (req.method === 'HEAD') { res.end(); return; }
      // Headers are already sent by the time a read can fail (e.g. the file vanishes mid-request), so the only
      // way back to `catch` below is destroying the response; letting the stream's 'error' go unhandled would
      // otherwise be an uncaught exception that crashes the whole game server.
      createReadStream(filename, range || undefined).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  // HMR rides this http server instead of Vite's fixed 24678, so parallel dev servers never collide.
  if (options.dev) vite = await (await import('vite')).createServer({
    root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa',
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  server.on('upgrade', (req, socket, head) => {
    // Vite's own upgrade listener picks up the rest (it answers only the vite-hmr subprotocol).
    const pathname = new URL(req.url || '/', 'http://local').pathname;
    if (pathname === '/ws') wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    else if (roomApi && pathname.startsWith('/api/')) proxyUpgrade(roomApi, req, socket, head);
    else if (!vite) socket.destroy();
  });
  function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 512_000) ws.send(JSON.stringify(message));
  }
  function snapshot(ws?: WebSocket, displayOnly = false) {
    const message: ServerMessage = { type: 'snapshot', matchId: game.matchId, round: game.round, tick: game.tick, state: toSnapshot(game) };
    let full: string | undefined; let compact: string | undefined;
    const deliver = (client: WebSocket) => {
      const host = connections.get(client)?.host;
      if (displayOnly && !host) return;
      if (client.readyState !== WebSocket.OPEN || client.bufferedAmount > 512_000) return;
      const payload = host ? (full ??= JSON.stringify(message)) : (compact ??= JSON.stringify({ ...message, state: controllerSnapshot(message.state) }));
      client.send(payload);
    };
    if (ws) deliver(ws); else for (const client of connections.keys()) deliver(client);
  }
  function error(ws: WebSocket, code: ErrorCode) { send(ws, { type: 'error', code }); }
  function neutral(seat: Seat, rearm = false) {
    seat.bombInput.cancel(rearm);
    seat.intent = { ...NEUTRAL };
  }
  function clearInputs() { for (const seat of seats.values()) neutral(seat); }
  function detach(ws: WebSocket) {
    const c = connections.get(ws);
    connections.delete(ws);
    if (c?.seat && c.seat.socket === ws) {
      neutral(c.seat, true); c.seat.socket = undefined;
      setPlayerConnected(game, c.seat.id, false);
      snapshot();
    }
  }
  // Only legal where removePlayer is: a mid-round seat belongs to its phone until the round ends, so it can reconnect.
  function seatReclaimable() { return ['lobby', 'roundOver', 'matchOver'].includes(game.phase); }
  function pruneDisconnected() {
    // Only call where seatReclaimable() holds. Never alter participants mid-transaction.
    for (const [id, seat] of seats) if (!seat.socket || seat.leaving) {
      removePlayer(game, id); seats.delete(id);
    }
  }
  function connectedCount() { return [...seats.values()].filter(s => s.socket && !s.leaving).length+bots.size; }
  function hostAction(ws: WebSocket, action: 'start' | 'nextRound' | 'rematch' | 'lobby') {
    if (action === 'lobby') {
      returnToLobby(game, dependencies.token());
      pruneDisconnected(); clearInputs(); snapshot(); return;
    }
    const required = { start: 'lobby', nextRound: 'roundOver', rematch: 'matchOver' };
    if (game.phase !== required[action]) { error(ws, 'invalid_phase'); return; }
    // Prune first: a party of vanished phones must never be counted, or the lobby can never be started or refilled.
    // resetMatch handles filtering at matchOver; removePlayer supports boundary cleanup.
    pruneDisconnected();
    if (connectedCount() < 2) { snapshot(); error(ws, 'not_enough_players'); return; }
    clearInputs();
    try {
      if (action === 'start') startMatch(game);
      else if (action === 'nextRound') startNextRound(game);
      else resetMatch(game, dependencies.token());
      snapshot();
    } catch { error(ws, 'invalid_phase'); }
  }
  wss.on('connection', (ws, req) => {
    const now = dependencies.now();
    const c: Connection = { host: false, lastSeen: now, window: now, count: 0 };
    connections.set(ws, c);
    snapshot(ws);
    ws.on('error', () => { /* close handler owns session cleanup */ });
    ws.on('close', () => detach(ws));
    ws.on('message', (data, binary) => {
      if (!connections.has(ws)) return;
      const now = dependencies.now();
      if (now - c.window >= 1000) { c.window = now; c.count = 0; }
      if (++c.count > 100) { error(ws, 'invalid_message'); ws.close(1008, 'Rate limit'); return; }
      const message = binary ? null : parseClientMessage(data.toString());
      if (!message) { error(ws, 'invalid_message'); return; }
      c.lastSeen = now;
      if (message.type === 'heartbeat') return;
      if (message.type === 'ping') { send(ws, { type: 'pong', id: message.id, sentAt: message.sentAt }); return; }
      if (message.type === 'hostAuth') {
        if (c.seat || message.token.length !== hostToken.length || !timingSafeEqual(Buffer.from(message.token), Buffer.from(hostToken))) {
          error(ws, 'unauthorized'); return;
        }
        c.host = true; send(ws, { type: 'hostAuthenticated' }); snapshot(ws); return;
      }
      if(message.type==='hostBot'){
        if(!c.host){error(ws,'unauthorized');return;}
        if(message.action==='add'){
          if(game.players.size>=5||game.leaderboard.size>=128){error(ws,'full');return;}
          const slot=COLORS.findIndex((_,slot)=>![...game.players.values()].some(player=>player.slot===slot));
          let number=1;while(game.leaderboard.has(`${BOT_ID_PREFIX}${number}`))number++;
          const id=`${BOT_ID_PREFIX}${number}`;addPlayer(game,{id,name:`AI ${['Ada','Turing','Hopper','Nova','Byte'][slot]}`,slot,color:COLORS[slot]!,avatarId:'robot',connected:true});bots.add(id);
        }else{
          if(!seatReclaimable()){error(ws,'invalid_phase');return;}
          if(!message.id||!bots.has(message.id)){error(ws,'invalid_message');return;}
          removePlayer(game,message.id);bots.delete(message.id);
        }
        snapshot();return;
      }
      if (message.type === 'hostAction') {
        if (!c.host || c.seat) { error(ws, 'unauthorized'); return; }
        hostAction(ws, message.action); return;
      }
      if (message.type === 'join') {
        if (c.seat || c.host) { error(ws, 'unauthorized'); return; }
        const address = req.socket.remoteAddress || 'unknown';
        let rate = joins.get(address);
        if (!rate || now - rate.since > 60_000) { rate = { since: now, count: 0 }; joins.set(address, rate); }
        // Reconnects are authorized by their token and must survive brief Wi-Fi drops.
        if (!message.playerToken && ++rate.count > 5) { error(ws, 'full'); return; }
        let seat: Seat | undefined;
        if (message.playerToken) {
          seat = [...seats.values()].find(s => s.token === message.playerToken && !s.leaving);
          if (!seat) { error(ws, 'unauthorized'); return; }
          const old = seat.socket;
          seat.socket = undefined;
          if (old) { connections.delete(old); old.close(4001, 'Controller replaced'); }
          neutral(seat, true);
        } else {
          // A vanished phone holds its seat only while a round is running; between rounds a newcomer may reclaim it.
          if (game.players.size >= 5 && seatReclaimable()) pruneDisconnected();
          if (game.players.size >= 5) { error(ws, 'full'); return; }
          const slot = COLORS.findIndex((_, i) => ![...game.players.values()].some(s => s.slot === i));
          seat = { id: dependencies.token(), token: dependencies.token(), slot, seq: -1, appliedSeq: -1, intent: { ...NEUTRAL }, inputTick: game.tick, bombInput: new BombInputBuffer(), leaving: false };
          addPlayer(game, { id: seat.id, name: message.name, avatarId: message.avatarId, slot, color: COLORS[slot], connected: true });
          seats.set(seat.id, seat);
        }
        game.players.get(seat.id)!.deviceProfile = { ...(message.deviceProfile ?? unknownDevice()) };
        c.seat = seat; seat.socket = ws; setPlayerConnected(game, seat.id, true);
        send(ws, { type: 'joined', playerId: seat.id, playerToken: seat.token, slot: seat.slot, color: COLORS[seat.slot], nextInputSeq: seat.seq + 1 });
        snapshot(); return;
      }
      const seat = c.seat;
      if (!seat || seat.socket !== ws || seat.leaving) { error(ws, 'unauthorized'); return; }
      if (message.type === 'deviceProfile') { game.players.get(seat.id)!.deviceProfile = { ...message.profile }; snapshot(); return; }
      if (message.type === 'setAvatar') {
        game.players.get(seat.id)!.avatarId = message.avatarId;
        snapshot(); return;
      }
      if (message.type === 'leave') {
        neutral(seat); seat.leaving = true; seat.socket = undefined; c.seat = undefined;
        setPlayerConnected(game, seat.id, false);
        if (seatReclaimable()) { removePlayer(game, seat.id); seats.delete(seat.id); }
        else eliminatePlayer(game, seat.id);
        snapshot(); return;
      }
      if (message.type === 'input') {
        if (message.seq <= seat.seq) { error(ws, 'stale'); return; }
        seat.seq = message.seq; seat.inputTick = game.tick;
        if (game.phase !== 'playing') { neutral(seat); return; }
        seat.bombInput.accept(message.bomb, message.bombAction, message.aim);
        seat.intent = { left: message.left, right: message.right, bomb: message.bomb, ...(message.aim ? { aim: { ...message.aim } } : {}) };
      }
    });
  });
  function advance(count = 1) {
    for (let i = 0; i < count; i++) {
      const previousPhase = game.phase;
      const inputs = new Map<string, InputIntent>();
      for (const seat of seats.values()) {
        if (!seat.socket || game.tick - seat.inputTick >= 10) neutral(seat);
        inputs.set(seat.id, { ...seat.intent, bombCommands: seat.bombInput.drainCommands() });
      }
      for(const id of bots)inputs.set(id,botController.input(game,id));
      const result = step(game, inputs);
      for (const seat of seats.values()) if (seat.socket && seat.seq > seat.appliedSeq) {
        seat.appliedSeq = seat.seq;
        send(seat.socket, { type: 'inputAck', seq: seat.seq, appliedTick: game.tick });
      }
      if (game.phase !== previousPhase) clearInputs();
      for (const event of result.events) for (const client of connections.keys()) send(client, { type: 'event', matchId: game.matchId, round: game.round, tick: game.tick, event });
      if (game.phase === 'roundOver' && game.phaseEndsAtTick !== undefined && game.tick >= game.phaseEndsAtTick) {
        pruneDisconnected();
        if (connectedCount() >= 2) { clearInputs(); startNextRound(game); }
      }
      snapshot(undefined, game.tick % 2 !== 0 && game.phase === previousPhase);
    }
  }
  let previousTime = dependencies.now();
  let accumulator = 0;
  const stopLoop = options.manualTicks ? undefined : dependencies.schedule(() => {
    const now = dependencies.now(); accumulator += now - previousTime; previousTime = now;
    const ticks = catchUpSteps(accumulator);
    if (ticks) { advance(ticks); accumulator = accumulator >= 300 ? 0 : accumulator - ticks * 50; }
  }, 10);
  function checkConnections() {
    const now = dependencies.now();
    for (const [ws, c] of connections) if (now - c.lastSeen > 6000) { detach(ws); ws.terminate(); }
    for (const [ip, rate] of joins) if (now - rate.since > 60_000) joins.delete(ip);
  }
  const stopWatchdog = dependencies.schedule(checkConnections, 1000);
  const port = await listenFree(server, options.port ?? Number(process.env.PORT || 3000), options.hostname ?? '0.0.0.0');
  const ip = options.lanAddress || lanAddress();
  controllerUrl = `http://${ip}:${port}/controller`;
  return {
    game, port, hostToken, controllerUrl, hostUrl: `http://${ip}:${port}/display#${hostToken}`, advance, checkConnections,
    async close() {
      stopLoop?.(); stopWatchdog();
      for (const ws of connections.keys()) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      if (vite) await vite.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.env.NODE_ENV !== 'production';
  // Online rooms need the room service. In development, run the in-memory one in this process and proxy /api through this
  // server so one `npm run dev` serves LAN play, the home page and online rooms on the same LAN address. ROOM_API points at another service instead.
  let roomApi = process.env.ROOM_API || undefined;
  let roomService: DevRoomService | undefined;
  if (dev && !roomApi) {
    roomService = createDevRoomService();
    // The same walk-up as the game port: another worktree's room service on 8787 must not stop this one.
    const port = await listenFree(roomService.server, 8787, '127.0.0.1');
    roomApi = `http://127.0.0.1:${port}`;
  }
  const stopRoomService = () => roomService?.close() ?? Promise.resolve();
  let app: Awaited<ReturnType<typeof createGameServer>>;
  try { app = await createGameServer({ dev, ...(roomApi ? { roomApi } : {}) }); } catch (error) { await stopRoomService(); throw error; }
  const online = roomApi ? `\nOnline:    http://${app.hostUrl.split('/display')[0]!.replace(/^http:\/\//, '')}/ (create or join rooms; the room service runs on ${roomApi})` : '';
  console.log(`\nFUSE RIDERS — five phones, one arena\n\nTV / host: ${app.hostUrl}\nPhones:    ${app.controllerUrl}${online}\n\nKeep this laptop awake. Connect the TV with HDMI and join the same Wi-Fi.\n`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await stopRoomService(); await app.close(); process.exit(0); });
}
