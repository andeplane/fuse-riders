# Music for Killer Fuse

Every **sound effect** in Killer Fuse is synthesised in the browser (`src/render/sound.ts`) — there are no effect
files and there should not be. **Music** is the one thing that may come from a file, and every file is optional:
with none, the arena keeps its synthesised chiptune bed and nothing breaks.

The player is `src/app/music.ts`. Like the other games here it plays music through a media element rather than the
Web Audio graph, so the phone's volume keys reach it and a minute of audio streams instead of sitting decoded in
memory.

## Where the files go

```
games/killer-fuse/public/killer-fuse/audio/music/
```

That folder is served at `<base>killer-fuse/audio/music/` — the same layout the art uses
(`games/killer-fuse/public/killer-fuse/art/`), which is how a game's own `public/` folder works in this repo
(`vite.config.ts`, `gamePublic`). Drop the files straight in; `pnpm build` copies them, and the dev server serves
them from the source folder.

## Filenames

| File          | When it plays                                                  | Loop?      |
| ------------- | -------------------------------------------------------------- | ---------- |
| `lobby`       | The landing page, the lobby, and the wait between sets         | loops      |
| `match-day`   | A game on **Day** (map 1)                                      | loops      |
| `match-dusk`  | A game on **Dusk** (map 2)                                     | loops      |
| `match-night` | A game on **Night** (map 3)                                    | loops      |
| `victory`     | The set is over and this device's team won (and for a watcher) | plays once |
| `defeat`      | The set is over and this device's team lost                    | plays once |

Each name takes the extension `.mp3` or `.ogg`, for example `lobby.mp3` or `match-day.ogg`. The name must match
exactly, lower case.

**One match track is enough.** If `match-dusk` and `match-night` have no file of their own they fall back to
`match-day`, so a single high-energy loop scores all three maps. The lobby and the two stings have no fallback: no
file means no music at that moment (the synthesised bed still plays during a game).

## The manifest — do not forget this step

The game reads `manifest.json` in that folder **once**, and never asks for a file the manifest does not list. That
is deliberate: a game with no music makes no request for one, so there is no 404 spam in the console and a muted
preview downloads nothing at all.

After dropping files in, list them:

```json
{
  "files": ["lobby.mp3", "match-day.mp3", "victory.mp3", "defeat.mp3"]
}
```

Only the names in the table above are understood, only `.mp3` and `.ogg`, and only bare filenames (no folders). A
name the game does not know, or a typo, is quietly ignored — a mistyped manifest costs the music, not the page.

## Format and loudness

- **Format**: MP3 at 160–192 kbps CBR, 44.1 kHz stereo, is the safe choice (every browser plays it). OGG/Vorbis
  at q5 is smaller and loops cleanly, but Safari support has been uneven — ship MP3 unless you have checked.
- **Loudness**: about **−14 LUFS integrated**, true peak **≤ −1 dBTP**. The game plays music at roughly a third of
  full scale and ducks it under kills and stings, so a track mastered much hotter than this will fight the effects.

  ```sh
  ffmpeg -i in.wav -af loudnorm=I=-14:TP=-1.0:LRA=11 -ar 44100 -b:a 192k lobby.mp3
  ffmpeg -i lobby.mp3 -af ebur128 -f null -        # check I: and Peak:
  ```

- **Size**: keep each file under about 2 MB. A 90 s loop at 192 kbps is ~2.1 MB, so 160 kbps is a better fit for
  the longer tracks.

## Loop requirements

- **Loop length 60–90 s** for `lobby` and the three `match-*` tracks. Shorter than 60 s and a long game wears it
  out; longer than 90 s and the download starts to be felt on a phone.
- The track must **loop seamlessly**: end on the bar line, with no silence, fade-in or fade-out at either end, and
  no reverb tail hanging past the last sample. Export at an exact bar length (e.g. 32 bars at 128 BPM = 60.0 s).
- MP3 encoders add padding at the start and end, which can click at the seam. If a seam clicks, trim a few
  milliseconds in an editor and re-export, or ship that track as OGG.
- `victory` and `defeat` are **stings, not loops**: 4–8 s, ending on a clean resolve (or a clean collapse). They
  play once and stop.
- The game crossfades between tracks over about 1.6 s, so a track does not need its own intro or outro.

## Suno prompts

Generate these in the Suno web app and drop the downloads in (there is no public API to automate it; keep your
plan and the date as the licence evidence). Ask for **instrumental** every time — any vocal will fight the sound
effects. Ask for a loopable take at the lengths above.

### 1. Lobby / menu — `lobby.mp3`

> Instrumental neon-pixel arcade lobby loop. Mellow 1990s coin-op attract-mode chiptune meets slow synthwave:
> warm analogue bass pulse, glassy FM electric-piano chords, soft square-wave arpeggio drifting underneath, lazy
> 8-bit hi-hats, a single wistful lead line that never quite resolves. Patient and expectant — people are waiting
> for friends to join, not fighting yet. 96 BPM, A minor, no vocals, no speech, no risers, no build to a drop.
> Even energy from first bar to last so it loops forever without a seam. 75 seconds.

### 2. Match — `match-day.mp3` (covers all three maps)

> Instrumental high-energy arcade battle loop. Chiptune meets synthwave: driving 16th-note saw bass, punchy
> gated-reverb drums, bright square-wave lead hook, detuned supersaw stabs on the off-beats, tight NES-style
> noise snare and hi-hats. Neon, pixelated, relentless — six players killing each other over berries in a hive
> arena. Minor key, aggressive but clean, lots of mid-range space so game sound effects cut through. 150 BPM, E
> minor, no vocals, no speech, no breakdown, no fade in or out. Constant intensity, built from repeating 8-bar
> phrases so it loops seamlessly. 80 seconds.

### 3. Victory sting — `victory.mp3`

> Instrumental arcade victory fanfare sting. Short and triumphant 16-bit chiptune: rising square-wave fanfare
> over bright major chords, punchy synth-brass stabs, a quick ascending arpeggio run, one big neon synth chord
> held at the end with a tight decay. Think a coin-op "you win" jingle crossed with retro synthwave. Confident,
> celebratory, not cheesy. 150 BPM, C major, no vocals, no speech, no long reverb tail. Starts immediately on the
> downbeat, resolves cleanly and stops. 6 seconds.

For `defeat.mp3`, run prompt 3 again with: _"…descending instead of rising, minor key, deflating — the same
arcade voice, but the run falls and lands on a held minor chord that sags. D minor. 6 seconds."_

## Checking it worked

1. Put the files in the folder and list them in `manifest.json`.
2. `pnpm build && pnpm dev`, open the game **without** `?mute` (music never starts under `?mute`, and `?mute`
   never writes a stored choice).
3. Press any key — the browser's autoplay unlock — and the lobby track should start. The header's `MUSIC` toggle
   turns it off and on, `SFX` does the same for the effects, and `SOUND OFF` silences everything.
4. Start a game: the lobby track should crossfade into the match track as the countdown runs, and duck for a
   moment under a kill or a Queen's death.
