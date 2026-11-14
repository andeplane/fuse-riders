# Game audio

Shared module: `fuse-ui/game-audio` (`createGameAudio`, `bindAudioInput`, `createAudioControl`, plus `fuse-ui/game-audio.css`).
It owns one audio bus per page, the mute and the music/effects volumes (remembered in `localStorage` under `fuse-audio-v1`, shared by every game), the start on the first key, touch or pad press, `M` to mute, ducking (`audio.duck()`), and lazy looping songs. `?mute` keeps a preview silent and writes nothing.

A game keeps only its own sounds: `games/<id>/src/app/audio.ts` exports `createSfx(audio)` (cue to `audio.tone` / `noise` / `jingle`, and `audio.hum()` for a sound that lasts, such as an engine) and a `<GAME>_SONGS` list. Wiring: create the audio once in `main.ts`, call `audio.setSongs(SONGS, import.meta.env.BASE_URL)` and `audio.startMusic()`, call `bindAudioInput(audio, document, window)`, and put `createAudioControl(document, audio).element` in the header. Tests use `fuse-ui/game-audio-fake`.

Effects are synthesised, so they cost no files. Songs are mp3 files in `public/music/<game>/`, about 2 to 3 minutes, 128 kbps or lower so a track stays near 2 to 3 MB, and made to loop. Nothing is fetched until the player's first input and music is audible.

## Clocked songs (rhythm games)

A game whose play is timed to the music does not use the looping `<audio>` music: it plays a decoded song from the audio clock, so the position it draws and judges against is the position being heard.

- `audio.clock()` returns the `AudioClock`, or `undefined` on a `?mute` page or without Web Audio. `now()` is `AudioContext.currentTime` in seconds; `latency()` is the seconds between a sample's scheduled time and the moment it is heard (`outputLatency`, else `baseLatency`, else 0; a browser reports 0 until its context has run, so 0 counts as missing); `running` is whether the clock advances (unlocked, visible, context running). It opens the context if needed. A player who muted with the button still has a running clock.
- `audio.loadSong(url)` fetches and decodes a file and resolves to a `ClockedSong`, or `undefined` on a `?mute` page or when it cannot be fetched or decoded (a failure is not remembered, so asking again retries). The latest `SONG_CACHE` (3) decoded songs are kept by URL, since a decoded song is tens of megabytes.
- `song.play(at, offset)` schedules song position `offset` (seconds) at audio-clock time `at` and replaces any earlier play of that song. `at` in the past starts now from where the song would have got to, a negative `offset` waits, an offset past the end plays nothing. `song.stop()` ends it; `song.playing` is true from `play` until `stop` or the end.
- The song is on the music bus, so the mute, the music volume and `duck()` apply. The looping music of `startMusic()` pauses while any clocked song plays and returns after `stop()` or the song's end, if it is still wanted.
- A hidden tab suspends the context, which freezes a playing song where it is. The game restarts it at the right position when the tab returns; Fusemania's `games/fusemania/src/app/song-clock.ts` does that and turns `performance.now()` into the heard song position.

Tests: `createAudioRig()` serves songs with `rig.addSong(url, seconds)`, records buffer sources in `rig.buffers` (`started`, `stopped`, `output`, `end()`), and its `context` is writable (`currentTime`, `outputLatency`, `state`). A game that only needs a clock and a song takes `createFakeAudioClock()` and `createFakeClockedSong(duration, clock)`.

## Songs and Suno

Songs are made with Suno (via `suno` CLI) on Anders' own account, a Pro plan that includes commercial rights. Shipped: Fuse Volley has Jelly Beach Bounce and Sandy Rally; Fuseball has Neon Kickoff, Gadget Overdrive and Sudden Death, re-encoded to 96 kbps with metadata stripped (1 to 2 MB each). Commercial use is allowed only for songs made while on a paid plan, so check the plan before committing files; make them on a free plan and they must not go in the repo.

To add songs: drop the mp3s in `public/music/<game>/` and list them in the game's `<GAME>_SONGS` (`{ id, title, path: "music/<game>/<file>.mp3" }`).

### Fuse Volley (bouncy neon beach, jelly blobs)

1. "Jelly Beach Bounce": upbeat instrumental, bouncy marimba and steel drum, funky slap bass, handclaps, summer beach arcade game, 118 bpm, major key, playful, loopable, no vocals
2. "Sandy Rally": instrumental surf-pop with chiptune sparkles, twangy reverb guitar, tight drums, building energy for a match, 124 bpm, cheerful, no vocals
3. "Match Point": instrumental, tense but fun, pulsing synth bass, brass stabs, four-on-the-floor kick, sports arcade final-point feel, 128 bpm, no vocals

### Fuseball (hard neon arena)

1. "Neon Kickoff": instrumental synthwave arcade, driving arpeggios, punchy gated drums, heroic lead synth, futuristic sports arena, 132 bpm, minor key, loopable, no vocals
2. "Gadget Overdrive": instrumental electro-breakbeat, glitchy bass, laser zaps, 8-bit lead, chaotic and fast, 140 bpm, no vocals
3. "Sudden Death": instrumental dark synth-rock, rising tension, heavy sub bass, siren-like lead, high stakes finale, 136 bpm, no vocals

### Fusemania

The song being played is the music: `audio.loadSong()` decodes it and `games/fusemania/src/app/song-clock.ts` keeps it on the room's clock (see "Clocked songs" above). The song select plays the chosen song on the shared radio (`audio.setSongs([song])`), so the music slider, the Sound button and `?mute` rule both. Effects are `games/fusemania/src/app/audio.ts`: a power-up taken, thrown, landing and blocked, a mine, and a fanfare on the result. There are no hit sounds on the notes: a synthesized tick a few milliseconds off the music reads as lag. Fusemania has no songs of its own; it plays every other game's (`games/fusemania/charts/README.md` lists them), so a new song anywhere can get charts with `scripts/fusemania-charts.ts`.

### Elasto Fuse

Effects and the engine are wired (`games/elasto-fuse/src/app/audio.ts`; the engine is `audio.hum()`, a sustained voice on the effects bus). No songs yet: `ELASTO_SONGS` is empty, so the music slider has nothing to play until mp3s land in `public/music/elasto-fuse/`. Prompt ideas (a springy trials bike over neon hills, focused rather than frantic, since a ride is retried many times):

1. "Springy Hills": instrumental chiptune synthwave, bouncy plucked bass, bright arpeggios, light breakbeat, playful and focused, 112 bpm, major key, loopable, no vocals
2. "Apple Run": instrumental retro arcade funk, rubbery synth bass, wah clav, crisp drums, 8-bit lead melody, cheerful momentum, 120 bpm, loopable, no vocals
3. "Night Trials": instrumental mellow synthwave, warm pads, steady four-on-the-floor, glassy bell lead, calm concentration, 104 bpm, minor key, loopable, no vocals
