import assert from 'node:assert/strict';
import test from 'node:test';
import { CHIPTUNES, MUSIC_STEPS, musicStep } from '../src/client/music-score.ts';
import { AudioDirector, type AudioChannel, type GameSynth, type SynthNote } from '../src/client/audio-director.ts';
import { addPlayer, createGame, toSnapshot } from '../src/shared/game.ts';
import { beginMatchParticipant } from '../src/shared/match-stats.ts';
import type { GameEvent, ServerMessage } from '../src/shared/protocol.ts';
function fixture() {
  let now = 0; let canUnlock = true; let stops = 0;
  const notes: { channel: AudioChannel; note: SynthNote }[] = [];
  const gains = new Map<AudioChannel, number>();
  const synth: GameSynth = { unlock: async () => canUnlock, note: (channel, note) => notes.push({ channel, note }), gain: (channel, value) => { gains.set(channel, value); }, stop: () => { stops++; } };
  const director = new AudioDirector(synth, () => now);
  const game = createGame('audio'); addPlayer(game, { id: 'p', name: 'P', slot: 0, color: '#ffffff' });
  beginMatchParticipant(game.matchStats, { id: 'p', name: 'P', slot: 0, color: '#ffffff' });
  const snapshot = (tick: number, phase = 'playing' as typeof game.phase): ServerMessage => { game.phase = phase; return { type: 'snapshot', matchId: game.matchId, round: game.round, tick, state: toSnapshot(game) }; };
  const event = (tick: number, event: GameEvent): ServerMessage => ({ type: 'event', matchId: game.matchId, round: game.round, tick, event });
  return { director, notes, gains, game, snapshot, event, setTime: (value: number) => { now = value; }, deny: () => { canUnlock = false; }, stops: () => stops };
}
test('audio requires gesture unlock, routes independent mute and volume, and tolerates refusal', async () => {
  const f = fixture(); f.director.message(f.snapshot(10)); f.director.update(); assert.equal(f.notes.length, 0);
  f.deny(); assert.equal(await f.director.unlock(), false); f.director.update(); assert.equal(f.notes.length, 0);
  f.director.setVolume('music', .6); f.director.setMuted('music', true); assert.equal(f.gains.get('music'), 0);
  f.director.setVolume('music', .8); assert.equal(f.gains.get('music'), 0); f.director.setMuted('music', false); assert.equal(f.gains.get('music'), .8);
  f.director.setVolume('effects', 2); assert.equal(f.gains.get('effects'), 1); f.director.setVolume('effects', -1); assert.equal(f.gains.get('effects'), 0);
  f.director.setVolume('effects', NaN); assert.equal(f.gains.get('effects'), 0);
});
test('original score loops with bounded scheduling and no background catch-up', async () => {
  const f = fixture(); await f.director.unlock(); f.director.message(f.snapshot(10));
  for (let beat = 0; beat < 130; beat++) { f.setTime(beat * 125); f.director.update(); }
  assert.ok(f.notes.length > 200); assert.ok(f.notes.every(n => n.channel === 'music' && Number.isFinite(n.note.frequency)));
  const count = f.notes.length; f.director.update(); assert.equal(f.notes.length, count);
  f.setTime(999999); f.director.update(); assert.ok(f.notes.length <= count + 3);
  f.director.message(f.snapshot(11, 'roundOver')); const end = f.notes.length; f.setTime(9999999); f.director.update(); assert.equal(f.notes.length, end);
});
test('authoritative effects coalesce volleys, reject stale events and baseline reconnects silently', async () => {
  const f = fixture(); await f.director.unlock();
  const launch: GameEvent = { type: 'bombPlaced', bombId: 1, playerId: 'p' };
  f.director.message(f.event(10, launch)); assert.equal(f.notes.length, 0);
  f.director.message(f.snapshot(10)); f.director.message(f.event(10, launch)); assert.equal(f.notes.length, 0);
  for (let id = 0; id < 5; id++) f.director.message(f.event(11, { ...launch, bombId: id })); assert.equal(f.notes.length, 1);
  f.director.message(f.event(11, { type: 'explosion', bombId: 1 }));
  f.director.message(f.event(11, { type: 'playerEliminated', playerId: 'p', cause: 'wall' }));
  f.director.message(f.event(12, { type: 'roundEnded' })); f.director.message(f.event(12, { type: 'matchEnded', winnerId: 'p' }));
  assert.equal(f.notes.length, 9);
  f.director.message(f.snapshot(100)); f.director.message(f.event(90, launch)); assert.equal(f.notes.length, 9);
  f.director.disconnect(); assert.equal(f.stops(), 1); f.director.message(f.snapshot(110)); f.director.message(f.event(110, launch)); assert.equal(f.notes.length, 9);
  f.director.message({ type: 'hostAuthenticated' });
  for (let tick = 111; tick < 220; tick++) f.director.message(f.event(tick, launch));
  assert.equal(f.notes.length, 118);
});
test('pickup cues use authoritative collection events and reconnect baseline stays silent', async () => {
  const f = fixture(); await f.director.unlock(); f.director.message(f.snapshot(10));
  f.director.message(f.event(11, { type: 'pickupCollected', playerId: 'p', pickupId: 1 })); assert.equal(f.notes.length, 3);
  f.director.message(f.event(11, { type: 'pickupCollected', playerId: 'p', pickupId: 2 })); assert.equal(f.notes.length, 3);
  f.director.message(f.snapshot(12)); f.director.message(f.snapshot(11)); assert.equal(f.notes.length, 3);
  f.director.disconnect(); f.director.message(f.snapshot(101));
  f.director.message(f.event(100, { type: 'pickupCollected', playerId: 'p', pickupId: 3 })); assert.equal(f.notes.length, 3);
});

test('engine emits collection once only after a real pickup is consumed', async () => {
  const { startMatch, step, COUNTDOWN_TICKS } = await import('../src/shared/game.ts');
  const f = fixture(); addPlayer(f.game, { id: 'q', name: 'Q', slot: 1, color: '#aaaaaa' });
  startMatch(f.game); for (let i = 0; i < COUNTDOWN_TICKS; i++) step(f.game, new Map());
  const player = f.game.players.get('p')!;
  f.game.pickups = [{ id: 999, type: 'star', x: player.x, y: player.y, expiresAtTick: f.game.tick + 100 }];
  assert.deepEqual(step(f.game, new Map()).events.filter(e => e.type === 'pickupCollected'), [{ type: 'pickupCollected', playerId: 'p', pickupId: 999 }]);
  assert.equal(step(f.game, new Map()).events.filter(e => e.type === 'pickupCollected').length, 0);
});

test('older round snapshots cannot reset scope or stop music', async () => {
  const f = fixture(); await f.director.unlock(); f.game.round = 2; f.director.message(f.snapshot(100));
  f.game.round = 1; f.director.message(f.snapshot(90, 'roundOver'));
  f.director.message(f.event(91, { type: 'bombPlaced', bombId: 1, playerId: 'p' }));
  assert.equal(f.notes.length, 0); f.director.update(); assert.ok(f.notes.some(n => n.channel === 'music'));
});


test('six original scores have long arrangements, distinct melodies and bounded valid voices', () => {
  assert.equal(CHIPTUNES.length, 6);
  assert.equal(new Set(CHIPTUNES.map(track => track.title)).size, 6);
  assert.equal(new Set(CHIPTUNES.map(track => JSON.stringify(track.hook))).size, 6);
  for (const track of CHIPTUNES) {
    assert.ok(MUSIC_STEPS * track.stepMs >= 55000);
    const sections = new Set<string>();
    for (let section = 0; section < 8; section++) {
      const notes = Array.from({ length: 64 }, (_, beat) => musicStep(track, section * 64 + beat));
      sections.add(JSON.stringify(notes));
      for (const voices of notes) {
        assert.ok(voices.length <= 4);
        for (const note of voices) {
          assert.ok(Number.isFinite(note.frequency) && note.frequency > 0);
          assert.ok(note.duration > 0 && note.duration <= track.stepMs / 1000 * 1.4);
          assert.ok(note.level > 0 && note.level <= .5);
        }
      }
    }
    assert.ok(sections.size >= 6, `${track.title} should have distinct arrangements`);
    assert.deepEqual(musicStep(track, MUSIC_STEPS), musicStep(track, 0));
  }
});

test('playlist completes an arrangement, rotates all six tunes and retains mute and volume', async () => {
  const f = fixture(); await f.director.unlock(); f.director.message(f.snapshot(1));
  f.director.setVolume('music', .17); f.director.setMuted('music', true);
  assert.equal(f.director.trackTitle, CHIPTUNES[0]!.title);
  for (let beat = 0; beat < MUSIC_STEPS; beat++) { f.setTime(beat * CHIPTUNES[0]!.stepMs); f.director.update(); }
  assert.equal(f.director.trackTitle, CHIPTUNES[0]!.title);
  f.setTime(MUSIC_STEPS * CHIPTUNES[0]!.stepMs); f.director.update();
  assert.equal(f.director.trackTitle, CHIPTUNES[1]!.title);
  for (let index = 2; index <= 6; index++) {
    f.director.nextTrack(); assert.equal(f.director.trackTitle, CHIPTUNES[index % 6]!.title);
    assert.equal(f.gains.get('music'), 0);
  }
  f.director.setMuted('music', false); assert.equal(f.gains.get('music'), .17);
});

test('new rounds advance playlist once; repeated snapshots and reconnects do not rewind it', async () => {
  const f = fixture(); await f.director.unlock(); f.director.message(f.snapshot(1));
  const first = f.director.trackTitle;
  f.director.message(f.snapshot(2)); assert.equal(f.director.trackTitle, first);
  f.director.message(f.snapshot(3, 'roundOver')); assert.equal(f.director.trackTitle, first);
  f.game.round++; f.director.message(f.snapshot(4, 'countdown'));
  assert.equal(f.director.trackTitle, CHIPTUNES[1]!.title);
  f.director.message(f.snapshot(5)); assert.equal(f.director.trackTitle, CHIPTUNES[1]!.title);
  f.director.disconnect(); f.director.message(f.snapshot(6)); assert.equal(f.director.trackTitle, CHIPTUNES[1]!.title);
  f.game.round++; f.director.message(f.snapshot(7)); assert.equal(f.director.trackTitle, CHIPTUNES[2]!.title);
});
