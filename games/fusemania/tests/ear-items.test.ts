import test from "node:test";
import assert from "node:assert/strict";
import { createAudioRig } from "fuse-ui/game-audio-fake";
import { SHAPE_EASE, createGameAudio } from "fuse-ui/game-audio";
import {
  ATTACK_LEAD_MS,
  BATTLE_MODE,
  DRUNK,
  FADE,
  FADE_EXTRA_MS,
  ITEM_HINTS,
  ITEM_KINDS,
  ITEM_MS,
  ITEM_NAMES,
  PINGPONG,
  SHIELD,
  USE,
  cloneWorld,
  createWorld,
  decodeWorld,
  encodeWorld,
  hitsOne,
  isAttack,
  stepWorld,
  type Effect,
  type World,
} from "../src/engine/index.js";
import {
  FADE_EASE_MS,
  FADE_FLOOR,
  PINGPONG_REACH,
  songShape,
} from "../src/app/song-fx.js";
import { testLibrary } from "./fixtures/songs.js";

const library = testLibrary();

function battle(riders: number, seed: number, bots: readonly number[] = []) {
  const made = createWorld(
    library,
    "grid",
    BATTLE_MODE,
    seed,
    Array.from({ length: riders }, (_, index) => ({
      id: `p${index}`,
      bot: bots.includes(index),
      chart: 0,
    })),
    1000,
  );
  assert.ok(made);
  while (made.ms < 1000) stepWorld(library, made, []);
  return made;
}
/** Slot 0 throws `item`; returns who is under it afterwards. */
function thrown(state: World, item: number): number[] {
  state.players[0]!.item = item;
  stepWorld(library, state, [{ slot: 0, code: USE, ms: state.ms }]);
  return state.players.flatMap((player, slot) =>
    player.effects.some((effect) => effect[0] === item) ? [slot] : [],
  );
}

test("fade and ping-pong are attacks with a name, a hint and a length", () => {
  for (const kind of [FADE, PINGPONG]) {
    assert.ok(kind < ITEM_KINDS);
    assert.ok(isAttack(kind) && hitsOne(kind));
    assert.ok(ITEM_NAMES[kind] && ITEM_HINTS[kind]);
    assert.ok(ITEM_MS[kind]! > 0);
  }
  assert.equal(ITEM_NAMES.length, ITEM_KINDS);
  assert.equal(ITEM_HINTS.length, ITEM_KINDS);
  assert.equal(ITEM_MS.length, ITEM_KINDS);
  assert.equal(hitsOne(DRUNK), false);
});

test("an attack on the ears lands on exactly one rival, the same one on every device", () => {
  const hit = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    for (const item of [FADE, PINGPONG]) {
      const state = battle(4, seed),
        twin = cloneWorld(state),
        sent = decodeWorld(library, encodeWorld(state));
      assert.ok(sent);
      const targets = thrown(state, item);
      assert.equal(targets.length, 1, "one rival");
      assert.notEqual(targets[0], 0, "never the thrower");
      // A copy of the world and one that went over the wire pick the same rival for the same length.
      assert.deepEqual(thrown(twin, item), targets);
      assert.deepEqual(thrown(sent, item), targets);
      assert.deepEqual(twin.players, state.players);
      assert.deepEqual(sent.players, state.players);
      hit.add(targets[0]!);
    }
  }
  assert.deepEqual([...hit].sort(), [1, 2, 3], "every rival gets a turn");
});

test("a fade lasts five to ten seconds and starts after the warning", () => {
  const lengths = new Set<number>();
  for (let seed = 1; seed <= 80; seed++) {
    const state = battle(2, seed);
    assert.deepEqual(thrown(state, FADE), [1]);
    const [, from, until, by] = state.players[1]!.effects[0]!;
    assert.equal(from, state.ms + ATTACK_LEAD_MS);
    assert.equal(by, 0);
    assert.ok(until - from >= 5000 && until - from <= 10_000);
    assert.equal(ITEM_MS[FADE]! + FADE_EXTRA_MS, 10_000);
    lengths.add(until - from);
  }
  assert.ok(lengths.size > 40, "the length varies with the seed");
  // Ping-pong is always its own length.
  const state = battle(2, 5);
  thrown(state, PINGPONG);
  const [, from, until] = state.players[1]!.effects[0]!;
  assert.equal(until - from, ITEM_MS[PINGPONG]);
});

test("a rider is picked over a bot, a shield swallows it, and the score is untouched", () => {
  for (let seed = 1; seed <= 30; seed++) {
    // Slots 1 and 3 are bots: only slot 2 can hear.
    assert.deepEqual(thrown(battle(4, seed, [1, 3]), FADE), [2]);
    // Only bots to throw at: one of them takes it.
    assert.equal(thrown(battle(3, seed, [1, 2]), PINGPONG).length, 1);
  }
  const state = battle(2, 9);
  state.players[1]!.item = SHIELD;
  stepWorld(library, state, [{ slot: 1, code: USE, ms: state.ms }]);
  const scores = state.players.map((player) => player.score);
  assert.deepEqual(thrown(state, FADE), []);
  assert.equal(state.players[1]!.shield, 0);
  assert.equal(state.players[1]!.blocked, state.ms);
  assert.deepEqual(
    state.players.map((player) => player.score),
    scores,
  );
});

test("the song is left alone unless the rider is under a fade or ping-pong", () => {
  assert.deepEqual(songShape([], 5000, 3.2), { level: 1, pan: 0 });
  const other: Effect = [DRUNK, 1000, 9000, 1];
  assert.deepEqual(songShape([other], 5000, 3.2), { level: 1, pan: 0 });
  const fade: Effect = [FADE, 10_000, 18_000, 1];
  assert.deepEqual(songShape([fade], 9999, 0), { level: 1, pan: 0 });
  assert.deepEqual(songShape([fade], 18_000, 0), { level: 1, pan: 0 });
});

test("a fade goes down smoothly to a trace and comes back before it ends", () => {
  const fade: Effect = [FADE, 10_000, 18_000, 1];
  let last = 1;
  for (let ms = 10_000; ms <= 10_000 + FADE_EASE_MS; ms += 50) {
    const { level, pan } = songShape([fade], ms, ms / 500);
    assert.equal(pan, 0);
    assert.ok(level <= last && last - level < 0.08, `no step at ${ms}`);
    last = level;
  }
  assert.ok(Math.abs(songShape([fade], 14_000, 0).level - FADE_FLOOR) < 1e-9);
  assert.ok(songShape([fade], 17_900, 0).level > 0.95);
  // Symmetric: as far from the end as from the start sounds the same.
  assert.ok(
    Math.abs(
      songShape([fade], 10_400, 0).level - songShape([fade], 17_600, 0).level,
    ) < 1e-9,
  );
});

test("ping-pong throws the song from ear to ear on the beat and never makes it louder", () => {
  const swing: Effect = [PINGPONG, 10_000, 19_000, 1];
  const at = (beat: number) => songShape([swing], 14_000, beat);
  assert.ok(Math.abs(at(0).pan - PINGPONG_REACH) < 1e-9, "one ear on a beat");
  assert.ok(Math.abs(at(1).pan + PINGPONG_REACH) < 1e-9, "the other next");
  assert.ok(Math.abs(at(0.5).pan) < 1e-9, "through the middle between");
  assert.ok(Math.abs(at(2).pan - at(0).pan) < 1e-9);
  for (let beat = 0; beat < 4; beat += 0.05) {
    const { level, pan } = at(beat);
    assert.ok(Math.abs(pan) <= PINGPONG_REACH + 1e-9 && PINGPONG_REACH < 1);
    assert.ok(level <= 1 && level >= 0.7);
    // Turned down the further out it is.
    assert.ok(Math.abs(level - (1 - 0.3 * Math.abs(pan))) < 1e-9);
  }
  // It eases in: no jump to one ear at the first frame.
  assert.ok(Math.abs(songShape([swing], 10_010, 0).pan) < 0.05);
  // Under both at once the song is quiet and still moving.
  const both = songShape([swing, [FADE, 10_000, 19_000, 2]], 14_000, 0);
  assert.ok(both.level < FADE_FLOOR + 1e-9 && both.pan > 0.8);
});

test("shaping a song changes only its loudness per ear, never when it plays", async () => {
  const r = createAudioRig();
  const audio = createGameAudio(r.deps);
  audio.unlock();
  r.addSong("/a.mp3", 90);
  const song = (await audio.loadSong("/a.mp3"))!;
  r.context.currentTime = 10;
  song.play(10.5, 3);
  const source = r.buffers.at(-1)!;
  const bus = source.output;
  const gains = r.gains.length;
  // The song as it is needs nothing in its way.
  song.shape(1, 0);
  assert.equal(r.gains.length, gains);
  assert.equal(source.output, bus);

  song.shape(0.25, -0.5);
  const gain = r.gains.at(-1)!,
    panner = r.panners.at(-1)!;
  assert.equal(r.gains.length, gains + 1);
  assert.equal(source.output, gain, "the running song goes through it");
  assert.equal(gain.gain.value, 0.25);
  assert.equal(panner.pan.value, -0.5);
  assert.deepEqual(source.started, { at: 10.5, offset: 3 }, "not restarted");
  assert.equal(source.stopped, false);
  assert.ok(SHAPE_EASE > 0 && SHAPE_EASE < 0.1);

  // Out of range and not-a-number are held to what a speaker can take.
  song.shape(7, -3);
  assert.equal(gain.gain.value, 1);
  assert.equal(panner.pan.value, -1);
  song.shape(Number.NaN, Number.NaN);
  assert.equal(gain.gain.value, 1);
  assert.equal(panner.pan.value, 0);

  // A later play of the same song keeps its way out, and so its shape.
  song.shape(0.5, 0);
  song.play(20, 0);
  assert.equal(r.buffers.at(-1)!.output, gain);
  assert.equal(r.gains.length, gains + 1, "one way out per song");

  // Stopped mid-effect, or run out: the next play starts as the song itself.
  song.shape(0.04, 0.8);
  song.stop();
  assert.equal(gain.gain.value, 1);
  assert.equal(panner.pan.value, 0);
  song.play(30, 0);
  song.shape(0.04, 0.8);
  r.buffers.at(-1)!.end();
  assert.equal(gain.gain.value, 1);
  assert.equal(panner.pan.value, 0);
  song.play(40, 0);
  song.shape(0.3, 0);
  assert.equal(gain.gain.value, 0.3, "and can be shaped again");
});

test("a browser without a stereo panner still fades", async () => {
  const r = createAudioRig();
  delete r.context.createStereoPanner;
  const audio = createGameAudio(r.deps);
  audio.unlock();
  r.addSong("/a.mp3", 30);
  const song = (await audio.loadSong("/a.mp3"))!;
  song.play(0, 0);
  song.shape(0.1, 0.9);
  assert.equal(r.gains.at(-1)!.gain.value, 0.1);
  assert.equal(r.panners.length, 0);
  assert.equal(r.buffers.at(-1)!.output, r.gains.at(-1));
});
