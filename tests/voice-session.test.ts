import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VoiceSession,
  readVoiceState,
  type VoiceTrack,
  type VoiceSender,
} from "../src/online/voice-session.js";
class Track implements VoiceTrack {
  enabled = true;
  readyState = "live";
  stopped = 0;
  private listeners = new Set<() => void>();
  stop(): void {
    this.enabled = false;
    this.readyState = "ended";
    ++this.stopped;
  }
  addEventListener(_type: "ended", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "ended", listener: () => void): void {
    this.listeners.delete(listener);
  }
  unplug(): void {
    this.readyState = "ended";
    for (const listener of this.listeners) listener();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Sender implements VoiceSender<Track> {
  tracks: Array<Track | null> = [];
  async replaceTrack(track: Track | null): Promise<void> {
    this.tracks.push(track);
  }
}
test("voice is opt-in; mute/deafen stop outgoing samples without changing sender identity", async () => {
  const track = new Track();
  let captures = 0;
  const session = new VoiceSession(
    async () => {
      ++captures;
      return track;
    },
    () => {},
  );
  const sender = new Sender();
  session.addSender(sender, () => assert.fail("unexpected sender error"));
  assert.equal(session.state, "off");
  session.listen();
  assert.equal(captures, 0);
  assert.equal(session.state, "muted");
  await session.microphone();
  assert.equal(session.state, "live");
  assert.equal(track.enabled, true);
  session.setMuted(true);
  assert.equal(track.enabled, false);
  assert.equal(session.state, "muted");
  session.setDeafened(true);
  session.setDeafened(false);
  assert.equal(track.enabled, false, "deafen preserves explicit mute");
  session.setMuted(false);
  session.setDeafened(true);
  assert.equal(track.enabled, false);
  session.setDeafened(false);
  assert.equal(track.enabled, true);
  session.leave();
  assert.equal(track.stopped, 1);
  assert.equal(session.state, "off");
  await Promise.resolve();
  assert.equal(sender.tracks.at(-1), null);
});
test("late permission grants after leave, cancellation or terminal close release the device", async () => {
  for (const cancel of ["leave", "mute", "close"] as const) {
    const permission = deferred<Track>(),
      track = new Track();
    const session = new VoiceSession(
      () => permission.promise,
      () => {},
    );
    const opening = session.microphone();
    if (cancel === "mute") session.setMuted(true);
    else session[cancel]();
    permission.resolve(track);
    await opening;
    assert.equal(track.stopped, 1);
    assert.equal(session.track, undefined);
    assert.equal(session.pending, false);
    assert.notEqual(session.state, "live");
  }
});
test("a newer microphone selection wins out-of-order capture results and preserves mute", async () => {
  const first = deferred<Track>(),
    second = deferred<Track>(),
    a = new Track(),
    b = new Track();
  const session = new VoiceSession(
    (device) => (device === "a" ? first.promise : second.promise),
    () => {},
  );
  const old = session.microphone("a"),
    latest = session.microphone("b", true);
  second.resolve(b);
  await latest;
  first.resolve(a);
  await old;
  assert.equal(session.track, b);
  assert.equal(session.deviceId, "b");
  assert.equal(a.stopped, 1);
  assert.equal(b.enabled, false);
});
test("failed microphone selection keeps a healthy old track; unplug is explicitly muted and retryable", async () => {
  const first = new Track(),
    second = new Track();
  const session = new VoiceSession(
    async (device) => {
      if (device === "bad") throw new Error("missing");
      return device === "second" ? second : first;
    },
    () => {},
  );
  await session.microphone();
  await session.microphone("bad", true);
  assert.equal(session.track, first);
  assert.equal(first.enabled, true);
  assert.match(session.error, /unavailable/);
  first.unplug();
  assert.equal(session.state, "muted");
  assert.equal(session.track, undefined);
  assert.match(session.error, /disconnected/);
  await session.microphone("second");
  assert.equal(session.state, "live");
  assert.equal(session.error, "");
});
test("permission denial leaves listen-only available and terminal close cannot reopen capture", async () => {
  let calls = 0;
  const session = new VoiceSession<Track>(
    async () => {
      ++calls;
      throw Object.assign(new Error(), { name: "NotAllowedError" });
    },
    () => {},
  );
  await session.microphone();
  assert.equal(session.joined, true);
  assert.equal(session.state, "muted");
  assert.match(session.error, /permission denied/);
  session.close();
  session.listen();
  await session.microphone();
  session.setMuted(false);
  session.setDeafened(true);
  assert.equal(calls, 1);
  assert.equal(session.state, "off");
  assert.equal(session.deafened, false);
});
test("pending sender replacement coalesces leave; replacing a peer reattaches the current track", async () => {
  const track = new Track(),
    pending = deferred<void>(),
    calls: Array<Track | null> = [];
  const session = new VoiceSession(
    async () => track,
    () => {},
  );
  await session.microphone();
  const detach = session.addSender(
    {
      replaceTrack: async (next) => {
        calls.push(next);
        if (next) await pending.promise;
      },
    },
    () => assert.fail(),
  );
  session.leave();
  pending.resolve();
  await pending.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [track, null]);
  detach();
  const newTrack = new Track(),
    nextSession = new VoiceSession(
      async () => newTrack,
      () => {},
    );
  await nextSession.microphone();
  const old = new Sender(),
    replacement = new Sender();
  const remove = nextSession.addSender(old, () => assert.fail());
  remove();
  nextSession.addSender(replacement, () => assert.fail());
  assert.equal(replacement.tracks[0], newTrack);
  nextSession.close();
  await Promise.resolve();
  assert.equal(replacement.tracks.at(-1), null);
});
test("one broken sender cannot stop capture or other peers; retired failures are ignored", async () => {
  const track = new Track(),
    pending = deferred<void>();
  let errors = 0;
  const session = new VoiceSession(
    async () => track,
    () => {},
  );
  await session.microphone();
  session.addSender(
    {
      replaceTrack: async () => {
        throw new Error("closed");
      },
    },
    () => ++errors,
  );
  const remove = session.addSender(
    { replaceTrack: () => pending.promise },
    () => ++errors,
  );
  remove();
  const healthy = new Sender();
  session.addSender(healthy, () => assert.fail());
  pending.reject(new Error("retired"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors, 1);
  assert.equal(healthy.tracks[0], track);
  assert.equal(session.state, "live");
});
test("voice metadata accepts only known versioned states", () => {
  for (const state of ["off", "muted", "live"])
    assert.equal(readVoiceState({ type: "voice", version: 1, state }), state);
  for (const raw of [
    null,
    true,
    [],
    {},
    { type: "voice", version: 2, state: "live" },
    { type: "voice", version: 1, state: "speaking" },
    { type: "other", version: 1, state: "live" },
  ])
    assert.equal(readVoiceState(raw), undefined);
});
