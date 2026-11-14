import test from "node:test";
import assert from "node:assert/strict";
import {
  DUCK_LEVEL,
  FADE_TICK_MS,
  MUSIC_LEVEL,
  MUSIC_TRACKS,
  Music,
  parseMusicManifest,
  resolveTrack,
  sceneTrack,
  type MusicDeps,
  type MusicElement,
  type MusicResponse,
  type MusicTrack,
} from "../src/app/music.js";

/** A media element that only writes down what was asked of it; the real one is a browser's. */
class FakeElement implements MusicElement {
  volume = 1;
  loop = false;
  currentTime = 0;
  paused = true;
  plays = 0;
  pauses = 0;
  constructor(readonly src: string) {}
  play(): Promise<void> {
    this.plays += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.pauses += 1;
    this.paused = true;
  }
}

interface Rig {
  readonly deps: MusicDeps;
  readonly elements: Map<string, FakeElement>;
  /** Every URL fetched, so a muted page can be shown to ask for nothing. */
  readonly fetched: string[];
  /** Runs the fade timer `steps` times, as the browser's would. */
  tick(steps?: number): void;
  /** Moves the fake clock on, in seconds. */
  wait(seconds: number): void;
  settle(): Promise<void>;
}

function rig(
  files: readonly string[],
  manifest: { ok?: boolean; body?: unknown; throws?: boolean } = {},
): Rig {
  const elements = new Map<string, FakeElement>();
  const fetched: string[] = [];
  const timers: (() => void)[] = [];
  let now = 0;
  const response: MusicResponse = {
    ok: manifest.ok ?? true,
    json: () => Promise.resolve(manifest.body ?? { files }),
  };
  const deps: MusicDeps = {
    url: "/killer-fuse/audio/music/",
    fetch: (url) => {
      fetched.push(url);
      return manifest.throws
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(response);
    },
    element: (src) => {
      const made = new FakeElement(src);
      elements.set(src, made);
      return made;
    },
    repeat: (ms, run) => {
      assert.equal(ms, FADE_TICK_MS);
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    now: () => now,
  };
  return {
    deps,
    elements,
    fetched,
    tick: (steps = 1) => {
      for (let i = 0; i < steps; i += 1) for (const run of [...timers]) run();
    },
    wait: (seconds) => {
      now += seconds;
    },
    // The manifest arrives on a promise; two turns of the microtask queue is enough for fetch then json.
    settle: async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const file = (track: MusicTrack): string => `${track}.mp3`;

test("the manifest names the files that are there, and ignores everything else", () => {
  const found = parseMusicManifest({
    files: [
      "lobby.mp3",
      "match-day.ogg",
      "MATCH-DUSK.MP3",
      "victory.wav",
      "boss-fight.mp3",
      "../secret.mp3",
      "nested/defeat.mp3",
      42,
      "lobby.ogg",
    ],
  });
  assert.deepEqual(
    [...found],
    [
      ["lobby", "lobby.mp3"],
      ["match-day", "match-day.ogg"],
    ],
    "unknown names, unplayable formats, paths and repeats are left out; the case must match",
  );
});

test("a manifest that is missing, empty or nonsense leaves the game with no music", () => {
  for (const raw of [null, undefined, 42, "files", {}, { files: "lobby.mp3" }])
    assert.equal(
      parseMusicManifest(raw).size,
      0,
      JSON.stringify(raw) ?? "none",
    );
});

test("the three maps may share one match track, and nothing else falls back", () => {
  const only = new Set<MusicTrack>(["match-day"]);
  assert.equal(resolveTrack("match-dusk", only), "match-day");
  assert.equal(resolveTrack("match-night", only), "match-day");
  assert.equal(resolveTrack("lobby", only), null);
  assert.equal(resolveTrack("victory", only), null);
  assert.equal(resolveTrack("match-day", only), "match-day");
  assert.equal(resolveTrack(null, only), null);
  assert.equal(resolveTrack("match-dusk", new Set(MUSIC_TRACKS)), "match-dusk");
});

test("the moment picks the track: the lobby, the map being played, then the set's ending", () => {
  assert.equal(
    sceneTrack({ stage: "lobby", mapId: 1, outcome: undefined }),
    "lobby",
  );
  assert.equal(
    sceneTrack({ stage: "running", mapId: 1, outcome: undefined }),
    "match-day",
  );
  assert.equal(
    sceneTrack({ stage: "between", mapId: 2, outcome: undefined }),
    "match-dusk",
  );
  assert.equal(
    sceneTrack({ stage: "running", mapId: 3, outcome: undefined }),
    "match-night",
  );
  assert.equal(
    sceneTrack({ stage: "running", mapId: undefined, outcome: undefined }),
    "lobby",
    "a game with no world yet is still the lobby's music",
  );
  assert.equal(
    sceneTrack({ stage: "over", mapId: 3, outcome: "won" }),
    "victory",
  );
  assert.equal(
    sceneTrack({ stage: "over", mapId: 3, outcome: "lost" }),
    "defeat",
  );
  assert.equal(
    sceneTrack({ stage: "over", mapId: 3, outcome: undefined }),
    "victory",
    "a watcher hears the winner's track",
  );
});

test("with no files there is no track, and the manifest is asked for exactly once", async (t) => {
  const bench = rig([]);
  const music = new Music(bench.deps, { muted: false, on: true });
  music.unlock();
  music.want("lobby");
  await bench.settle();
  music.want("match-day");
  music.want("lobby");
  await bench.settle();
  assert.deepEqual(bench.fetched, ["/killer-fuse/audio/music/manifest.json"]);
  assert.equal(music.playing, null);
  assert.equal(bench.elements.size, 0, "no file, no request for one");
  await t.test("and a manifest that fails to load is no louder", async () => {
    const broken = rig([], { throws: true });
    const quiet = new Music(broken.deps, { muted: false, on: true });
    quiet.unlock();
    quiet.want("lobby");
    await broken.settle();
    assert.equal(quiet.playing, null);
  });
  await t.test("nor is one the server will not serve", async () => {
    const missing = rig([], { ok: false });
    const quiet = new Music(missing.deps, { muted: false, on: true });
    quiet.unlock();
    quiet.want("lobby");
    await missing.settle();
    assert.equal(quiet.playing, null);
  });
});

test("nothing plays and nothing is fetched before the autoplay unlock", async () => {
  const bench = rig([file("lobby")]);
  const music = new Music(bench.deps, { muted: false, on: true });
  music.want("lobby");
  await bench.settle();
  assert.deepEqual(
    bench.fetched,
    [],
    "a page nobody has touched asks for nothing",
  );
  assert.equal(music.playing, null);
  music.unlock();
  await bench.settle();
  assert.equal(music.playing, "lobby");
  const element = bench.elements.get("/killer-fuse/audio/music/lobby.mp3");
  assert.ok(element);
  assert.equal(element.plays, 1);
  assert.equal(element.loop, true, "the lobby track loops");
});

test("a muted page downloads no music, and unmuting starts it", async () => {
  const bench = rig([file("lobby")]);
  const music = new Music(bench.deps, { muted: true, on: true });
  music.unlock();
  music.want("lobby");
  await bench.settle();
  assert.deepEqual(bench.fetched, []);
  assert.equal(music.playing, null);
  music.setMuted(false);
  await bench.settle();
  assert.equal(music.playing, "lobby");
  music.setMuted(true);
  const element = bench.elements.get("/killer-fuse/audio/music/lobby.mp3");
  assert.equal(
    element?.paused,
    true,
    "silence pauses rather than plays at nothing",
  );
  assert.equal(music.playing, null);
});

test("the music toggle silences the music on its own, with the effects left alone", async () => {
  const bench = rig([file("lobby")]);
  const music = new Music(bench.deps, { muted: false, on: false });
  music.unlock();
  music.want("lobby");
  await bench.settle();
  assert.deepEqual(bench.fetched, []);
  music.setOn(true);
  await bench.settle();
  assert.equal(music.playing, "lobby");
  music.setOn(false);
  assert.equal(music.playing, null);
});

test("one track fades out as the next fades in, and only the new one is left playing", async () => {
  const bench = rig([file("lobby"), file("match-day")]);
  const music = new Music(bench.deps, { muted: false, on: true });
  music.unlock();
  music.want("lobby");
  await bench.settle();
  const lobby = bench.elements.get("/killer-fuse/audio/music/lobby.mp3")!;
  bench.tick(200);
  assert.equal(lobby.volume, MUSIC_LEVEL, "the first track comes up to full");
  music.want("match-day");
  await bench.settle();
  const match = bench.elements.get("/killer-fuse/audio/music/match-day.mp3")!;
  assert.equal(music.playing, "match-day");
  bench.tick(2);
  assert.ok(
    lobby.volume > 0 && lobby.volume < MUSIC_LEVEL,
    "the old one is on its way down",
  );
  assert.ok(
    match.volume > 0 && match.volume < MUSIC_LEVEL,
    "the new one is on its way up",
  );
  assert.equal(lobby.paused, false, "both sound during the crossfade");
  bench.tick(200);
  assert.equal(match.volume, MUSIC_LEVEL);
  assert.equal(lobby.volume, 0);
  assert.equal(
    lobby.paused,
    true,
    "a faded-out track stops rather than runs silently",
  );
});

test("a loud effect ducks the music, and it comes back on its own", async () => {
  const bench = rig([file("match-day")]);
  const music = new Music(bench.deps, { muted: false, on: true });
  music.unlock();
  music.want("match-day");
  await bench.settle();
  const match = bench.elements.get("/killer-fuse/audio/music/match-day.mp3")!;
  bench.tick(200);
  assert.equal(match.volume, MUSIC_LEVEL);
  music.duck();
  bench.tick(200);
  assert.ok(
    Math.abs(match.volume - MUSIC_LEVEL * DUCK_LEVEL) < 1e-9,
    `ducked to ${match.volume}`,
  );
  bench.wait(2);
  bench.tick(200);
  assert.equal(match.volume, MUSIC_LEVEL, "the duck wears off");
});

test("a win sting plays once and does not loop", async () => {
  const bench = rig([file("victory"), file("defeat")]);
  const music = new Music(bench.deps, { muted: false, on: true });
  music.unlock();
  music.show({ stage: "over", mapId: 1, outcome: "lost" });
  await bench.settle();
  assert.equal(music.playing, "defeat");
  const defeat = bench.elements.get("/killer-fuse/audio/music/defeat.mp3")!;
  assert.equal(defeat.loop, false);
});

test("destroying the music stops every track and starts no more", async () => {
  const bench = rig([file("lobby")]);
  const music = new Music(bench.deps, { muted: false, on: true });
  music.unlock();
  music.want("lobby");
  await bench.settle();
  const lobby = bench.elements.get("/killer-fuse/audio/music/lobby.mp3")!;
  music.destroy();
  assert.equal(lobby.paused, true);
  assert.equal(music.playing, null);
  music.want("match-day");
  bench.tick(5);
  assert.equal(music.playing, null);
});
