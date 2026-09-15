import { BotController } from '../../src/shared/bot-controller.js';
import { applyTick, BOT_NAMES, createRoomState, freeSlot, hashRoomState, type StreamEntries } from '../../src/shared/apply-tick.ts';
import { ACTION, AIM, BOT, CANCEL, JOIN, PRESS, RELEASE, STEER, type Entry } from '../../src/shared/input-log.ts';
import { defaultRoomSettings } from '../../src/shared/room-settings.js';

/** Seeded five-rider recording: two scripted humans plus three AI riders, rematching whenever a match ends. */
export interface Recording { matchId: string; creator: string; ticks: number; entries: Record<string, Entry[]> }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000; };
}

export function makeRecording(seed: number, ticks: number): Recording {
  const random = mulberry32(seed), creator = 'creator', players = [creator, 'rider'];
  const entries: Record<string, Entry[]> = { creator: [], rider: [] };
  const seqs: Record<string, number> = { creator: 0, rider: 0 };
  const log = (member: string, tick: number, ...body: unknown[]) => { entries[member]!.push([++seqs[member]!, tick, ...body] as Entry); };
  const state = createRoomState('replay', defaultRoomSettings()), bots = new BotController();
  const gestures: Record<string, { active: number; latest: number }> = { creator: { active: 0, latest: 0 }, rider: { active: 0, latest: 0 } };
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === 1) { log(creator, tick, JOIN, creator, 'Creator', 0, 'robot', 1); log(creator, tick, JOIN, 'rider', 'Rider', 1, 'fox', 1); }
    if (tick === 2) for (let index = 0; index < 3; index++) { const slot = freeSlot(state.game) + index; log(creator, tick, BOT, 'add', `bot:${index + 1}`, `AI ${BOT_NAMES[slot]}`, slot); }
    if (tick === 3) log(creator, tick, ACTION, 'start', `match-${tick}`);
    if (state.game.phase === 'matchOver' && state.game.tick >= (state.game.phaseEndsAtTick ?? 0)) log(creator, tick, ACTION, 'rematch', `match-${tick}`);
    for (const member of players) {
      const gesture = gestures[member]!;
      if (random() < .12) log(member, tick, STEER, Math.floor(random() * 4));
      if (random() < .05) log(member, tick, AIM, Math.floor(random() * 65536), Math.floor(random() * 65536));
      if (!gesture.active && random() < .04) { gesture.active = ++gesture.latest; log(member, tick, PRESS, gesture.active); }
      else if (gesture.active && random() < .08) { const aimed = random() < .5; log(member, tick, RELEASE, gesture.active, ...(aimed ? [Math.floor(random() * 65536), Math.floor(random() * 65536)] : [])); gesture.active = 0; }
      else if (gesture.active && random() < .01) { log(member, tick, CANCEL, gesture.active); gesture.active = 0; }
    }
    applyTick(state, creator, streamsAt(entries, tick), bots);
  }
  return { matchId: 'replay', creator, ticks, entries };
}

function streamsAt(entries: Record<string, readonly Entry[]>, tick: number): Map<string, StreamEntries> {
  return new Map(Object.entries(entries).map(([member, list]) => [member, { generation: 1, entries: list.filter(entry => entry[1] === tick) }]));
}

/** One hash per tick. Any engine that disagrees with another on any tick has diverged. */
export function replayHashes(recording: Recording): string[] {
  const state = createRoomState(recording.matchId, defaultRoomSettings()), bots = new BotController(), hashes: string[] = [];
  for (let tick = 1; tick <= recording.ticks; tick++) { applyTick(state, recording.creator, streamsAt(recording.entries, tick), bots); hashes.push(hashRoomState(state)); }
  return hashes;
}
