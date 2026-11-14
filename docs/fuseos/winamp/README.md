# Winamp

Winamp on the desktop is [Webamp](https://github.com/captbaritone/webamp) by
Jordan Eldredge, MIT licensed, "a reimplementation of Winamp 2 in HTML5 and
JavaScript with full skin support". Its primary purpose, matching the rest of
this app, is playing audio `CogniteFile`s straight from CDF; it can also play
files the user picks from their own machine, which never leave the device.

## CDF audio is the primary path

An audio `CogniteFile` (`mimeType` one of `audio/mpeg`, `audio/mp4`,
`audio/ogg`, `audio/wav`, `audio/x-wav`, `audio/webm`, `audio/aac`,
`audio/flac`) opens in Winamp the way a P&ID opens in the File Viewer or a
text file opens in Notepad: on double click in Explorer, by name through the
agent's generic `open`, or through Winamp's own "Open from CDF..." dialog
(`src/services/audioFileService.ts` lists them, mirroring
`paintFileService.ts`'s `listImages`). Playing one resolves its download link
through the same `FileService.downloadUrl` (`POST /files/downloadlink`)
Notepad and the File Viewer already use, and hands the URL straight to
Webamp as a track — no vendoring, no proxy, no bytes touch this app's code.

This was verified live against `lervik-industries`: the project has one
`audio/mpeg` file today (space `ops_summaries_podcasts`, a `.mp3` podcast
recording; more are expected). Its download link resolves to
`https://api.cognitedata.com/api/v1/projects/.../files/gcs_proxy/...` — an
`*.cognitedata.com` origin, not a third-party storage host — signed with
`GoogleAccessId`/`Expires`/`Signature` query parameters and playable with
**no `Authorization` header**: an anonymous `GET` with `Range:
bytes=0-1023` returns `206 audio/mpeg`, and a `HEAD` returns `200` with
`Accept-Ranges: bytes` and `Access-Control-Allow-Origin: *`, so seeking
works. That is exactly what an `<audio>` element sends, and exactly why this
satisfies the CSP without a service worker or a proxy — see below.

Local files remain: "Open files..." still opens the browser's own `<input
type="file" accept="audio/*" multiple>`, for whenever a user has a file on
their own machine and not (yet) in CDF. The window says plainly that CDF
files stream from CDF while local files never leave the device. Local
playback is still Blob object URLs and is still subject to the `blob:`
`media-src` limitation this document originally recorded (below) — that risk
is not retired, only no longer the primary path.

## Expiring links

A CDF download link carries an `Expires` query parameter, so a playlist left
open for a long time will eventually see its link stop working, indistinguishable through Webamp's API from a genuinely broken file or a CSP
block. `useWinampViewModel` treats this as a first-class case: when a track
errors and it is CDF-backed, it re-resolves a fresh download link once and
retries by pointing the same `<audio>` element (reached via the failing
`error` event's `target`) at the new URL and calling `.play()` again, before
falling back to the Win98 message box. A retry that succeeds shows nothing
to the user; a retry that fails still reports the generic "blocked or failed
to load" message, never the CSP one, since an expired link is not a policy
violation.

## Why it needed no vendoring

Unlike the DOS games (`docs/games/README.md`) and the Office Assistant
(`docs/assistant/README.md`), Webamp needed nothing copied into `public/`:

- The `webamp` npm package (`node_modules/webamp/built/webamp.bundle.min.mjs`)
  ships as a single self-contained ES module with no runtime dependencies. It is
  imported the way `@cognite/reveal-widget` is (`src/App.tsx`, on first use, kept
  out of the main bundle by Vite's code splitting) rather than copied into
  `public/`, since it needs no separate asset files and no App Hosting upload
  extension workaround.
- The classic base skin (352 sprites) is embedded in the bundle as
  `data:image/png;base64` URIs; `LOAD_DEFAULT_SKIN` applies it directly with no
  network fetch. This app never sets `initialSkin`, so no skin is fetched at
  runtime.
- Playback hands Webamp a plain URL track either way: a `https://` CDF
  download link for a `CogniteFile`, or a Blob object URL
  (`src/winamp/useWinampViewModel.ts`) created from a file the user picks
  through an `<input type="file" accept="audio/*" multiple>`. Neither needs a
  service worker, a proxy or bytes passing through this app's own code.

## CSP check (`script-src 'self' 'wasm-unsafe-eval'`, no third party hosts)

Both the published npm bundle and this app's built `dist/assets/webamp.bundle.min-*.js`
were grepped for the patterns that have broken other vendored libraries here:

| Check | Result |
| --- | --- |
| `eval(` | None |
| `new Function(` | One, inside a bundled `setimmediate` polyfill's fallback branch (`typeof e !== 'function'` before calling it); every caller in the bundle passes a real function, so the branch is dead code |
| `new Worker(` / Blob-backed workers | None. jszip's internal streaming classes are named `*Worker` but are plain JS classes, not the browser `Worker` API |
| `data:application/wasm` | None; Webamp uses the Web Audio API and canvas 2D, no WebAssembly |
| Runtime `fetch`/XHR to a third party host | None reachable from this app's configuration: `fetch` only runs for an `initialSkin.url` (never set), a track's own `url` (a same-origin-policy-visible `https://*.cognitedata.com` CDF download link, or a `blob:` object URL for a local file — never a third party host), or a Butterchurn preset URL (Milkdrop is not enabled) |

The only third-party string left in the bundle is an "About Webamp" link to
`https://webamp.org/about`, a plain anchor a user can click; it is not fetched
or navigated to automatically.

## `media-src`: why CDF audio needed a manifest change and local files still don't work in production

`script-src` was the directive at risk from the code itself, and it is clean
(above). Playing a track is a different directive: Webamp loads audio through
a plain `<audio>` element (`this._audio.src = <url>`,
`createMediaElementSource(this._audio)` for the visualiser and EQ — confirmed
by grepping the bundle, not guessed), so a track's *load* is governed by the
browser's **`media-src`** directive, not `script-src`.

**The production baseline is `media-src 'self'`** (Cognite's CSP reference,
`docs.cognite.com/cdf/flows/reference/api/csp`). Unlike `img-src 'self' data:
blob:` and `worker-src 'self' blob:` — both of which is why this app's other
`blob:`/`data:` URLs already work (wallpapers, the File Viewer, Paint) —
`media-src` carries **no `blob:` and no `data:`**. A local file's `blob:` URL
handed to Webamp's `<audio>` element is exactly the kind of load `media-src
'self'` refuses; that risk is real and still open for local files (below).

**A CDF download link is different: it is a plain HTTPS URL on
`*.cognitedata.com`**, the exact source format the CSP reference documents as
accepted for an app-added rule (unlike `blob:` or `data:`, neither of which is
listed as accepted anywhere). `manifest.json` already granted
`https://*.cognitedata.com` to `img-src` (why CDF images already display in
this app); this PR adds the same source to `media-src`:

```json
{
  "manifestVersion": 1,
  "permissions": {
    "network": [
      { "sources": ["'wasm-unsafe-eval'"], "directives": ["script-src"] },
      { "sources": ["https://*.cognitedata.com"], "directives": ["img-src", "media-src"] }
    ]
  }
}
```

That is the whole fix: no service worker, no proxy, no vendoring. It could
not be verified against a live *deployment* (this app's own iframe headers
inside Fusion cannot be read without auth), but the CSP reference's own
"Source formats" section, read together with the confirmed download-link
shape above, makes this the documented, supported way to extend the policy —
unlike the `blob:` question below, which remains genuinely unresolved.

**Local files remain at risk in production, unmitigated.** Webamp's own
`error` handling on the `<audio>` element treats a blocked load exactly like
a track that finished playing (`this._emitter.trigger("ended")`, same as the
real `ended` event) — its public API (`onTrackDidChange`, `getMediaStatus`)
never surfaces a distinct error. Without instrumentation of its own, the
symptom is exactly what makes this dangerous: the player looks normal, "Open
files..." works, the track appears in the playlist, and pressing Play just
does nothing audible, with only a `media-src` violation in the browser
console (DevTools) to explain why.

`src/winamp/mediaErrorReporting.ts` listens for the two signals the browser
does give: a `securitypolicyviolation` report on `document` naming a
`media-src`-family directive (bubbles, and is definitive), and the `<audio>`
element's own `error` event caught in the capture phase on `window` (media
element errors do not bubble, so this is the only way to observe them from
outside Webamp). `useWinampViewModel` wires both into a Win98 message box
(`commands.showError('Winamp', ...)`) naming the blocked directive when it is
a CSP report, so a CSP block is never mistaken for a broken file — the player
fails loudly and correctly instead of sitting there silently. It does not,
and cannot, make a local track play; extending `media-src` to accept `blob:`
is not established as an accepted source format for an app-added rule (the
CSP reference does not list it), and reading files as `data:` URIs instead of
object URLs is not a safe fallback either, since `data:` sources are rejected
the same way. The most likely real fix, if this is ever prioritized: a
Service Worker that serves picked files from a same-origin path instead of a
`blob:` one (e.g. `/winamp-media/<id>`), which is a materially bigger change
than this feature and out of scope here — recorded as the candidate, not
built.

## Why the classic Win98 window chrome, not a chromeless skin

`WinampWindow` sits inside the same `WindowChrome` (title bar, minimize,
maximize, close, taskbar button) every other window uses, Webamp's own
skinned player mounted inside it — the same way DOOM's DOS screen or
Minesweeper's board sit inside a normal window. Dropping the outer chrome
would break drag, resize, minimize and the taskbar entry that FR-003 and
every other window kind rely on; Webamp's own title bar is part of the
Winamp skin, not a competing window frame, so the two nest the way a game's
own UI already does inside this app.

## Embedded player layout

The classic main transport, equalizer and playlist start stacked in a
275×348-pixel mount. Webamp centres the complete group before it renders;
a mount sized to the remaining height of a short outer window puts the
main panel above the scroll origin, where it cannot be reached. The mount
therefore keeps its intrinsic size even on a short viewport (the surrounding
panel scrolls), and the normal outer window is 320×470 including its file
controls. The skin owns the internal panel edges; a scoped reset removes
98.css padding and shadows from those internal panels only.
