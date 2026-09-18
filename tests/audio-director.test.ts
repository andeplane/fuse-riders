import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioDirector,
  MUSIC_TRACKS,
  type AudioChannel,
  type GameSynth,
  type SynthNote,
} from "../src/client/audio-director.ts";
import { defaultRadio, type RadioState } from "../src/client/radio.ts";
import {
  MATCH_WINNER_TICKS,
  ROUND_OVER_TICKS,
  addPlayer,
  createGame,
  toSnapshot,
} from "../src/engine/game.ts";
import { beginMatchParticipant } from "../src/engine/match-stats.ts";
import type { GameEvent, ServerMessage } from "../src/shared/protocol.ts";
function fixture(stored: Partial<RadioState> = {}) {
  let canUnlock = true;
  let stops = 0;
  let pauses = 0;
  let position: number | undefined;
  let audible = false;
  const notes: { channel: AudioChannel; note: SynthNote }[] = [];
  const music: string[] = [];
  const offsets: number[] = [];
  const gains = new Map<AudioChannel, number>();
  const saved: RadioState[] = [];
  // Like the media element, a newly handed track reports no position until it has loaded (`at`).
  const synth: GameSynth = {
    unlock: async () => canUnlock,
    note: (channel, note) => notes.push({ channel, note }),
    gain: (channel, value) => {
      gains.set(channel, value);
    },
    music: (path, offset) => {
      music.push(path);
      offsets.push(offset);
      position = undefined;
    },
    pauseMusic: () => {
      pauses++;
    },
    position: () => position,
    duration: () => (position === undefined ? undefined : 180),
    stop: () => {
      stops++;
      position = undefined;
    },
    audible: () => audible,
  };
  const director = new AudioDirector(
    synth,
    { ...defaultRadio(), ...stored },
    (state) => saved.push(structuredClone(state)),
  );
  const game = createGame("audio");
  addPlayer(game, { id: "p", name: "P", slot: 0, color: "#ffffff" });
  beginMatchParticipant(game.matchStats, {
    id: "p",
    name: "P",
    slot: 0,
    color: "#ffffff",
  });
  const snapshot = (
    tick: number,
    phase = "playing" as typeof game.phase,
  ): ServerMessage => {
    game.phase = phase;
    return {
      type: "snapshot",
      matchId: game.matchId,
      round: game.round,
      tick,
      state: toSnapshot(game),
    };
  };
  const event = (tick: number, event: GameEvent): ServerMessage => ({
    type: "event",
    matchId: game.matchId,
    round: game.round,
    tick,
    event,
  });
  return {
    director,
    notes,
    music,
    offsets,
    gains,
    saved,
    game,
    snapshot,
    event,
    deny: () => {
      canUnlock = false;
    },
    allow: () => {
      canUnlock = true;
    },
    stops: () => stops,
    pauses: () => pauses,
    at: (seconds: number) => {
      position = seconds;
    },
    sounding: (value: boolean) => {
      audible = value;
    },
  };
}
test("effects wait for a gesture unlock, music is armed before it, and mute and volume route independently", async () => {
  const f = fixture();
  f.director.message(f.snapshot(10));
  f.director.update();
  // The synth holds the track from the start so the first gesture can play it inside that gesture; a refused unlock does not re-hand it.
  assert.deepEqual(
    f.music,
    [MUSIC_TRACKS[0].path],
    "the track reaches the synth before any unlock",
  );
  f.deny();
  assert.equal(await f.director.unlock(), false);
  f.director.update();
  assert.equal(f.music.length, 1);
  f.director.message(f.event(11, { type: "explosion", bombId: 1 }));
  assert.equal(f.notes.length, 0, "effects still need the unlock");
  f.director.setVolume("music", 0.6);
  f.director.setMuted("music", true);
  assert.equal(f.gains.get("music"), 0);
  f.director.setVolume("music", 0.8);
  assert.equal(f.gains.get("music"), 0);
  f.director.setMuted("music", false);
  assert.equal(f.gains.get("music"), 0.8);
  f.director.setVolume("effects", 2);
  assert.equal(f.gains.get("effects"), 1);
  f.director.setVolume("effects", -1);
  assert.equal(f.gains.get("effects"), 0);
  f.director.setVolume("effects", NaN);
  assert.equal(f.gains.get("effects"), 0);
});
test("recorded music starts once per track, stops on disconnect and resumes on reconnect", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(10));
  f.director.update();
  f.director.update();
  assert.deepEqual(f.music, [MUSIC_TRACKS[0].path]);
  f.director.disconnect();
  assert.equal(f.stops(), 1);
  f.director.update();
  assert.equal(f.music.length, 1);
  f.director.message(f.snapshot(11));
  f.director.update();
  assert.deepEqual(f.music, [MUSIC_TRACKS[0].path, MUSIC_TRACKS[0].path]);
});
test("authoritative effects coalesce volleys, reject stale events and baseline reconnects silently", async () => {
  const f = fixture();
  await f.director.unlock();
  const launch: GameEvent = { type: "bombPlaced", bombId: 1, playerId: "p" };
  f.director.message(f.event(10, launch));
  assert.equal(f.notes.length, 0);
  f.director.message(f.snapshot(10));
  f.director.message(f.event(10, launch));
  assert.equal(f.notes.length, 0);
  for (let id = 0; id < 5; id++)
    f.director.message(f.event(11, { ...launch, bombId: id }));
  assert.equal(f.notes.length, 1);
  f.director.message(f.event(11, { type: "explosion", bombId: 1 }));
  f.director.message(
    f.event(11, { type: "playerEliminated", playerId: "p", cause: "wall" }),
  );
  f.director.message(f.event(12, { type: "roundEnded" }));
  f.director.message(f.event(12, { type: "matchEnded", winnerId: "p" }));
  assert.equal(f.notes.length, 7, "the round's sting, not yet the match's");
  // The final pause opens on the round's own result: the match sting waits for the card that names the match winner.
  f.game.phaseEndsAtTick = 12 + ROUND_OVER_TICKS + MATCH_WINNER_TICKS;
  f.director.message(f.snapshot(12 + ROUND_OVER_TICKS - 1, "matchOver"));
  assert.equal(f.notes.length, 7);
  f.director.message(f.snapshot(12 + ROUND_OVER_TICKS, "matchOver"));
  assert.equal(f.notes.length, 9);
  f.director.message(f.snapshot(13 + ROUND_OVER_TICKS, "matchOver"));
  assert.equal(f.notes.length, 9, "once");
  f.game.phaseEndsAtTick = undefined;
  f.director.message(f.snapshot(100));
  f.director.message(f.event(90, launch));
  assert.equal(f.notes.length, 9);
  f.director.disconnect();
  assert.equal(f.stops(), 1);
  f.director.message(f.snapshot(110));
  f.director.message(f.event(110, launch));
  assert.equal(f.notes.length, 9);
  f.director.message({ type: "hostAuthenticated" });
  for (let tick = 111; tick < 220; tick++)
    f.director.message(f.event(tick, launch));
  assert.equal(f.notes.length, 118);
});
test("pickup cues use authoritative collection events and reconnect baseline stays silent", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(10));
  f.director.message(
    f.event(11, { type: "pickupCollected", playerId: "p", pickupId: 1 }),
  );
  assert.equal(f.notes.length, 3);
  f.director.message(
    f.event(11, { type: "pickupCollected", playerId: "p", pickupId: 2 }),
  );
  assert.equal(f.notes.length, 3);
  f.director.message(f.snapshot(12));
  f.director.message(f.snapshot(11));
  assert.equal(f.notes.length, 3);
  f.director.disconnect();
  f.director.message(f.snapshot(101));
  f.director.message(
    f.event(100, { type: "pickupCollected", playerId: "p", pickupId: 3 }),
  );
  assert.equal(f.notes.length, 3);
});

test("engine emits collection once only after a real pickup is consumed", async () => {
  const { startMatch, step, COUNTDOWN_TICKS } =
    await import("../src/engine/game.ts");
  const f = fixture();
  addPlayer(f.game, { id: "q", name: "Q", slot: 1, color: "#aaaaaa" });
  startMatch(f.game);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) step(f.game, new Map());
  const player = f.game.players.get("p")!;
  f.game.pickups = [
    {
      id: 999,
      type: "star",
      x: player.x,
      y: player.y,
      expiresAtTick: f.game.tick + 100,
    },
  ];
  assert.deepEqual(
    step(f.game, new Map()).events.filter((e) => e.type === "pickupCollected"),
    [{ type: "pickupCollected", playerId: "p", pickupId: 999 }],
  );
  assert.equal(
    step(f.game, new Map()).events.filter((e) => e.type === "pickupCollected")
      .length,
    0,
  );
});

test("older round snapshots cannot reset scope or stop music", async () => {
  const f = fixture();
  await f.director.unlock();
  f.game.round = 2;
  f.director.message(f.snapshot(100));
  f.game.round = 1;
  f.director.message(f.snapshot(90, "roundOver"));
  f.director.message(
    f.event(91, { type: "bombPlaced", bombId: 1, playerId: "p" }),
  );
  assert.equal(f.notes.length, 0);
  f.director.update();
  assert.equal(f.music.length, 1);
});

test("playlist switches tracks, wraps and retains mute and volume", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(1));
  f.director.setVolume("music", 0.17);
  f.director.setMuted("music", true);
  f.director.update();
  assert.equal(f.director.trackTitle, MUSIC_TRACKS[0].title);
  f.director.nextTrack();
  assert.equal(f.director.trackTitle, MUSIC_TRACKS[1].title);
  assert.deepEqual(f.music, [MUSIC_TRACKS[0].path, MUSIC_TRACKS[1].path]);
  for (let index = 2; index <= MUSIC_TRACKS.length; index++) {
    f.director.nextTrack();
    assert.equal(
      f.director.trackTitle,
      MUSIC_TRACKS[index % MUSIC_TRACKS.length]!.title,
    );
  }
  assert.equal(f.music.length, MUSIC_TRACKS.length + 1);
  assert.equal(f.gains.get("music"), 0);
  f.director.setMuted("music", false);
  assert.equal(f.gains.get("music"), 0.17);
});

test("new rounds keep the current track playing instead of restarting it", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(1));
  f.director.update();
  const first = f.director.trackTitle;
  f.director.message(f.snapshot(2));
  f.director.update();
  assert.equal(f.director.trackTitle, first);
  f.director.message(f.snapshot(3, "roundOver"));
  f.director.update();
  assert.equal(f.director.trackTitle, first);
  f.game.round++;
  f.director.message(f.snapshot(4, "countdown"));
  f.director.update();
  assert.equal(f.director.trackTitle, first);
  f.director.message(f.snapshot(5));
  f.director.update();
  assert.equal(f.director.trackTitle, first);
  f.game.round++;
  f.director.message(f.snapshot(6));
  f.director.update();
  assert.equal(f.director.trackTitle, first);
  f.game.matchId = "later-match";
  f.game.round = 0;
  f.director.message(f.snapshot(7, "countdown"));
  f.director.update();
  assert.equal(f.director.trackTitle, first, "a new match keeps the track too");
  assert.deepEqual(
    f.music,
    [MUSIC_TRACKS[0].path],
    "the track is only handed to the synth once",
  );
});

test("background music plays with no match attached and survives a hidden tab", async () => {
  const f = fixture();
  f.director.playBackground();
  assert.equal(
    f.music.length,
    1,
    "armed at once; the synth plays it on the first gesture",
  );
  await f.director.unlock();
  f.director.update();
  assert.deepEqual(f.music, [MUSIC_TRACKS[0].path]);
  f.director.disconnect();
  assert.equal(f.stops(), 1);
  f.director.update();
  assert.equal(
    f.music.length,
    1,
    "a stopped director stays silent until it is resumed",
  );
  f.director.resume();
  assert.deepEqual(f.music, [MUSIC_TRACKS[0].path, MUSIC_TRACKS[0].path]);
  f.director.resume();
  assert.equal(f.music.length, 2, "resuming again does not restart the track");
});

test("a hidden tab keeps its music and only drops effect cues", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(10));
  f.director.update();
  assert.deepEqual(f.music, [MUSIC_TRACKS[0].path]);
  // Alt-tabbing away: the track plays on, so coming back does not restart it from the top.
  f.director.setEffectsSilenced(true);
  f.director.message(f.event(11, { type: "explosion", bombId: 1 }));
  assert.equal(
    f.notes.length,
    0,
    "a room the viewer cannot see makes no noise",
  );
  assert.equal(f.stops(), 0, "the track is never stopped");
  f.director.message(f.snapshot(12));
  f.director.update();
  assert.equal(f.music.length, 1, "no new track is started while hidden");
  f.director.setEffectsSilenced(false);
  f.director.message(f.event(13, { type: "explosion", bombId: 2 }));
  assert.equal(f.notes.length, 2, "cues come back with the tab");
  f.director.resume();
  f.director.update();
  assert.equal(
    f.music.length,
    1,
    "coming back resumes the same track rather than restarting it",
  );
});

test("a refused unlock leaves the track armed in the synth, and a later unlock does not hand it over again", async () => {
  const f = fixture();
  f.deny();
  // The page asks for music at load. The synth already holds the track, so the first tap on a phone plays it
  // inside the synth's own unlock rather than only unlocking and leaving a second tap to play (the old two-tap bug).
  f.director.playBackground();
  assert.deepEqual(
    f.music,
    [MUSIC_TRACKS[0].path],
    "armed at load, before any gesture",
  );
  assert.equal(await f.director.unlock(), false);
  f.director.update();
  assert.equal(f.music.length, 1);
  f.allow();
  assert.equal(await f.director.unlock(), true);
  f.director.update();
  assert.equal(
    f.music.length,
    1,
    "the same armed track is not restarted by the unlock that finally succeeds",
  );
});

test("resume only revives background music, never a match that has not sent a snapshot", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.resume();
  f.director.update();
  assert.equal(f.music.length, 0);
  f.director.message(f.snapshot(1));
  f.director.update();
  assert.equal(f.music.length, 1);
  f.director.disconnect();
  f.director.resume();
  assert.equal(f.music.length, 1, "a match waits for its next snapshot");
  f.director.message(f.snapshot(2));
  f.director.update();
  assert.equal(f.music.length, 2);
});

test("mute state is readable so a page can label its own music toggle", async () => {
  const f = fixture();
  assert.equal(f.director.isMuted("music"), false);
  assert.equal(f.director.isMuted("effects"), false);
  f.director.setMuted("music", true);
  assert.equal(f.director.isMuted("music"), true);
  assert.equal(f.director.isMuted("effects"), false);
  assert.equal(f.gains.get("music"), 0);
  f.director.setMuted("music", false);
  assert.equal(f.director.isMuted("music"), false);
  assert.equal(f.gains.get("music"), 0.22);
});

test("enabled audio plays in the lobby and intermissions and explicit enable confirms output", async () => {
  const f = fixture();
  f.director.message(f.snapshot(1, "lobby"));
  f.director.update();
  assert.equal(f.notes.length, 0, "gesture is still required");
  await f.director.unlock(true);
  assert.equal(f.notes.length, 1);
  assert.equal(f.notes[0]!.channel, "effects");
  f.director.update();
  assert.equal(f.music.length, 1);
  f.director.message(f.snapshot(2, "roundOver"));
  f.director.update();
  assert.equal(f.music.length, 1);
  assert.equal(f.stops(), 0, "intermission continues music");
});

test("a page load resumes the saved track and position, and leaving saves where the song was", async () => {
  const f = fixture({ track: "forest-job", position: 42 });
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  assert.deepEqual(f.music, ["/music/forest-job.m4a"]);
  assert.deepEqual(f.offsets, [42]);
  assert.equal(f.director.position(), 42, "loading keeps the resume point");
  assert.equal(f.director.duration(), undefined);
  f.at(57.5);
  assert.equal(f.director.duration(), 180);
  f.director.save();
  assert.equal(f.saved.at(-1)!.position, 57.5);
  assert.equal(f.saved.at(-1)!.track, "forest-job");
  f.at(61);
  f.director.disconnect();
  assert.equal(f.saved.at(-1)!.position, 61);
  f.director.resume();
  assert.deepEqual(
    f.offsets,
    [42, 61],
    "a stopped radio resumes where it stopped, not from the top",
  );
});

test("pause keeps the position, nothing restarts a paused radio, and it stays paused across page loads", async () => {
  const f = fixture();
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  f.at(30);
  f.director.togglePause();
  assert.equal(f.pauses(), 1);
  assert.equal(f.director.state.paused, true);
  assert.equal(f.director.position(), 30);
  f.director.update();
  f.director.resume();
  f.director.message(f.snapshot(1));
  f.director.update();
  assert.equal(f.music.length, 1);
  f.director.togglePause();
  assert.equal(f.music.length, 2);
  assert.equal(f.offsets.at(-1), 30);
  assert.equal(f.saved.at(-1)!.paused, false);
  const paused = fixture({ paused: true, position: 12 });
  paused.director.playBackground();
  await paused.director.unlock();
  paused.director.update();
  assert.equal(paused.music.length, 0);
});

test("next, previous and picking a track start from the top; a late previous restarts the song", async () => {
  const f = fixture();
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  f.at(80);
  f.director.nextTrack();
  assert.equal(f.music.at(-1), MUSIC_TRACKS[1].path);
  assert.equal(f.offsets.at(-1), 0);
  assert.equal(f.pauses(), 1);
  f.at(10);
  f.director.previousTrack();
  assert.equal(f.music.at(-1), MUSIC_TRACKS[1].path);
  assert.equal(f.offsets.at(-1), 0);
  f.at(1);
  f.director.previousTrack();
  assert.equal(f.director.trackTitle, MUSIC_TRACKS[0].title);
  f.director.previousTrack();
  assert.equal(
    f.director.trackTitle,
    MUSIC_TRACKS.at(-1)!.title,
    "previous wraps",
  );
  f.director.togglePause();
  f.director.play("final-chase", "playlist");
  assert.equal(f.director.state.paused, false);
  assert.equal(f.director.state.source, "playlist");
  assert.equal(f.music.at(-1), "/music/final-chase.m4a");
  f.director.nextTrack();
  assert.equal(
    f.director.state.track,
    "reduced-noise-orchestra",
    "an empty playlist plays all tracks",
  );
});

test("finished tracks follow loop song, and an unlooped playlist stops at its end", async () => {
  const f = fixture({
    source: "playlist",
    playlist: ["final-chase", "coin-op-swing"],
    track: "final-chase",
    loopPlaylist: false,
  });
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  f.director.setLoopSong(true);
  f.director.trackEnded();
  assert.deepEqual(f.music, [
    "/music/final-chase.m4a",
    "/music/final-chase.m4a",
  ]);
  assert.equal(f.offsets.at(-1), 0);
  f.director.setLoopSong(false);
  f.director.trackEnded();
  assert.equal(f.director.state.track, "coin-op-swing");
  f.director.trackEnded();
  assert.equal(f.director.state.paused, true);
  assert.equal(f.director.state.track, "final-chase");
  assert.equal(f.music.length, 3);
  assert.equal(
    f.pauses(),
    3,
    "every ended track is disarmed, so a later gesture cannot replay it under a paused radio",
  );
  assert.equal(f.saved.at(-1)!.paused, true);
  f.director.setLoopPlaylist(true);
  f.director.play("coin-op-swing");
  f.director.trackEnded();
  assert.equal(f.director.state.track, "final-chase");
  assert.equal(f.director.state.paused, false);
});

test("playlist edits, sources and loop flags are saved, and every change is announced", () => {
  const f = fixture();
  let renders = 0;
  const unsubscribe = f.director.subscribe(() => renders++);
  f.director.togglePlaylist("forest-job");
  f.director.togglePlaylist("coin-op-swing");
  f.director.togglePlaylist("forest-job");
  assert.deepEqual(f.saved.at(-1)!.playlist, ["coin-op-swing"]);
  f.director.setSource("playlist");
  f.director.setLoopPlaylist(false);
  assert.equal(f.saved.at(-1)!.source, "playlist");
  assert.equal(f.saved.at(-1)!.loopPlaylist, false);
  assert.equal(renders, 5);
  f.director.setMuted("music", true);
  assert.equal(renders, 6, "mute changes redraw the radio too");
  unsubscribe();
  f.director.setLoopSong(true);
  assert.equal(renders, 6);
  assert.equal(f.saved.at(-1)!.loopSong, true);
});

test("periodic saves record only where the song is, and another tab's choices are adopted without writing back", () => {
  const saves: { kind: string; state: RadioState }[] = [];
  const synth: GameSynth = {
    unlock: async () => true,
    note() {},
    gain() {},
    music() {},
    pauseMusic() {},
    position: () => undefined,
    duration: () => undefined,
    stop() {},
    audible: () => false,
  };
  const director = new AudioDirector(synth, defaultRadio(), (state, kind) =>
    saves.push({ kind, state: structuredClone(state) }),
  );
  director.save();
  director.setLoopSong(true);
  assert.deepEqual(
    saves.map((save) => save.kind),
    ["position", "all"],
  );
  let renders = 0;
  director.subscribe(() => renders++);
  director.adoptChoices({
    loopSong: false,
    loopPlaylist: false,
    source: "playlist",
    playlist: ["forest-job"],
  });
  assert.equal(saves.length, 2, "adopting writes nothing back");
  assert.equal(renders, 1);
  assert.deepEqual(
    { ...director.state },
    {
      ...defaultRadio(),
      loopPlaylist: false,
      source: "playlist",
      playlist: ["forest-job"],
    },
  );
});

test("an OS pause follows into the radio and nothing on the page restarts it; an OS resume follows too", async () => {
  const f = fixture();
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  f.at(42);
  f.sounding(true);
  assert.equal(f.director.audible(), true);
  f.director.mediaPaused();
  assert.equal(f.director.state.paused, true);
  assert.equal(f.saved.at(-1)!.paused, true);
  assert.equal(f.saved.at(-1)!.position, 42);
  assert.equal(
    f.pauses(),
    1,
    "the track is disarmed so an unlock cannot replay it",
  );
  assert.equal(
    f.director.audible(),
    false,
    "no track is handed to the synth any more",
  );
  await f.director.unlock();
  f.director.update();
  f.director.resume();
  assert.equal(
    f.music.length,
    1,
    "a tap, a returning tab or resume() does not start it",
  );
  f.director.mediaPaused();
  assert.equal(f.pauses(), 1, "a repeated pause is a no-op");
  f.director.mediaResumed();
  assert.equal(f.director.state.paused, false);
  assert.deepEqual(
    [f.music.length, f.offsets.at(-1)],
    [2, 42],
    "resumes from where the OS paused it",
  );
  f.director.mediaResumed();
  assert.equal(f.music.length, 2, "a repeated resume is a no-op");
});

test("the track length survives a pause for the lock-screen scrubber and resets with a new track", async () => {
  const f = fixture();
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  f.at(10);
  assert.equal(f.director.duration(), 180);
  f.director.togglePause();
  assert.equal(f.director.duration(), 180, "paused keeps the known length");
  f.director.nextTrack();
  assert.equal(
    f.director.duration(),
    undefined,
    "a new track has no length until it loads",
  );
});

test("a later failed unlock (a lock-screen play iOS will not let resume the context) does not stop the music", async () => {
  const f = fixture();
  f.director.playBackground();
  await f.director.unlock();
  f.director.update();
  f.at(20);
  f.director.togglePause();
  f.deny();
  assert.equal(
    await f.director.unlock(),
    false,
    "the attempt still reports its own failure",
  );
  f.director.togglePause();
  assert.deepEqual(
    [f.music.length, f.offsets.at(-1)],
    [2, 20],
    "play re-arms the track after the failed unlock",
  );
  f.director.mediaPaused();
  f.director.mediaResumed();
  assert.equal(f.music.length, 3, "an OS resume arms it too");
});

test("gun crack is short, layered, varied and deduplicated per shot", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(10));
  const shot = f.event(11, {
    type: "bombPlaced",
    bombId: 1,
    playerId: "p",
    gun: true,
  });
  f.director.message(shot);
  assert.equal(f.notes.length, 4);
  assert.ok(
    f.notes.some(
      ({ note }) => note.wave === "triangle" && note.frequency > 200,
    ),
  );
  assert.ok(
    f.notes.every(
      ({ channel, note }) => channel === "effects" && note.duration <= 0.16,
    ),
  );
  f.director.message(shot);
  assert.equal(f.notes.length, 4, "duplicate shot stays silent");
  f.director.message(
    f.event(11, { type: "bombPlaced", bombId: 3, playerId: "p", gun: true }),
  );
  assert.equal(f.notes.length, 4, "volley rays share one firing sound");
  f.director.message(
    f.event(11, {
      type: "bombPlaced",
      bombId: 2,
      playerId: "other",
      gun: true,
    }),
  );
  assert.equal(f.notes.length, 8, "another shot in the same tick is audible");
  assert.notEqual(f.notes[0]!.note.frequency, f.notes[4]!.note.frequency);
});

test("replay stings play only after the unlock and never while effects are silenced", async () => {
  const f = fixture();
  f.director.replayCue("in");
  assert.equal(f.notes.length, 0, "locked");
  await f.director.unlock();
  f.director.replayCue("in");
  const riser = f.notes.length;
  assert.ok(riser >= 2, "a riser and its tail");
  assert.ok(f.notes.every((entry) => entry.channel === "effects"));
  f.director.replayCue("impact");
  assert.ok(f.notes.length > riser);
  assert.ok(
    f.notes
      .slice(riser)
      .some((entry) => entry.note.frequency > entry.note.endFrequency!),
    "the thump falls",
  );
  const before = f.notes.length;
  f.director.setEffectsSilenced(true);
  f.director.replayCue("out");
  assert.equal(f.notes.length, before, "a hidden tab is silent");
  f.director.setEffectsSilenced(false);
  f.director.replayCue("out");
  assert.ok(f.notes.length > before);
});

test("Gun pickup racks once after the pickup cue, while joins and hidden transitions stay silent", async () => {
  const f = fixture();
  await f.director.unlock();
  f.director.message(f.snapshot(10));
  const player = f.game.players.get("p")!;
  player.gunArmed = true;
  f.director.message(f.snapshot(11));
  assert.equal(f.notes.length, 2);
  assert.ok(f.notes.every(({ note }) => note.delay! >= 0.32));
  f.director.message(f.snapshot(11));
  assert.equal(f.notes.length, 2);
  f.director.disconnect();
  f.director.message(f.snapshot(12));
  assert.equal(f.notes.length, 2, "rejoining armed stays silent");
  player.gunArmed = false;
  f.director.message(f.snapshot(13));
  f.director.setEffectsSilenced(true);
  player.gunArmed = true;
  f.director.message(f.snapshot(14));
  f.director.setEffectsSilenced(false);
  f.director.message(f.snapshot(15));
  assert.equal(f.notes.length, 2, "hidden pickup is not replayed");
});

test("impact audio coalesces a volley and respects repeated snapshots and hidden tabs", async () => {
  const f = fixture();
  await f.director.unlock();
  const before = f.snapshot(10);
  if (before.type !== "snapshot") throw Error("Expected snapshot");
  f.director.message(before);
  const bomb = {
    id: 1,
    ownerId: "p",
    launchX: 200,
    launchY: 450,
    x: before.state.width - before.state.boundaryInset - 2,
    y: 450,
    launchedTick: 11,
    landsAtTick: 14,
    explodeAtTick: 14,
    blastRange: 0,
    shell: { gun: true, vx: 1, vy: 0 },
    flightPath: [],
  };
  const after = {
    ...before,
    tick: 11,
    state: { ...before.state, bombs: [bomb, { ...bomb, id: 2 }] },
  };
  f.director.message(after);
  assert.equal(f.notes.length, 2, "one solid-impact cue for the volley");
  f.director.message(after);
  assert.equal(f.notes.length, 2);
  f.director.setEffectsSilenced(true);
  f.director.message({
    ...after,
    tick: 12,
    state: { ...after.state, bombs: [{ ...bomb, id: 3, launchedTick: 12 }] },
  });
  assert.equal(f.notes.length, 2);
  f.director.disconnect();
  f.director.setEffectsSilenced(false);
  f.director.message(after);
  assert.equal(f.notes.length, 2, "reconnect baseline is silent");
});
