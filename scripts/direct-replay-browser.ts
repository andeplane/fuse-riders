import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { addPlayer, createGame, SLOT_COLORS, startMatch, step } from '../src/shared/game.js';
import { defaultRoomSettings } from '../src/shared/room-settings.js';
import { BotController } from '../src/shared/bot-controller.js';
import { canonical, replayHash, type AimTuple } from '../src/shared/action-log.js';
import { stepDirect, type DirectAction, type DirectState } from '../src/shared/direct-input.js';
import { packBootstrap } from '../src/online/rollback-world.js';
import { packMessage } from '../src/online/action-replication.js';
import type { DirectPacket } from '../src/online/direct-stream.js';

function fixture(seed: number) {
  const game = createGame(`direct-browser-${seed}`, seed); game.settings = defaultRoomSettings();
  for (let slot = 0; slot < 5; slot++) addPlayer(game, { id: `p${slot}`, name: `Player ${slot}`, slot, color: SLOT_COLORS[slot] });
  startMatch(game); for (let t = 0; t < 65; t++) step(game, new Map());
  const players = [...game.players.values()];
  // Explicit synthetic stress fixture: keep five riders alive for every measured tick.
  for (const p of players) p.invulnerableUntilTick = 10_000;
  players[0].gunArmed = true; players[1].shellArmed = true; players[2].targetBombArmed = true;
  players[3].tripleShotArmed = true; players[4].fiveShotArmed = true;
  game.portalPair = { id: 'direct-fixture-portals', gates: [{ x: 300, y: 300, halfLength: 45 }, { x: 900, y: 500, halfLength: 45 }], expiresAtTick: 10_000 };
  const state: DirectState = { game, held: new Map(), gestures: new Map() };
  const initial = [...packBootstrap(7, state, players.map(p => [p.slot, 0]))];
  const bot = new BotController(), sequences = [0, 0, 0, 0, 0];
  const blocks: { tick: number; packets: { slot: number; bytes: number[] }[]; finality: unknown; hash: string }[] = [];
  const pending = new Map<number, DirectAction[]>(); const eventCounts: Record<string, number> = {};
  let recordBytes = 0, activeTicks = 0, maxTrails = 0;
  for (let t = 0; t < 600; t++) {
    const tick = game.tick + 1, bySlot = new Map<number, DirectAction[]>();
    for (const player of game.players.values()) {
      const slot = player.slot, input = bot.input(game, player.id), actions: DirectAction[] = [];
      const flags = Number(input.left) | Number(input.right) << 1;
      const aim: AimTuple = input.aim ? [input.aim.x === 0 ? 0 : input.aim.x, input.aim.y === 0 ? 0 : input.aim.y] : null;
      const previous = state.held.get(slot);
      if (flags !== ((previous?.flags ?? 0) & 3)) actions.push([++sequences[slot], tick, 0, flags]);
      if (canonical(aim) !== canonical(previous?.aim ?? null)) actions.push([++sequences[slot], tick, 4, aim]);
      for (const command of input.bombCommands ?? []) {
        const gesture = state.gestures.get(slot);
        if (command.action === 'press') actions.push([++sequences[slot], tick, 1, (gesture?.latest ?? 0) + 1]);
        else if (gesture?.active) actions.push(command.action === 'release' ? [++sequences[slot], tick, 2, gesture.active, aim] : [++sequences[slot], tick, 3, gesture.active]);
      }
      bySlot.set(slot, actions); pending.set(slot, [...(pending.get(slot) ?? []), ...actions]);
      for (const action of actions) recordBytes += packMessage(action).byteLength;
    }
    for (const event of stepDirect(state, bySlot)) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    if (game.phase === 'playing' && [...game.players.values()].every(p => p.alive)) activeTicks++;
    maxTrails = Math.max(maxTrails, ...[...game.players.values()].map(p => p.trail.length));
    if ((t + 1) % 10 === 0) {
      const packets: { slot: number; bytes: number[] }[] = [];
      for (let slot = 0; slot < 5; slot++) {
        const records = pending.get(slot) ?? [];
        do {
          const message: DirectPacket = [1, 7, slot, records.splice(0, 4), [tick, sequences[slot]]];
          packets.push({ slot, bytes: [...packMessage(message)] });
        } while (records.length);
      }
      const hash = replayHash(state);
      blocks.push({ tick, packets, finality: [1, 7, 'final', tick, sequences.map((seq, slot) => [slot, seq]), hash], hash });
      pending.clear();
    }
  }
  assert.equal(activeTicks, 600);
  return { initial, blocks, summary: { seed, activeTicks, maxTrails, recordBytes, eventCounts } };
}

await mkdir('artifacts', { recursive: true });
const fixtures = [17, 42, 901].map(fixture);
const bundle = await build({ stdin: { contents: `
import { RollbackWorld } from './src/online/rollback-world.ts';
import { replayHash } from './src/shared/action-log.ts';
globalThis.runDirectReplay = fixture => {
  const world = RollbackWorld.open(new Uint8Array(fixture.initial), 7);
  if (!world) return {error:'bootstrap'};
  const advanceMs=[], receiveMs=[], rollbackMs=[], retainedBytes=[]; let rollbackCount=0, events=0;
  for (const [index, block] of fixture.blocks.entries()) {
    while (world.state.game.tick < block.tick) {
      const start=performance.now(), r=world.advance(block.tick); advanceMs.push(performance.now()-start);
      if(r.status!=='accepted')return {error:'advance '+r.status,index};
    }
    if(world.finalize(block.finality).status!=='waiting')return {error:'premature finality',index};
    const packets=index%2?[...block.packets].reverse():block.packets;
    for (const packet of packets) {
      const start=performance.now(), r=world.receive(packet.slot,new Uint8Array(packet.bytes),block.tick), elapsed=performance.now()-start;
      receiveMs.push(elapsed); if(r.rollbackTicks){rollbackCount++;rollbackMs.push(elapsed);} events+=r.events.length;
      if(r.status!=='accepted')return {error:'receive '+r.status,index};
    }
    if(world.finalizedTick!==block.tick||replayHash(world.state)!==block.hash)return {error:'divergence',index,tick:block.tick};
    if(world.finalize(block.finality).events.length)return {error:'duplicate effects',index};
    retainedBytes.push(world.retainedBytes);
  }
  return {ticks:fixture.summary.activeTicks,rollbackCount,events,advanceMs,receiveMs,rollbackMs,retainedBytes};
};`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Direct action rollback verification</title>'); });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const results: Record<string, Record<string, unknown>[]> = {};
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) };
}
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${address.port}`); await page.addScriptTag({ content: bundle.outputFiles[0].text }); results[name] = [];
      for (const trace of fixtures) {
        const result = await page.evaluate(data => (globalThis as unknown as { runDirectReplay: (v: unknown) => Record<string, unknown> }).runDirectReplay(data), trace);
        results[name].push(result);
        console.log(name, trace.summary.seed, result.error ?? { ticks: result.ticks, rollback: distribution(result.rollbackMs as number[]), retained: distribution(result.retainedBytes as number[]) });
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise<void>(resolve => server.close(() => resolve())); }
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).length > 0,
  method: 'Three 600-tick five-active-bot traces with fixture invulnerability, weapon/portal state and actual MessagePack. Browser world advances ten ticks before reversed/delayed actions and earlier finality arrive. Exact Node-generated whole-world hash checked at every 10-tick finality. Desktop headless CPU timings, no renderer or RTC and no physical-phone/network claims.',
  fixtures: fixtures.map(f => f.summary), results };
await writeFile('artifacts/direct-replay-browser.json', JSON.stringify(report, null, 2) + '\n');
assert.ok(Object.values(results).flat().every(result => !result.error), 'Direct rollback must match every finalized state');
