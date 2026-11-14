# Fusemania: where lag comes from, and what the page can measure

A rhythm game has three clocks to line up: when the player **hears** the beat, when they **see** the arrow on its target, and when the game thinks they **pressed**. This note walks the chain from a finger to a judgment, says which parts the page measures, which it cannot, and how the game deals with each.

## The short answer

- **Key press detected until detected in game** is measurable and measured: the browser stamps the event (`event.timeStamp`), and the page records how long after that its listener ran and how long until the next frame. That delay does **not** move a judgment, because the judge uses the stamp, not the time the listener ran.
- **Before the browser's stamp** (the switch, USB or Bluetooth polling, the operating system) and **after the page hands over a frame or a sample** (compositor, display, Bluetooth audio the browser does not know about) cannot be seen from a page. They can only be measured through the player: by tapping to a click (**CALIBRATE**) or from the errors of a played song (the result's offer).
- So the design is: stamp everything on the audio clock, measure what is measurable, and fold everything else into one number per device, the **input offset**, which the game now offers to correct when a song shows a clear bias.

## The chain

| Stage                                                 | Typical size                                                                         | Seen by the page?                                 | What the game does                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key switch travel and debounce                        | 1 to 30 ms, fixed per keyboard                                                       | No                                                | Input offset                                                                                                                                                                                                                               |
| USB polling (125 Hz default, 1000 Hz gaming)          | 0 to 8 ms, or 0 to 1 ms                                                              | No                                                | Input offset (the average), jitter stays                                                                                                                                                                                                   |
| Bluetooth keyboard                                    | 7.5 to 30 ms connection interval, more when it sleeps                                | No                                                | Input offset, jitter stays                                                                                                                                                                                                                 |
| Operating system input queue to the browser           | around 1 ms, more under load                                                         | No (it is before the stamp on most browsers)      | Input offset                                                                                                                                                                                                                               |
| Touch: digitizer scan (60 to 240 Hz) and touch filter | 4 to 16 ms plus the system's processing; a finger also lands later than it "presses" | No                                                | Input offset; touch is its own device, so calibrate on it                                                                                                                                                                                  |
| **Browser stamp to listener** (main thread queue)     | under 1 ms idle; a long frame or a garbage collection adds its length                | **Yes**: `press > handler`                        | Nothing to correct: the judge uses `event.timeStamp`, so this delay does not reach the judgment                                                                                                                                            |
| **Listener to next frame**                            | 0 to one frame (16.7 ms at 60 Hz, 6.9 ms at 144 Hz)                                  | **Yes**: `press > frame`, `press > drawn`         | Only the flash is late, never the judgment                                                                                                                                                                                                 |
| Stamp on the page clock to the audio clock            | error under about 1 ms once settled                                                  | **Yes**: `audio clock jitter`, `audio clock step` | `song-clock.ts` keeps a smoothed `audio clock − performance.now()` and converts every stamp with it                                                                                                                                        |
| Audio: Web Audio graph (`baseLatency`)                | 3 to 12 ms                                                                           | **Yes**, as reported by the browser               | Included in `outputLatency` where reported; used as a fallback where not                                                                                                                                                                   |
| Audio: OS mixer and device (`outputLatency`)          | 5 to 40 ms wired; 100 to 300 ms Bluetooth                                            | **Partly**: only what the browser is told         | Taken off the song position, so arrows are drawn where the heard song is. Whatever the browser under-reports stays in the picture/sound relation (the visual offset) and in the input offset                                               |
| Frame handed over to light from the screen            | 1 to 3 frames of compositor and scan-out, plus the panel (TVs: 20 to 100 ms)         | No                                                | Visual offset (a setting; nothing measures it, the player judges by eye)                                                                                                                                                                   |
| The player                                            | people tap 10 to 50 ms **ahead** of a steady beat, some behind                       | Only through their hits                           | Input offset                                                                                                                                                                                                                               |
| Network (rooms)                                       | tens of ms                                                                           | Yes, and irrelevant                               | A press travels with its song time and is judged at that time on every device                                                                                                                                                              |
| Phone as a pad for the shared TV                      | the TV's audio and video delay plus the two devices' room-clock difference           | No                                                | The pad stamps taps with the room clock, since it makes no sound. Its input offset has to cover the TV; CALIBRATE on the phone does not measure that (the click comes from the phone), and the result's offer is not shown on a pad either |

### What `event.timeStamp` is

`event.timeStamp` is a time on the same clock as `performance.now()`. In Chromium and Firefox it is taken from the operating system's input event, before the event waits for the page's main thread, so it is the closest a page gets to the moment of the press. Browsers coarsen it (Chromium to 0.1 ms, Firefox and Safari to 1 ms; Firefox with fingerprinting resistance to much more), which is small beside a 22 ms Marvelous window. Safari's behaviour is the one I could not confirm from here: if a browser stamps at dispatch rather than at the OS event, `press > handler` reads near zero and the queueing delay moves, unseen, into the input offset.

The page never trusts a stamp blindly: one that is zero or more than half a second from now (a synthetic event, a browser that stamps on another clock) is replaced by the time the listener ran, and the probe counts those (`without a usable stamp`).

### Judging uses the stamp

This was already so before this note, and is now covered by the probe: `main.ts` converts `event.timeStamp` with `songClock.songMs(stamp)` (keys and touch pads alike), takes the input offset off, and logs the press with that song time. The fold judges at that time, not at the room tick and not at the time the listener ran. A frame that takes 40 ms therefore delays the flash by 40 ms and the judgment by nothing.

## Measuring it

Add `?latency` to a solo or room URL (for example `/fusemania/?solo=1&latency`) for an overlay, or call `fusemania.latency()` / `fusemania.latencyText()` in the console on any Fusemania room page. It reports p50, p95, p99 and the largest of the newest 600 samples:

| Line                   | Meaning                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `press > handler`      | Listener start minus `event.timeStamp`: the wait for the main thread                                        |
| `press > frame`        | Start of the next animation frame minus the stamp: the soonest the press can be drawn                       |
| `press > drawn`        | End of that frame's drawing minus the stamp: the picture is handed to the browser                           |
| `frame interval`       | Between animation frames: the display's refresh, and dropped frames in the tail                             |
| `frame work`           | Time the frame's own work took                                                                              |
| `frame start lag`      | Frame callback start minus the frame's timestamp                                                            |
| `audio clock jitter`   | Distance of each raw audio clock reading from the smoothed mapping stamps are converted with                |
| `audio clock step`     | The smallest step the audio clock was seen to take (one render quantum is 2.7 to 2.9 ms; some browsers 10+) |
| `audio base latency`   | `AudioContext.baseLatency`                                                                                  |
| `audio output latency` | `AudioContext.outputLatency`, or "not reported" (Safari, and any browser before its context has run)        |
| `hit error`            | This song so far: mean and scatter of the player's signed errors, the same numbers the result's offer uses  |

`scripts/fusemania-latency.ts` plays a song with real browser key events a chosen distance from every note and prints the overlay and the result's offer.

### Measured here

MEASURED

These are a cloud container's figures: no display, no audio device, and keys injected into the browser rather than typed. They show that the page's own share is small and that the stamp, not the handling time, carries the judgment. They say nothing about a keyboard, a screen or a pair of headphones; the overlay on the device in question does, for the rows it can see.

## What cannot be measured in software

- **Display latency.** No web API reports when a frame's light leaves the panel. `requestAnimationFrame` timestamps are the start of a frame, not its presentation. A phone camera filming the key and the screen is the cheap way; the visual offset is the knob.
- **Anything before the stamp**: switch, wireless link, USB polling, the OS.
- **Audio the browser is not told about.** `outputLatency` is the operating system's own estimate. It is usually right for wired output, often short for Bluetooth, and missing on Safari. HDMI to a TV or a soundbar adds delay nobody reports.
- **The player.** Anticipation is real, differs between people and changes with tempo and tiredness.

All four end up in the same place: the distance between when the game heard the beat and when it saw the press. That is one number per device and player, which is why the game measures it through the player.

## The result's offer

After a song played by ear, the result may say "You hit about 18 ms early on average (142 steps). Set the input offset to −18 ms?" with **APPLY** and **NO THANKS**. `src/app/timing-bias.ts` decides, from this device's own hit errors:

- **Enough data.** At least 40 hits after cutting outliers (a stray press near the wrong note lands far from the rest; anything beyond three standard deviations of the middle, measured robustly, is dropped). Steps played by a Star, and steps hit while an attack bends, hides or delays the arrows, are not counted.
- **Clear.** The mean error is at least 8 ms, at least three standard errors from zero, and the hits are not scattered wider than 50 ms.
- **Steady.** Both halves of the song lean the same way by at least 40% of the whole. A chart with one section out of sync, or one that drifts, fails this.
- **Not the chart.** Within one song, a chart that is 20 ms off looks exactly like a player who is. So each clear run is remembered per song (the newest six songs, a week, same reported audio latency). If another song agrees within 15 ms, the offer is the median of the songs that agree. If no song agrees and at least two others agree with each other, this chart is the odd one: the result says so and offers nothing. On the first song there is nothing to compare with, and the offer rests on that song alone.
- **Only by ear.** A muted page and a phone used as a pad play to another clock and are not measured.

The offer changes the input offset only when the player presses APPLY, and Settings shows the new value. Limits worth knowing: a lag so large that most presses miss (Bluetooth audio at 150 ms and more) leaves too few hits or a truncated picture, so use **CALIBRATE** first there; after switching audio devices the first song is treated as the odd one unless the browser reports the new device's latency, and the second song settles it.
