import test from "node:test";
import assert from "node:assert/strict";
import {
  createFakeAudioClock,
  createFakeClockedSong,
} from "fuse-ui/game-audio-fake";
import {
  createSongClock,
  LEAD_MS,
  RESTART_MS,
  RESYNC_MS,
  SETTLE_SAMPLES,
} from "../src/app/song-clock.js";

const FRAME_144 = 1000 / 144;

/**
 * A page with a performance clock, an audio context whose clock is read in steps of `step` seconds, a room whose
 * song is at `room` ms when the test starts, and a song clock following it once per frame.
 */
function page(
  options: { step?: number; lag?: number; room?: number; song?: number } = {},
) {
  const step = options.step ?? 0;
  let perf = 4321.5,
    /** The true audio clock, which the page can only read in steps. */
    context = 7.25;
  const roomAtStart = (options.room ?? 0) - perf;
  const clock = createFakeAudioClock({ lag: options.lag ?? 0 });
  const song = createFakeClockedSong(options.song ?? 120, clock);
  const read = () => {
    clock.time = step ? Math.floor(context / step + 1e-9) * step : context;
  };
  read();
  const songClock = createSongClock({ now: () => perf, audio: () => clock });
  const self = {
    clock,
    song,
    songClock,
    get perf() {
      return perf;
    },
    /** Where the room says the song is, ms. */
    room: () => roomAtStart + perf,
    /** The position coming out of the speaker now, ms; undefined when nothing is scheduled. */
    heard: () => {
      const seconds = song.scheduled(context - clock.lag);
      return seconds === undefined ? undefined : seconds * 1000;
    },
    /** Time passes; the audio clock only moves while it runs. */
    pass(ms: number) {
      perf += ms;
      if (clock.running) context += ms / 1000;
      read();
    },
    /** The audio device drops out: the audio clock loses `ms`. */
    glitch(ms: number) {
      context -= ms / 1000;
      read();
    },
    /** One animation frame: time passes, then the game samples and follows the room. */
    frame(ms = FRAME_144, withSong = true) {
      self.pass(ms);
      songClock.sample();
      songClock.follow(self.room(), withSong ? song : undefined);
    },
    frames(count: number, ms = FRAME_144) {
      for (let i = 0; i < count; i++) self.frame(ms);
    },
  };
  return self;
}
const near = (actual: number | undefined, expected: number, within = 1e-6) =>
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) <= within,
    `${actual} is not within ${within} of ${expected}`,
  );

test("with no audio clock the position is the room's, exactly", () => {
  let perf = 100;
  const clock = createFakeAudioClock({ running: false });
  const song = createFakeClockedSong(60, clock);
  const songClock = createSongClock({
    now: () => perf,
    audio: () => undefined,
  });
  assert.equal(songClock.songMs(), 0, "no song is running yet");
  for (const room of [-3000, -2000.5, 0, 12_345.25]) {
    perf += 16;
    songClock.sample();
    songClock.follow(room, song);
    assert.equal(songClock.songMs(), room);
    assert.equal(
      songClock.songMs(perf - 40),
      room - 40,
      "an earlier key press",
    );
    perf += 5;
    assert.equal(
      songClock.songMs(),
      room + 5,
      "carried forward between follows",
    );
  }
  assert.deepEqual([songClock.audible, songClock.drift], [false, 0]);
  assert.equal(song.plays.length, 0);
  songClock.follow(undefined, song);
  assert.equal(songClock.songMs(), 0);
});

test("a clock that is not running yet plays nothing and follows the room", () => {
  const p = page({ room: -5000 });
  p.clock.running = false;
  p.frames(30);
  assert.equal(p.song.plays.length, 0, "the page is not unlocked");
  assert.equal(p.songClock.audible, false);
  near(p.songClock.songMs(), p.room());
  p.clock.running = true;
  p.frames(SETTLE_SAMPLES - 1);
  assert.equal(p.song.plays.length, 0, "the mapping settles first");
  p.frame();
  assert.equal(p.song.plays.length, 1);
  assert.equal(p.songClock.audible, true);
  near(p.heard(), p.room());
});

test("a song started during the countdown is heard from zero when the room reaches zero", () => {
  const p = page({ room: -3000 });
  p.frames(SETTLE_SAMPLES);
  assert.equal(p.song.plays.length, 1);
  const play = p.song.plays[0]!;
  near(play.at, p.clock.now() + LEAD_MS / 1000);
  near(play.offset, p.room() / 1000 + LEAD_MS / 1000);
  assert.ok(
    play.offset < 0,
    "a negative offset: the song waits for the countdown",
  );
  assert.equal(p.songClock.audible, true);
  near(p.songClock.songMs(), p.room());
  assert.ok(p.songClock.songMs() < 0);
  for (let i = 0; i < 600; i++) {
    p.frame();
    near(p.heard(), p.room());
    near(p.songClock.songMs(), p.room());
  }
  assert.ok(p.room() > 1000, "well into the song");
  assert.equal(p.song.plays.length, 1, "one start, no restarts");
  near(p.songClock.drift, 0);
});

test("joining mid-song starts at the room's position", () => {
  const p = page({ room: 45_000 });
  p.frames(SETTLE_SAMPLES);
  near(p.song.plays[0]!.offset, p.room() / 1000 + LEAD_MS / 1000);
  p.frames(200);
  near(p.heard(), p.room());
  near(p.songClock.songMs(), p.room());
  assert.equal(p.song.plays.length, 1);
});

test("output latency is compensated: what is heard, not what is scheduled, matches the room", () => {
  const p = page({ room: 10_000, lag: 0.085 });
  p.frames(SETTLE_SAMPLES);
  near(p.song.plays[0]!.offset, p.room() / 1000 + 0.085 + LEAD_MS / 1000);
  p.frames(300);
  near(p.heard(), p.room());
  near(p.songClock.songMs(), p.room());
  near(p.song.scheduled(p.clock.now())! * 1000, p.room() + 85, 1e-6);
  near(p.songClock.songMs(p.perf - 250), p.room() - 250);
});

for (const [label, frame] of [
  ["144 Hz", FRAME_144],
  ["60 Hz", 1000 / 60],
  ["an uneven 90 Hz", 11.3],
] as const)
  test(`positions stay smooth and true on an audio clock read in 10 ms steps at ${label}`, () => {
    const p = page({ step: 0.01, lag: 0.02, room: -1500 });
    // The game samples from page load, long before a song starts.
    for (let i = 0; i < 40; i++) {
      p.pass(frame);
      p.songClock.sample();
    }
    let last = Number.NEGATIVE_INFINITY,
      worst = 0;
    for (let i = 0; i < 4000; i++) {
      // A late frame now and then.
      p.frame(i % 97 === 96 ? frame * 3.4 : frame);
      const now = p.songClock.songMs();
      assert.ok(now > last, `frame ${i} went back: ${last} then ${now}`);
      last = now;
      worst = Math.max(worst, Math.abs(now - p.heard()!));
    }
    assert.equal(p.songClock.audible, true);
    assert.ok(worst <= 2, `off by ${worst} ms`);
    assert.equal(p.song.plays.length, 1, "no restart");
    assert.ok(Math.abs(p.songClock.drift) <= 2);
    near(p.heard(), p.room(), 2);
  });

test("a late frame does not move the mapping", () => {
  const p = page({ step: 0.003, room: 2000 });
  p.frames(200);
  p.pass(180);
  p.songClock.sample();
  near(p.songClock.songMs(), p.heard()!, 1);
  p.frames(5);
  near(p.songClock.songMs(), p.heard()!, 1);
});

test("a suspended context falls back to the room and resyncs when it returns", () => {
  const p = page({ room: 20_000, lag: 0.03 });
  p.frames(100);
  assert.equal(p.song.plays.length, 1);
  // The tab hides: the context stops, time does not.
  p.clock.running = false;
  p.frame();
  assert.equal(p.songClock.audible, false);
  assert.equal(p.song.playing, false, "the frozen song must not sound later");
  p.pass(5000);
  p.frames(3);
  near(p.songClock.songMs(), p.room());
  assert.equal(p.song.plays.length, 1);
  p.clock.running = true;
  p.frames(SETTLE_SAMPLES);
  assert.equal(p.song.plays.length, 2, "restarted once the clock runs");
  assert.equal(p.songClock.audible, true);
  near(p.heard(), p.room());
  near(p.songClock.songMs(), p.room());
  p.frames(300);
  assert.equal(p.song.plays.length, 2);
  near(p.heard(), p.room());
});

test("a context that lost time unnoticed is restarted, at most once a second", () => {
  const p = page({ room: 20_000 });
  p.frames(SETTLE_SAMPLES);
  assert.equal(p.song.plays.length, 1);
  const started = p.perf;
  // The device stalls for 400 ms while the page keeps running.
  p.glitch(400);
  p.frame();
  assert.ok(p.songClock.drift < -RESYNC_MS, `drift ${p.songClock.drift}`);
  assert.equal(p.song.playing, false, "silent rather than out of step");
  assert.equal(p.songClock.audible, false);
  near(p.songClock.songMs(), p.room());
  while (p.perf - started < RESTART_MS - FRAME_144) {
    p.frame();
    assert.equal(p.song.plays.length, 1, "not within a second of the start");
    near(p.songClock.songMs(), p.room());
  }
  p.frames(2);
  assert.equal(p.song.plays.length, 2);
  near(p.heard(), p.room());
  near(p.songClock.drift, 0);
});

test("a small audio dropout is tracked without a restart", () => {
  const p = page({ step: 0.01, room: 20_000 });
  p.frames(300);
  p.glitch(30);
  p.frames(40);
  assert.equal(p.song.plays.length, 1, "30 ms is not worth a restart");
  near(p.songClock.songMs(), p.heard()!, 2);
  near(p.songClock.drift, -30, 2);
});

test("a changed output latency glides in, and a large one resyncs", () => {
  const p = page({ room: 20_000, lag: 0.02 });
  p.frames(100);
  p.clock.lag = 0.035;
  let last = p.songClock.songMs();
  for (let i = 0; i < 400; i++) {
    p.frame();
    const now = p.songClock.songMs();
    assert.ok(
      now > last && now - last < FRAME_144 + 0.5,
      "no step in the position",
    );
    last = now;
  }
  near(p.songClock.songMs(), p.heard()!, 0.1);
  near(p.songClock.drift, -15, 0.1);
  assert.equal(p.song.plays.length, 1);
  // Bluetooth headphones connect.
  p.clock.lag = 0.26;
  p.frames(200);
  assert.equal(p.song.plays.length, 2);
  near(p.heard(), p.room());
  near(p.songClock.songMs(), p.room());
});

test("switching between the room and the audio clock does not move the position", () => {
  const p = page({ room: -800 });
  p.frames(SETTLE_SAMPLES - 1);
  p.pass(FRAME_144);
  p.songClock.sample();
  const before = p.songClock.songMs();
  assert.equal(p.songClock.audible, false);
  p.songClock.follow(p.room(), p.song);
  assert.equal(p.songClock.audible, true);
  near(p.songClock.songMs(), before);
  p.frames(50);
  const playing = p.songClock.songMs();
  p.clock.running = false;
  p.songClock.sample();
  p.songClock.follow(p.room(), p.song);
  assert.equal(p.songClock.audible, false);
  near(p.songClock.songMs(), playing);
});

test("playback stops when no song is running, and a new song starts at once", () => {
  const p = page({ room: 1000 });
  p.frames(50);
  assert.equal(p.song.playing, true);
  p.songClock.follow(undefined, p.song);
  assert.deepEqual([p.song.playing, p.songClock.audible], [false, false]);
  assert.equal(p.songClock.songMs(), 0);
  p.frame();
  assert.equal(p.song.plays.length, 2, "the next round starts without waiting");
  p.frame(FRAME_144, false);
  assert.equal(p.song.playing, false, "the song went away");
  near(p.songClock.songMs(), p.room());
  const other = createFakeClockedSong(90, p.clock);
  p.pass(FRAME_144);
  p.songClock.sample();
  p.songClock.follow(p.room(), other);
  assert.equal(other.playing, true);
  p.frame();
  assert.deepEqual(
    [other.playing, p.song.playing],
    [false, true],
    "a different song replaces the one playing",
  );
  p.songClock.stop();
  assert.deepEqual([p.song.playing, p.songClock.audible], [false, false]);
});

test("a song that went quiet early is started again; one that ran out is not", () => {
  const p = page({ room: 1000, song: 4 });
  p.frames(50);
  p.song.end();
  p.frames(144);
  assert.equal(p.song.plays.length, 2, "restarted, a second after the start");
  near(p.heard(), p.room());
  while (p.room() < 4200) p.frame();
  p.song.end();
  p.frames(300);
  assert.equal(p.song.plays.length, 2, "the song is over");
  near(p.songClock.songMs(), p.room());

  const late = page({ room: 9000, song: 4 });
  late.frames(300);
  assert.equal(
    late.song.playing,
    false,
    "joined after the end: nothing to hear",
  );
  assert.equal(late.song.plays.length, 1);
  near(late.songClock.songMs(), late.room());
});

test("a tap is placed against a click scheduled on the audio clock", () => {
  const p = page({ step: 0.01, lag: 0.12 });
  p.clock.running = false;
  p.songClock.sample();
  assert.equal(p.songClock.audioTime(), undefined, "no running clock");
  p.clock.running = true;
  for (let i = 0; i < 200; i++) {
    p.pass(FRAME_144);
    p.songClock.sample();
  }
  // A click scheduled 500 ms ahead on the audio clock is heard a latency later.
  const now = p.songClock.audioTime()!,
    click = now + 0.12 + 0.5;
  const tap = p.perf + 500 + 120 + 35;
  near((p.songClock.audioTime(tap)! - click) * 1000, 35, 1e-6);
  p.pass(620);
  p.songClock.sample();
  near((p.songClock.audioTime()! - click) * 1000, 0, 2);
});

// ---- the browser's own clock pair, and the audio offset ----

/**
 * A page whose browser pairs the clocks: the audio clock is read in steps of `step`, the reported latency is
 * `reported`, and the sample really leaving the device is `truly` behind the clock. The pair is taken every
 * `renew` ms, as an audio callback would.
 */
function pairedPage(spec: {
  step?: number;
  reported?: number;
  truly?: number;
  /** How far behind the clock the browser's pair says the output is; `truly` unless the browser does not know. */
  known?: number;
  extra?: () => number;
  pairing?: () => boolean;
}) {
  const step = spec.step ?? 256 / 48000,
    truly = spec.truly ?? 0.176,
    known = spec.known ?? truly;
  let perf = 9000.25,
    context = 3.5,
    paired = perf,
    renewing = true;
  const clock = createFakeAudioClock({ lag: spec.reported ?? 0.168 });
  const song = createFakeClockedSong(120, clock);
  const roomAtStart = -perf;
  const read = () => {
    clock.time = Math.floor(context / step + 1e-9) * step;
    if (renewing && (perf - paired >= 2.5 || clock.pair === undefined)) {
      paired = perf;
      clock.pair = { contextTime: context - known, performanceTime: perf };
    }
  };
  read();
  const songClock = createSongClock({
    now: () => perf,
    audio: () => clock,
    ...(spec.extra ? { extraLatencyMs: spec.extra } : {}),
    ...(spec.pairing ? { pairing: spec.pairing } : {}),
  });
  const self = {
    clock,
    song,
    songClock,
    truly,
    room: () => roomAtStart + perf,
    /** The position truly leaving the device now, ms. */
    heard: () => {
      const seconds = song.scheduled(context - truly);
      return seconds === undefined ? undefined : seconds * 1000;
    },
    frame(ms = FRAME_144) {
      perf += ms;
      context += ms / 1000;
      read();
      songClock.sample();
      songClock.follow(self.room(), song);
    },
    frames(count: number, ms = FRAME_144) {
      for (let i = 0; i < count; i++) self.frame(ms);
    },
    /** The audio thread stops (or resumes) renewing the pair. */
    renew(on: boolean) {
      renewing = on;
    },
    get perf() {
      return perf;
    },
  };
  return self;
}

test("with the browser's clock pair the position is the sample leaving the device, to a hundredth of a ms", () => {
  // Chrome on macOS as measured: 5.3 ms steps, 168 ms reported, the output 176 ms behind the clock.
  const p = pairedPage({});
  p.frames(SETTLE_SAMPLES + 400);
  assert.equal(p.songClock.audible, true);
  const mapping = p.songClock.mapping()!;
  assert.equal(mapping.source, "paired");
  near(mapping.lagMs, 176, 0.5);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    p.frame();
    worst = Math.max(worst, Math.abs(p.songClock.songMs() - p.heard()!));
  }
  assert.ok(worst < 0.01, `the heard position is exact (${worst} ms off)`);
  // And it was started so that what is heard is the room's position, the real latency taken into account.
  near(p.heard(), p.room(), 0.3);
});

test("without the pair the same page reads the stepped clock and the reported latency: 8 ms early here", () => {
  const p = pairedPage({ pairing: () => false });
  p.frames(SETTLE_SAMPLES + 400);
  assert.equal(p.songClock.mapping()!.source, "reported");
  near(p.songClock.mapping()!.lagMs, 168, 0.01);
  // The game believes the position is 8 ms further on than the one leaving the device.
  near(p.songClock.songMs() - p.heard()!, 8, 0.3);
});

test("a pair that is stale, from the future or absurd is not used, and the mapping returns when it is good again", () => {
  const p = pairedPage({});
  p.frames(SETTLE_SAMPLES + 50);
  assert.equal(p.songClock.mapping()!.source, "paired");
  // Zeros are filtered by the audio module; a pair that says the output is ahead of the clock is not a pair.
  for (const bad of [
    { contextTime: p.clock.time + 5, performanceTime: p.perf },
    { contextTime: p.clock.time - 30, performanceTime: p.perf },
    { contextTime: p.clock.time - 0.176, performanceTime: p.perf + 800 },
  ]) {
    p.clock.pair = bad;
    const before = p.songClock.songMs();
    p.songClock.sample();
    near(p.songClock.songMs(), before, 1e-6);
    assert.equal(p.songClock.mapping()!.pairedMs, undefined);
  }
  // A pair that stopped being renewed (the audio thread stalled) is held for a second, then let go.
  p.clock.pair = undefined;
  p.frame();
  p.renew(false);
  p.frames(20);
  assert.equal(p.songClock.mapping()!.source, "paired", "held for a moment");
  p.frames(200);
  assert.equal(p.songClock.mapping()!.source, "reported");
  p.renew(true);
  p.frames(60);
  assert.equal(p.songClock.mapping()!.source, "paired");
  near(p.songClock.songMs(), p.heard()!, 0.5);
});

test("the audio offset is latency the browser does not know of: the song starts earlier and the position follows", () => {
  let extra = 150;
  // Bluetooth the browser underestimates by 150 ms.
  const p = pairedPage({
    truly: 0.176 + 0.15,
    known: 0.176,
    extra: () => extra,
  });
  const frame = () => p.frame();
  for (let i = 0; i < SETTLE_SAMPLES + 300; i++) frame();
  near(p.songClock.mapping()!.lagMs, 326, 0.5);
  // What the player hears is where the room is, and where the game says it is.
  near(p.heard(), p.room(), 1);
  near(p.songClock.songMs(), p.heard()!, 0.5);
  // Turned while playing, the position glides to it without a restart.
  const plays = p.song.plays.length;
  extra = 170;
  for (let i = 0; i < 400; i++) frame();
  near(p.songClock.songMs(), p.heard()! - 20, 0.5);
  assert.equal(p.song.plays.length, plays);
});

test("the schedule, the clock's own time and the count of starts are there for a listener", () => {
  const p = page({ lag: 0.04 });
  assert.equal(p.songClock.scheduledAt(1000), undefined);
  assert.equal(p.songClock.clockTime(p.perf), undefined);
  assert.equal(p.songClock.starts, 0);
  p.frames(SETTLE_SAMPLES + 30);
  assert.equal(p.songClock.starts, 1);
  const { at, offset } = p.song.plays[0]!;
  near(p.songClock.scheduledAt(2500), at + 2.5 - offset, 1e-9);
  // A sample scheduled then is heard one latency later: where the song clock says position 2500 is.
  near(p.songClock.clockTime(p.perf), p.clock.time, 1e-6);
  p.glitch(400);
  p.frames(200);
  assert.equal(p.songClock.starts, 2, "a realignment is a start");
});
