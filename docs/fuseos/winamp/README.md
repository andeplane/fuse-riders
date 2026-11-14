# Winamp

Winamp on the FuseOS desktop is [Webamp](https://github.com/captbaritone/webamp)
by Jordan Eldredge, MIT licensed, "a reimplementation of Winamp 2 in HTML5 and
JavaScript with full skin support". It is pinned to 2.3.1 because the typed
`__customMediaClass` extension the adapter relies on is marked private.

## What it plays

- **Local files.** "Open files..." opens the browser's own
  `<input type="file" accept="audio/*" multiple>`; each file becomes a Blob
  object URL handed to Webamp as a track. Nothing leaves the device and nothing
  is stored: a reload forgets the playlist.
- **The Fuse soundtrack.** The games' own music under `public/music` (Fuse
  Riders Radio and the other games' tracks) is catalogued in
  `packages/fuseos/src/winamp/fuseTracks.ts` and loaded as Webamp's initial
  tracks; that catalogue and its "Fuse soundtrack" button are the Winamp
  package's (`docs/fuseos/winamp.md` once it lands). Until then the window opens
  with an empty playlist and local files only.

Webamp ships its own React and the classic skin inlined, so it is loaded only
when a Winamp window opens (`await import("webamp")` in
`packages/fuseos/src/main.tsx`); the desktop's initial bundle never carries it.

## How it is wired

- `webampPlayer.ts` wraps the Webamp instance behind the `WebampPlayer`
  interface the window uses; `__mocks__/webampPlayer.ts` is the fake the tests
  drive.
- `webampLayout.ts` holds `WEBAMP_EMBED_OPTIONS`: the main, equalizer and
  playlist windows stacked at 275x348, with the window frame sized to fit
  (`WINAMP_WINDOW_SIZE` in `desktop/windowMeta.ts`).
- `mediaErrorReporting.ts` tells a track the browser refused to load from a
  track that failed for an unknown reason, so the window can say why.
- `winampRegistryContext.ts` registers each open Winamp's controls so Clippy's
  "play music" can reach them.

Hiding the page pauses playback, as the browser does for any media element.
