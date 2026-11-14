# Fuse Music

One catalogue and streaming player for every game. Effects remain with the game.

```ts
import { ALL_SONGS, MusicPlayer } from "fuse-music";

const player = MusicPlayer(ALL_SONGS, { base: import.meta.env.BASE_URL });
// Call from a user gesture; browsers can refuse autoplay.
player.play();
player.next();
player.pause();
```

`MusicPlayer()` defaults to `ALL_SONGS`, which contains all 18 shipped tracks.
Pass any `readonly Song[]` to choose a game's soundtrack, including new tracks
with stable ids, titles and site-root relative paths. No media element or song
request is created before playback. `muted: true` permanently silences a preview.

The player owns selection, streaming, volume, pause/resume, metadata-aware seeks,
advancing, retries and teardown. `createMedia` injects the browser boundary for
tests or another host. Richer radio UIs can supply `onEnded`, `onPause`, `onPlay`
and `retryOnGesture` to retain their own playlist and OS controls. The host owns
gesture listeners, persistent preferences and Media Session integration.

Every current game uses the full catalogue. The shared `fuse-ui` header provides
opt-in radio controls by default. A game can pass `music: chosenSongs` to
`createTopBar`, or `music: false` when supplying its own controls backed by this
player. Riders retains its playlist, resume positions and lock-screen controls;
Ball Bros and Choppers retain their own radio presentation. Hook Havok uses the
shared radio component directly. Other games' former background soundtracks are
disabled at their browser adapter so they do not overlap the common radio.
