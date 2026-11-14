# Game audio

Shared module: `fuse-ui/game-audio` (`createGameAudio`, `bindAudioInput`, `createAudioControl`, plus `fuse-ui/game-audio.css`).
It owns one audio bus per page, the mute and the music/effects volumes (remembered in `localStorage` under `fuse-audio-v1`, shared by every game), the start on the first key, touch or pad press, `M` to mute, ducking (`audio.duck()`), and lazy looping songs. `?mute` keeps a preview silent and writes nothing.

A game keeps only its own sounds: `games/<id>/src/app/audio.ts` exports `createSfx(audio)` (cue to `audio.tone` / `noise` / `jingle`) and a `<GAME>_SONGS` list. Wiring: create the audio once in `main.ts`, call `audio.setSongs(SONGS, import.meta.env.BASE_URL)` and `audio.startMusic()`, call `bindAudioInput(audio, document, window)`, and put `createAudioControl(document, audio).element` in the header. Tests use `fuse-ui/game-audio-fake`.

Effects are synthesised, so they cost no files. Songs are mp3 files in `public/music/<game>/`, about 2 to 3 minutes, 128 kbps or lower so a track stays near 2 to 3 MB, and made to loop. Nothing is fetched until the player's first input and music is audible.

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

### Elasto Fuse

Not wired yet; use `fuse-ui/game-audio` as above and add a third folder.
