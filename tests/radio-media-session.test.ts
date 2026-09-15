import assert from 'node:assert/strict';
import test from 'node:test';
import { RADIO_ALBUM, RADIO_ARTIST, bindMediaSession, radioMediaActions, type MediaAction, type MediaSessionPort, type MediaTrack } from '../src/client/radio-media-session.ts';

const artwork = [{ src: '/radio-artwork.png', sizes: '512x512', type: 'image/png' }];
function fixture(state: { title: string; playing: boolean; position: number; duration?: number } = { title: 'Pixel Sax Parade', playing: true, position: 12, duration: 180 }) {
  const calls: string[] = []; const metadata: MediaTrack[] = []; const positions: (object | undefined)[] = [];
  const handlers = new Map<MediaAction, (() => void) | null>();
  const port: MediaSessionPort = {
    setMetadata: track => { metadata.push(track); calls.push('metadata'); },
    setPlaybackState: value => calls.push(`state:${value}`),
    setActionHandler: (action, handler) => { handlers.set(action, handler); },
    setPositionState: position => { positions.push(position); },
  };
  const listeners = new Set<() => void>(); const actions: string[] = [];
  const binding = bindMediaSession(port, {
    title: () => state.title, playing: () => state.playing, position: () => state.position, duration: () => state.duration,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  }, { play: () => actions.push('play'), pause: () => actions.push('pause'), previous: () => actions.push('previous'), next: () => actions.push('next') }, artwork);
  return { state, calls, metadata, positions, handlers, listeners, actions, binding, emit: () => { for (const listener of listeners) listener(); } };
}

test('binding publishes the track, playback state and position, and only republishes what changed', () => {
  const f = fixture();
  assert.deepEqual(f.metadata, [{ title: 'Pixel Sax Parade', artist: RADIO_ARTIST, album: RADIO_ALBUM, artwork }]);
  assert.deepEqual(f.calls, ['metadata', 'state:playing']);
  assert.deepEqual(f.positions, [{ duration: 180, position: 12, playbackRate: 1 }]);
  f.state.position = 30; f.emit();
  assert.equal(f.metadata.length, 1, 'same track is not republished'); assert.equal(f.calls.length, 2, 'same state is not republished');
  assert.deepEqual(f.positions.at(-1), { duration: 180, position: 30, playbackRate: 1 });
  f.state.title = 'Coin Op Swing'; f.state.playing = false; f.state.position = 200; f.emit();
  assert.equal(f.metadata.at(-1)!.title, 'Coin Op Swing'); assert.equal(f.calls.at(-1), 'state:paused');
  assert.deepEqual(f.positions.at(-1), { duration: 180, position: 180, playbackRate: 1 }, 'position never exceeds the duration');
});

test('an unknown length clears the position once, and a known one publishes it again', () => {
  const f = fixture();
  f.state.duration = undefined; f.emit(); f.emit();
  assert.deepEqual(f.positions.slice(1), [undefined], 'cleared once, not on every refresh');
  f.state.duration = NaN; f.emit(); assert.equal(f.positions.length, 2);
  f.state.duration = 90; f.state.position = 5; f.binding.refresh();
  assert.deepEqual(f.positions.at(-1), { duration: 90, position: 5, playbackRate: 1 });
});

test('media actions drive the radio and re-sync afterwards; unbind removes them', () => {
  const f = fixture();
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack'] as const) f.handlers.get(action)!!();
  assert.deepEqual(f.actions, ['play', 'pause', 'previous', 'next']);
  assert.ok(f.positions.length >= 5, 'each action refreshes the position');
  f.binding.unbind();
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack'] as const) assert.equal(f.handlers.get(action), null, action);
  assert.equal(f.listeners.size, 0, 'unsubscribed from the radio');
});

test('without a media session nothing is bound and refresh is harmless', () => {
  let subscribed = 0;
  const binding = bindMediaSession(undefined, { title: () => 'x', playing: () => true, position: () => 0, duration: () => 1, subscribe: () => { subscribed++; return () => {}; } }, { play() {}, pause() {}, previous() {}, next() {} }, artwork);
  binding.refresh(); binding.unbind();
  assert.equal(subscribed, 0);
});

test('play unmutes and resumes, pause only pauses, and prev/next go to the radio', () => {
  let paused = true; let muted = true; const calls: string[] = [];
  const actions = radioMediaActions(
    { paused: () => paused, togglePause: () => { paused = !paused; calls.push('toggle'); }, previousTrack: () => calls.push('previous'), nextTrack: () => calls.push('next') },
    { muted: () => muted, unmute: () => { muted = false; calls.push('unmute'); } },
    () => calls.push('unlock'),
  );
  actions.play(); assert.deepEqual(calls, ['unmute', 'toggle', 'unlock']); assert.equal(paused, false); assert.equal(muted, false);
  actions.play(); assert.deepEqual(calls.slice(3), ['unlock'], 'play on a playing radio does not toggle it off');
  actions.pause(); actions.pause(); assert.deepEqual(calls.slice(4), ['toggle'], 'a second pause does not start the music again');
  actions.previous(); actions.next(); assert.deepEqual(calls.slice(5), ['previous', 'next']);
});
