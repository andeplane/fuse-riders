# System sounds

FuseOS makes its noises itself. Every sound (the start-up and shut-down chimes, the error chord, the ding, the Recycle Bin's crumple, the floppy drive and the dial-up modem) is synthesised in the browser with Web Audio from code in `packages/fuseos/src/sounds/synth/`; there are no recordings, so nothing is downloaded and no licence applies. The modem handshake follows the standards it imitates: a 350 + 440 Hz dial tone, DTMF digits for 555-FUSE, 440 + 480 Hz ringback, the V.8 answer tone (2100 Hz, amplitude modulated at 15 Hz, phase reversed every 450 ms) with the caller's V.21 call menu under it, V.34 INFO sequences and tones A/B, the 150 Hz-spaced line-probing comb, the PP sequence and scrambled training data that widens from a narrow band to the full 300–3400 Hz before the speaker cuts out on CONNECT. The floppy is a spindle rumble with a 250 Hz stepper pulse train (recalibration, seeks of random length, head-load clunks) and spin-down.

## Hearing them outside the browser

```sh
pnpm exec tsx scripts/fuseos/render-sounds.ts <out-dir> [event ...]
```

writes `<out-dir>/<event>.wav` (16-bit mono, 44.1 kHz) with the same code the desktop runs.

## Architecture

| File                                                   | Role                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sounds/soundEvents.ts`                                | `SystemSoundEvent` and the catalogue `SOUND_EVENTS` (label, description, gain, where the trigger lives).                                                                                                                                      |
| `sounds/synth/*.ts`                                    | Pure, deterministic renderers `(sampleRate) => Float32Array` plus the PCM helpers (`pcm.ts`), `encodeWav` and `modemTimeline.ts`, the handshake's moments shared with the dialog. `synth/index.ts` imports each renderer lazily on first use. |
| `sounds/soundService.ts`                               | `SoundService` (play/stopAll/isEnabled/prefs/subscribe), `WebAudioSoundService` over a narrow `SoundAudioContext` slice of Web Audio, `SilentSoundService` and `documentGestures`.                                                            |
| `sounds/soundPrefsStore.ts`                            | `SoundPrefs` (`master` and per-event toggles) in `localStorage` under `fuseos.sounds`; `MemorySoundPrefsStore` for tests.                                                                                                                     |
| `sounds/soundContext.ts`, `sounds/useSystemSound.ts`   | `SoundServiceContext` (default silent; `main.tsx` provides the real one), `useSoundService`, `usePlaySystemSound`, `useSoundPrefs`.                                                                                                           |
| `sounds/SystemSoundTriggers.tsx`                       | Mounted by `Shell`: start-up chime on mount and on wake-up, shut-down chime on Shut Down.                                                                                                                                                     |
| `sounds/dialup/*`                                      | Dial-Up Networking: `DialUpWindow` (window kind `dialup`), its view model, `DialUpSession` (once per page load) and `withDialUp()`.                                                                                                           |
| `controlpanel/SoundsApplet.tsx`                        | Control Panel > Sounds: master switch, per-event toggles, Play and Stop.                                                                                                                                                                      |
| `__mocks__/soundService.ts`, `__mocks__/dialUpDeps.ts` | `FakeSoundService` (records plays, handles can be stopped) and `ManualScheduler`; `renderWithProviders` installs both (`sounds`, `dialUpSession`, `dialUpDeps` options).                                                                      |

### Autoplay and `?mute`

Browsers refuse audio until the page has seen a click, key press or touch. `WebAudioSoundService` creates its `AudioContext` only after `documentGestures(window)` reports one; a sound requested before that is dropped, except those whose catalogue entry sets `deferUntilUnlocked` (the start-up chime), which play on that first gesture. The OS's `?mute` flag (read once in `main.tsx`, the same one the games get) makes the service `muted`: nothing sounds, the applet says why and its controls are locked.

### Playing a sound

```ts
const playSystemSound = usePlaySystemSound();
playSystemSound("floppy");
const modem = playSystemSound("modem");
modem.stop(); // cut it short
await modem.finished;
```

`play` never throws or blocks. The handle's `audible` is false when nothing will be heard (muted, switched off, not unlocked), which the dial-up dialog uses to run its status lines quickly instead of waiting fifteen silent seconds. `{ force: true }` bypasses the event's toggle (the applet's Play button), never the master switch or `?mute`.

### Dial-Up Networking

`withDialUp(content, session)` returns `{ kind: "dialup", then: content }` while the session is offline and `content` itself once it has connected (or the user pressed Cancel: the gag never blocks anything). The dialog plays the modem, shows "Dialing 555-FUSE...", "Ringing...", "Verifying user name and password...", "Negotiating connection speed...", "Logging on to network..." and "Connected at 56,000 bps" in time with the sound (`MODEM_PHASES`), then closes and opens `then`. Start > Programs > Accessories > Dial-Up Networking opens it with no `then`.

## Integrator checklist: wiring the triggers

Already wired on this branch: start-up, shut-down and wake-up (`SystemSoundTriggers` in `Shell`), message boxes (`windows/MessageBox.tsx` plays `error` for the warning icon and `ding` for info), Dial-Up Networking in the Start menu, the Sounds applet. Still to wire when the apps land:

| Trigger                                         | Call                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explorer (B11) opens a folder or drive          | `playSystemSound("floppy")` in the navigation handler. For 3½ Floppy (A:) play it before the joke delay so the delay has a reason.                                                                                                                                                   |
| Network Neighborhood (D4) and Friends (D5) open | `commands.open(withDialUp(content, useContext(DialUpSessionContext)))` instead of `commands.open(content)`, so the first open per page load dials in. Any deep link or restored window of those kinds should open directly (the session is new, but nobody wants a modem on reload). |
| Recycle Bin (D2) empties or deletes             | `playSystemSound("recycle")`.                                                                                                                                                                                                                                                        |
| Any new error or info dialog                    | Nothing: every `dialog` window goes through `MessageBox`.                                                                                                                                                                                                                            |

Adding a sound is one catalogue entry in `soundEvents.ts`, one renderer in `synth/` and one `case` in `synth/index.ts`; the applet, the prefs and the service pick it up.
