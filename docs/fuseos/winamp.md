# Winamp

Winamp on the FuseOS desktop is [Webamp](https://github.com/captbaritone/webamp)
by Jordan Eldredge, MIT licensed, "a reimplementation of Winamp 2 in HTML5 and
JavaScript with full skin support". It opens with the Fuse soundtrack queued:
every piece of music the Fuse games ship as a file, one playlist, nothing
playing until the user presses something. It can also play files picked from the
user's own machine, which never leave the device.

Source: `packages/fuseos/src/winamp/`. The window is `WinampWindow.tsx` over
`useWinampViewModel.ts`; the catalogue is `fuseTracks.ts`.

## The Fuse soundtrack

`fuseTracks.ts` lists every file-backed track across the games, deduplicated by
file, with a title, the games that play it and its length in seconds. Winamp's
artist field is the game for a game's own song ("Fuseball - Neon Kickoff"). The
thirteen tracks of the shared catalogue are credited as "Fuse Radio", the name
every game that plays them gives it: their full credit ("Fuse Riders, Ball Bros,
Fuse Choppers, Hook Havok, Fuse Bombers") would push the title out of the 275px
playlist row, so it travels as the album instead (Media Session shows it). Twenty
tracks today:

| Where the files live                                     | Games                                                                                | Tracks                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/music/*.m4a` (`fuse-ui/assets` MUSIC_TRACKS)     | Fuse Riders, Ball Bros, Fuse Choppers, Hook Havok (all 13); Fuse Bombers (4 of them) | Pixel Sax Parade, Coin Op Swing, Arcade Adventure, Forest Job, Neon Grid Chase, Final Chase, Reduced Noise Orchestra, Midnight Run, Fast Frontier Run, Snaky Blue, Arcade Blues, Snabby Jazz, Snaky Jazz |
| `public/music/fuseball/*.mp3`                            | Fuseball                                                                             | Neon Kickoff, Gadget Overdrive, Sudden Death                                                                                                                                                             |
| `public/music/fuse-volley/*.mp3`                         | Fuse Volley                                                                          | Jelly Beach Bounce, Sandy Rally                                                                                                                                                                          |
| `games/killer-fuse/public/killer-fuse/audio/music/*.mp3` | Killer Fuse                                                                          | Match Day, Victory                                                                                                                                                                                       |

Games whose music is synthesised at runtime (Fuse Axe, Fuse Front, Fuse Freight,
Graveyard Shift, Fuse Craft, Killer Fuse's arena bed, Hook Havok's own cues)
have no file and are not in the playlist.

Paths are relative to the site base (`music/...`, `killer-fuse/audio/music/...`),
so the same catalogue works at `/`, under `/fuse-riders/` on Pages and at `./` in
a static preview: `fuseTrackUrl` prefixes Vite's `BASE_URL`, which reaches the
window through `WinampDeps.base`. A game's own `public/` folder is served at the
same URL in dev and in the build (`gamePublic` in `vite.config.ts`), which is why
Killer Fuse's files need no copying.

Each Webamp track carries `metaData` (artist, title) and `duration` up front.
Without them Webamp fetches part of each file to read its ID3 tags and measure
it, which for twenty tracks would be a burst of requests on every open. The
durations were measured once with ffprobe; to refresh one:

```sh
ffprobe -v error -show_entries format=duration -of csv=p=0 public/music/coin-op-swing.m4a
```

`tests/fuseos-music.test.ts` (node, `pnpm exec tsx --test tests/fuseos-music.test.ts`)
holds the catalogue to the repo: every audio file under `public/` (except the
retro games' bundles under `public/fuseos/`) and under every `games/*/public/`
must be listed exactly once, nothing listed may be missing, every credited game
must have a `portal.json` with the name the catalogue uses, and, where ffprobe is
installed, every duration must match its file to the second. A game that adds,
renames or drops a track fails that test until the catalogue follows.

## Playback rules

- Opening Winamp queues the soundtrack and stops there. Browsers block sound
  before a user gesture, and a desktop that starts singing on its own is not
  what anyone opened it for.
- **Fuse soundtrack** replaces whatever is queued with the catalogue and plays
  it from the top. It is a button press, so autoplay rules allow it. Local files
  leave the playlist and their object URLs are revoked.
- **Open files...** opens the browser's own `<input type="file" accept="audio/*"
multiple>`. The files join the end of the queue as Blob object URLs; the first
  of them starts unless something is already playing. Nothing is uploaded
  anywhere. Object URLs are revoked when the window closes.
- Closing the window disposes the player; reopening builds a fresh one with the
  soundtrack queued again. Webamp's own documentation says a full teardown is
  not possible, so this is as clean as it gets.
- Every open Winamp window publishes its transport in `WinampRegistryContext`
  (`winampControls.ts`): the Office Assistant's "play music" presses the same
  Play/Pause/Stop/Next/Previous a user sees and reads the queue by name
  ("Sandy Rally (Fuse Volley)").

## Errors

A track that fails to load looks identical through Webamp's API whether the file
is broken, missing or the browser refused it. `mediaErrorReporting.ts` listens
for the page's `securitypolicyviolation` events and media `error` events and the
view model shows one Win98 message box per failing track naming the likely
cause: a content security policy that does not allow `blob:` under `media-src`
for a local file, or a generic "blocked or failed to load" otherwise.

## Why Webamp needs no vendoring

The `webamp` npm package ships as one self-contained ES module with the classic
skin's sprites inlined as data URIs, so nothing is copied into `public/` and no
skin is fetched at runtime. `main.tsx` constructs it inside `WinampDeps.createPlayer`
through a dynamic `import("webamp")`, so its ~250 KB gzipped stays out of the
initial bundle until a Winamp window opens. The embedded layout
(`webampLayout.ts`) pins the main, equalizer and playlist panels in a 275x348
stack with hotkeys and double-size mode off, so the player never grabs the
desktop's keyboard.
