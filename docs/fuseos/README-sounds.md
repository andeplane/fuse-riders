# System sounds

FuseOS makes its noises itself: the start-up and shut-down chimes, the error chord, the ding, the Recycle Bin's crumple and the dial-up modem are synthesised in the browser with Web Audio from code in `packages/fuseos/src/sounds/synth/`, so nothing is downloaded for them and no licence applies. The floppy drive is the exception: a synthesised drive did not sound like one, so its two sounds ("Floppy drive", when Explorer opens A:, and "Open folder", one short seek for every other folder) are cut from a recording of a real drive dedicated to the public domain (CC0; source, author and the exact cuts in [licenses/FLOPPY-SOUND.md](licenses/FLOPPY-SOUND.md)). The clips (`src/assets/sounds/*.mp3`, 29 KB and 8 KB) are fetched the first time their sound plays, and the synthesised drive in `synth/floppy.ts` stands in when a clip cannot be fetched or decoded. The modem handshake follows the standards it imitates: a 350 + 440 Hz dial tone, DTMF digits for 555-FUSE, 440 + 480 Hz ringback, the V.8 answer tone (2100 Hz, amplitude modulated at 15 Hz, phase reversed every 450 ms) with the caller's V.21 call menu under it, V.34 INFO sequences and tones A/B, the 150 Hz-spaced line-probing comb, the PP sequence and scrambled training data that widens from a narrow band to the full 300–3400 Hz before the speaker cuts out on CONNECT. The floppy is a spindle rumble with a 250 Hz stepper pulse train (recalibration, seeks of random length, head-load clunks) and spin-down.

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
| `sounds/samples.ts`                                    | The recorded sounds: `sampleUrl(event)` and `createSampleLoader(fetch)`, the `loadSample` the service is given. The service tries the recording first and falls back to the synth.                                                            |
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

## Where the triggers are

| Trigger                                     | Where                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start-up, shut-down, wake-up                | `SystemSoundTriggers` in `Shell`.                                                                                                                                                                                                                                                                                                                     |
| Message boxes                               | `windows/MessageBox.tsx`: `error` for the warning icon, `ding` for info.                                                                                                                                                                                                                                                                              |
| Explorer opens 3½ Floppy (A:)               | `explorer/useExplorerViewModel.ts` plays `floppy` as the seek delay starts (`disk/floppySeek.ts`, 1.8 s). Explorer's own Web Audio seek from before this service existed is gone.                                                                                                                                                                     |
| Explorer opens any other folder or drive    | The same view model plays `seek`.                                                                                                                                                                                                                                                                                                                     |
| The Recycle Bin empties or deletes          | `recycle`, once the confirmation is answered Yes: `recyclebin/useRecycleBinViewModel.ts` and the desktop icon's Empty Recycle Bin.                                                                                                                                                                                                                    |
| Network Neighborhood or Fuse Messenger open | `sounds/dialup/useDialUpCommands.ts`: window commands whose `open` puts the Connect To dialog in front until the session has connected. Used by the Start menu, the desktop icon, the tray, Fusteam's tabs and Run. A window of the program already open is only focused, and deep links and restored windows open directly, so a reload never dials. |

Adding a sound is one catalogue entry in `soundEvents.ts`, one renderer in `synth/` and one `case` in `synth/index.ts`; the applet, the prefs and the service pick it up. A recording for it is one more line in `samples.ts`, with its licence recorded under `docs/fuseos/licenses/`.
