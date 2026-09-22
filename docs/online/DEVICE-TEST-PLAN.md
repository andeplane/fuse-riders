# Real-device test plan (#17)

This is a **manual test plan**, not a result. Following it does not itself
qualify anything; only a completed run with recorded evidence does. It covers
the physical-phone confirmation still owed for #15 (dropped touch inputs,
fixed in #38), #13 (one control rendering in every phase, fixed in #41/#34),
#14 (long-press text selection, fixed in #34) and #12 (cellular guest direct
link, fixed in #39), plus the standing qualification issues #4 (landscape
controls and menus) and #5 (Wi-Fi/WAN latency and phone lifecycle recovery).
All six referenced issues stayed open or `Refs`, not `Closes`, specifically
because the automated evidence in their PRs is browser emulation or a
same-machine harness, not a physical device on a real network. See
`AGENTS.md` → "Network and release evidence": never claim mobile acceptance
from smoke tests, keep p95/p99/max distributions rather than single samples,
and keep simulated impairment evidence separate from real-network evidence.

## Scope

In scope: the six issues above, tested against the deployed public release at
a fresh room each time. Out of scope: writing new code or scripts (docs
only — if a defect is found, file a new issue with reproduction steps and
link it from the recorded results; do not fix it as part of running this
plan), Cloudflare/local-Worker testing (its LAN docs went with the LAN
server in #271),
five-player sustained soak content already covered by
[NETWORK-HARNESS.md](NETWORK-HARNESS.md) and
[RESPONSE-BENCHMARK.md](RESPONSE-BENCHMARK.md) on desktop browsers.

## Prerequisites

- **Public URL**: <https://andeplane.github.io/fuse-riders/>. Immediately
  before each test session, fetch
  `https://andeplane.github.io/fuse-riders/release.json` and record
  `gitRevision`, `verifiedCiRun`, `apiOrigin` and `builtAt` — this is the
  build under test, not whatever commit is currently on `main`. Cross-check
  against [ROADMAP.md](ROADMAP.md) / [PUBLIC-BETA-2026-09-14.md](PUBLIC-BETA-2026-09-14.md)
  for the latest verified runtime before assuming a mismatch is a regression.
- **A fresh room per test.** Create a new room for every numbered procedure
  below; do not reuse a room across sections or across the qualification
  matrix. Never run these tests against a room someone else is actually
  playing in.
- **Devices**: at minimum one iPhone running Safari and one Android phone
  running Chrome, plus the host laptop (any modern desktop Chrome/WebKit
  build). Record exact device model and OS/browser version for every device
  used in a session (Settings → About, and the browser's own version/About
  page) — "an iPhone" is not sufficient.
- **Networks**: three link configurations are needed across the plan —
  (a) host and guest phone on the **same Wi-Fi**, (b) host on **home Wi-Fi**
  with the guest phone on **guest cellular (5G/LTE, Wi-Fi off)**, and
  (c) host on one Wi-Fi network with the guest phone on **a different Wi-Fi
  network** (e.g. a neighbor's or a mobile hotspot, not the host's own SSID).
  Record which of (a)/(b)/(c) each run used; several sections below specify
  which configuration applies.
- The LAN game this item once protected (`/display`, `/controller`) was removed
  in #271; every run here is an online room.

## Recording location

Record one Markdown file per test session at
`docs/online/device-evidence/<date>-<issue>.md` (for example
`docs/online/device-evidence/2026-09-20-issue-15.md`), following the
[recording template](#recording-template) below. Save screenshots alongside
it as `docs/online/device-evidence/<date>-<issue>-<device>-<label>.png` and
link them from the Markdown file, the way
[PUBLIC-ACCEPTANCE.md](PUBLIC-ACCEPTANCE.md) and
[HOME-MOBILE-ACCEPTANCE.md](HOME-MOBILE-ACCEPTANCE.md) link their screenshots
and raw JSON rather than inlining them. If several issues are tested in one
sitting (e.g. #13/#14/#4 on the same phones back to back), one file covering
all of them is fine — name it for the primary issue and cross-reference the
others in its front matter. Do not overwrite a prior evidence file; each
dated run is additive history, the same way `RESPONSE-BENCHMARK.md` keeps
every trial rather than only the latest.

---

## #15 — Dropped touch inputs

> `scripts/input-drop-probe.ts` was removed with the host-star runtime. In the peer-to-peer runtime an input is a log entry the phone itself folds on the next tick; run `scripts/p2p-measure.ts` for scripted input-to-state latencies and read a physical phone's `artifacts/telemetry/<ROOM>.ndjson` (posted while `pnpm dev` serves the room) with `scripts/telemetry-report.ts`.

Fixed in #38 for the synthetic case: `scripts/input-drop-probe.ts` measured
98.1% of playing-phase inputs rejected locally before the fix and 0.98% after
(60 s, 100–300 ms late snapshots, a frozen tab). That harness explicitly
cannot see phone-side local rejections — "only the phone's visible shot
notices and steering are" observable to it — so the real-device gap is a
human watching a physical phone's own inputs land.

**Devices/network**: one phone as host on home Wi-Fi, laptop as instrumented
guest on the same Wi-Fi (network configuration (a)). Repeat once with the
phone as guest instead, laptop as host.

**Steps**:

1. Host a fresh room from the phone at the public URL (or join as guest for
   the repeat run). Note the room code.
2. Join from the phone at the deployed URL and start the race once the
   laptop's guest has joined. **Not currently runnable as first written:**
   this step served the room from the laptop with `pnpm dev`, joined from
   the phone over the LAN address and let the dev server record every
   device's telemetry. Since #271 the dev service is loopback-only, so a
   phone cannot reach it, and no `/telemetry` receiver exists on the dev
   service or the deployed site, so `?telemetry=1` posts are not recorded.
3. For about 60 s, physically operate the phone: hold
   left/right steer continuously across direction changes, fire repeatedly
   including while steering, and charge-and-release a bomb a few times. Count
   your own button presses and, independently, count visible responses
   (steering change, shot fired, bomb notice) — do this for at least 50
   discrete presses total.
4. Save `artifacts/telemetry/<ROOM>.ndjson` and the output of
   `pnpm exec tsx scripts/telemetry-report.ts artifacts/telemetry/<ROOM>.ndjson`
   into the evidence folder: inputs, rollbacks, gaps and status changes per
   device. **Not currently runnable:** nothing writes that file since #271
   (see step 2); record the manual tally and the probe JSON instead.

**Capture**: revision, both device models/OS/browser versions, the saved
probe JSON (laptop-guest-side local-rejection percentage and fire-edge
counts), and your manual press/response tally with any specific presses that
visibly did not register (screenshot or timestamp them if possible).

**Pass/fail**: the probe's own regression threshold is ≤2% locally-rejected
playing-phase inputs (`PROBE_MAX_LOCAL_REJECT_PCT`, default 2) — use that as
the laptop-side pass bar. For the phone's own presses, the manual tally must
show ≤2% of counted presses with no visible response, consistent with the
fixed 0.98%/92-of-93-fire-edges result recorded on #15; any higher rate is a
fail and needs a new issue with the press count, timing and screenshots.

---

## #13 / #134 — Phone lobby screen, then one controller in every play phase

#134 replaced the lobby half of #13: on a phone the **lobby** is a plain
screen (room code with join link and QR, riders, and for the host START
RACE / ADD AI / ROOM SETTINGS — no TV VIEW, a phone is never the TV — with
READY and this rider's own NAME / AVATAR / COLOUR / SWAP TO SPECTATOR beside
it, since the room seats a creator on arrival) in either orientation, with no
rotate gate and one ROOM button. It is the desktop lobby stacked (headline,
QR card, riders, actions) rather than a card of its own. From **countdown** through **matchOver** `mobilePlayPolicy` is
active: the full-screen thirds are the only controller and roster/host
actions live inside the ☰ MENU overlay, auto-opened for a phone host when
the recap opens at the end of matchOver (the pause before it shows the final
round's result, then the match winner, on the arena). `scripts/mobile-phase-smoke.ts` asserts the lobby screen in
both orientations and identical control elements across `countdown`,
`playing`, `matchOver` in Chrome/WebKit emulation only; the music resume on
a real iPhone (#134 finding 1) is not covered by emulation at all.

**Devices/network**: iPhone Safari and Android Chrome, either network
configuration (a) is fine — this section is about rendering, not link
quality.

**Steps**:

1. Start music on the landing page, then CREATE ROOM on the phone
   (portrait). Confirm music resumes on the first tap on the room page
   (any tap, not only SETTINGS → ♫ RADIO), continuing the same track.
2. In the **lobby** screenshot the phone: one ROOM button, the room code
   with COPY LINK and a QR, "0 riders ready", and — without scrolling inside any
   strip — START RACE, ROOM SETTINGS and ADD AI reachable by normal page
   scrolling, and no TV VIEW button. No "Rotate your phone" gate.
3. Rotate to landscape and back: the same lobby screen both times, nothing
   hidden — the phone is already seated, so confirm its own row is in the
   roster and that AVATAR and COLOUR change it. Then add an AI opponent and
   set a short match length so a match can complete quickly.
4. Start the race; screenshot during **countdown**. Portrait shows the complete
   arena rotated 90°, with upright avatars/labels and bottom touch thirds;
   landscape keeps full-screen thirds. The ☰ MENU pill stays accessible in
   both, with hint labels visible and fading per the design (compare against
   [#14](#14--long-press-text-selection) hint-fade note below).
5. Screenshot during **playing**. Confirm identical positions/sizes to the
   countdown screenshot (same thirds, same pill).
6. Let the match reach **matchOver** and wait for the recap (the final
   round's result, then the match winner, show first); close it and
   screenshot. Confirm exactly one
   control surface, the ☰ MENU overlay auto-opened for the phone host with
   REMATCH, BACK TO LOBBY, ROOM SETTINGS, TV VIEW and ADD AI all readable (none
   clipped), and that rotating keeps the overlay open.
7. BACK TO LOBBY returns to the lobby screen of step 2. Leaving the room entirely is ROOM → LEAVE ROOM — behind ☰ MENU while the phone is the controller, and on the lobby screen either in the header or, where the viewport is too short for the header to spend two rows on buttons (a phone held sideways), behind that screen's own ☰ MENU. The room keeps running for whoever stays, and the rider in the next seat takes over as host; END ROOM, under it and only on the creator's device, closes the room for everyone.

**Capture**: revision, device/OS/browser, one screenshot per phase (lobby
portrait + landscape, countdown, playing, matchOver), and a short note of
any phase where a second control element appeared, an action was clipped
or unreachable, or rotating changed which screen was shown.

**Pass/fail**: the lobby must be the same screen in both orientations with
every host action reachable and one menu; from countdown on, the
full-screen thirds must be the only controller with roster/host actions
confined to the ☰ MENU overlay. Music that stays silent after a tap on the
room page, a rotate gate in the lobby, a duplicate menu button, a clipped
action strip, or a phase where the phone reverts to a non-full-screen
layout is a fail — file a new issue with the phase, screenshot and device.

---

## #14 — Long-press text selection

Fixed in #34: hint labels became `::before content:attr(data-hint)` (no text
node), with `user-select`/`-webkit-user-select`/`-webkit-touch-callout`/
`touch-action: none` on the touch zones, labels, rotate gate and MENU pill,
plus `selectstart`/`contextmenu` prevention while `.mobile-play` is active.
`scripts/mobile-landscape-smoke.ts` asserts this with a 650 ms **CDP**
synthetic touch per third in Chromium — not a real touchscreen gesture, and
WebKit's own long-press/callout behavior is emulator-only there too.
The smoke records the hold result inside the page and retries only when a
benchmark snapshot proves the round phase changed during the attempt. It
requires a complete 650 ms hold within one playing phase for every third;
a lost hold in a stable phase or any selected text remains a failure.
Run `MOBILE_HOLD_PHASE_RACE=1 HOME_URL=http://localhost:8787/ pnpm exec tsx scripts/mobile-landscape-smoke.ts`
to force the first gesture to span a real round transition and verify that
it is retried before a complete hold passes in both engines.

**Devices/network**: iPhone Safari (WebKit's real long-press gesture is the
primary risk named in #14's own root-cause note) and Android Chrome. Either
network configuration is fine.

**Steps**:

1. Join a fresh room as a phone player in landscape.
2. On each of the three touch thirds, press and hold with a real finger for
   at least one second (long enough to trigger iOS's native selection/
   "Look Up" gesture and Android's native selection handles if unprotected).
   Confirm: no text selection highlight appears, no "Copy"/"Look Up"/"Share"
   context menu opens, and the third still shows the held/active visual
   state throughout.
3. Long-press directly on a hint label (the on-screen `steer`/`fire`/etc.
   text), the ☰ MENU pill, and the rotate-gate message (rotate the phone to
   portrait to see it) — same checks.
4. Try a two-finger long-press and a slow drag-then-hold on a third to probe
   for edge cases the synthetic CDP touch in the smoke test doesn't exercise.
5. Screenshot mid-long-press on at least one third per device (even though a
   selection should not appear, the screenshot documents the attempt).

**Capture**: revision, device/OS/browser (iOS Safari version specifically —
`-webkit-touch-callout` behavior has shifted across iOS releases), and for
each element tested: whether a selection/context menu appeared (yes/no) and
a screenshot.

**Pass/fail**: per #14's fix description, no long-press anywhere on the
`.mobile-play` surface may select text or open Copy/Look Up/Share. Any
selection highlight or native context menu appearing is a fail — file a new
issue naming the exact element, device, OS version and gesture.

---

## #12 — Cellular guest direct link

Fixed in #39: STUN-race and buffering defects, a second STUN server, bounded
ICE restarts, and a ROOM → LINK DIAGNOSTICS panel that reports _why_ a link
is not connected. #39's own "what the real test should show now" section
predicts the header/diagnostics text below; nothing in that PR was verified
against a real cellular guest — that verification is this section.

**Devices/network**: host phone (or laptop) on home Wi-Fi; guest phone on
**guest cellular** (Wi-Fi off) — network configuration (b). Repeat with the
guest phone on **a different Wi-Fi network** — configuration (c) — since #12
and #39 both note symmetric NAT/CGNAT is common on cellular specifically and
a second Wi-Fi network isolates that variable.

**Steps**:

1. Host a fresh room on Wi-Fi. Send the invite link to the guest phone over
   a channel that does not depend on the link under test (SMS, AirDrop
   beforehand, etc.).
2. On the guest phone, disable Wi-Fi and confirm cellular data is active,
   then open the invite link.
3. Watch the guest's header for up to 30 seconds. Record the exact text —
   either `Connected · direct game link`, or
   `Waiting for direct connection — <reason>` / `Direct connection interrupted — <reason>`.
4. On **both** host and guest, open ☰ MENU → ROOM → LINK DIAGNOSTICS and copy the
   full panel text verbatim (it is pre-formatted, redacted text — candidate
   types/states/counts, never addresses). Do this once at first render and
   again after ~15 seconds if the link is still not healthy, since restarts
   and candidate exchange are asynchronous.
5. If connected, confirm the selected pair line reads `srflx→srflx/udp` (or
   `prflx`), not `host→host`, since a real cross-network link cannot use
   host candidates.
6. If not connected, let it run until the panel reports exhausted restarts
   (`restarts 4/4 (exhausted)`) or a clear reason, rather than stopping
   early — the reason line is the actual evidence.
7. Start a race and confirm actual gameplay (steering/shots) reaches the
   guest, not just a "connected" status — a healthy-looking link with no
   application traffic is itself a defect to report.
8. Repeat steps 1–7 with the guest on a different Wi-Fi network instead of
   cellular.

**Capture**: revision, both devices/OS/browser, the header status text at
first render and at ~15s, the full verbatim LINK DIAGNOSTICS text from both
host and guest, and whether gameplay actually flowed once "connected."

**Pass/fail** (from #39): success is a `srflx→srflx/udp` (or `prflx`)
selected pair with working gameplay. A `candidates exchanged, ICE failed —
likely symmetric NAT/CGNAT on one side` result after restarts are exhausted
is a **known, documented limitation** (no TURN, per ADR035) — record it as
such, not as a new defect, unless the _host's_ Wi-Fi also fails this way
(which would mean host-side STUN reachability is broken, a genuine fail). A
result where either device shows only `local host×N` with no `srflx` is a
fail specific to that device's network reaching STUN (UDP blocked) and
should be re-tried on a different network before filing. A stuck
"Waiting for direct connection" with no reason text, or a healthy-looking
link that never carries gameplay, is a fail regardless of NAT type.

---

## #4 — Landscape controls and menus qualification

#4's acceptance text lists a specific checklist to verify on real iOS Safari
and Android Chrome: portrait-to-landscape transition, browser bars/safe
areas, full available-height board, three equal touch zones, shared-TV
controller colors, hint fade, slide-in presses, simultaneous steer/fire,
target aiming, pointer cancellation, no long-press selection (see
[#14](#14--long-press-text-selection) above — do not re-derive that finding
here, just confirm it holds on these specific devices), Room/Audio/Avatar/
Settings/Close reachability, and desktop keyboard (arrows/A-D/Space) with a
phone guest connected.

**Devices/network**: iPhone Safari and Android Chrome for the phone side;
any desktop Chrome/WebKit for the keyboard check. Network configuration (a)
is sufficient — this section is a UI/input qualification, not a link-quality
test (see #12/#5 for that).

**Steps** (repeat the whole sequence once per phone):

1. Open the public URL in **portrait**. Screenshot. Rotate to **landscape**
   and confirm the transition happens cleanly (no stuck rotate-gate, no
   dropped input from the transition) and the board uses the full available
   height inside the browser chrome/safe areas — screenshot landscape too,
   including the very top/bottom edges so browser bar overlap is visible.
2. Confirm the three touch zones are visually equal width and each spans
   the full playable height (compare against `mobile-landscape-smoke.ts`'s
   own assertion that each third is `844/3` CSS pixels wide and full height
   at 844×390 — your device's physical dimensions will differ but the
   proportions should not).
3. On a shared-TV setup (host phone with a second device or the host
   laptop as `?display=1`), confirm the TV's controller-color cues match the
   phone's.
4. Watch a hint label from appearance through its fade — confirm it fades
   fully (compare to the 3-second fade timing exercised in the smoke test)
   and restarts on the next countdown, per #13's fix.
5. Press each third with a genuine slide-in gesture (finger lands outside
   the control and slides onto it) — confirm it registers as a press. Then
   hold two thirds simultaneously (steer + fire) and confirm both act
   independently. Then aim/fire and drag off the target before releasing —
   confirm pointer cancellation does not leave a stuck "active" visual state.
6. Long-press once more here specifically to reconfirm #14 holds on this
   exact device/OS build; do not treat this as new evidence for #14 if
   already tested this session — one line noting "reconfirmed, see [date]
   #14 evidence" is enough.
7. Open ☰ MENU and confirm Room, Audio, Avatar, Settings and
   Close are all reachable and tappable without scrolling or overlap, at
   this device's actual landscape height.
8. On the desktop host, with the phone as a connected guest, use arrow
   keys, A/D, and Space to steer/fire from the keyboard; confirm the same
   responsiveness as pointer input and that the phone guest's own controls
   are unaffected.

**Capture**: revision, both devices/OS/browser versions, portrait and
landscape screenshots, notes on any safe-area/browser-chrome overlap, and a
line per checklist item (pass/fail/note) — do not just write one aggregate
"passed."

**Pass/fail**: #4 asks that every item in the list above hold on real
devices; any single item failing (visual glitch, missed press, stuck active
state, unreachable menu item, keyboard input not registering) is a fail for
that item specifically — file it as its own issue with the reproduction
device/gesture, don't block the rest of the checklist on it.

---

## #5 — Wi-Fi/WAN latency and phone lifecycle recovery

#5 asks for real shared-Wi-Fi and separate-network measurement of selected
WebRTC candidate route, touch-to-photon latency, frame times, correction
tails, reconnect downtime and host background/refresh/duplicate-tab
behavior, with revision/devices/seeds/p95/p99/max retained — explicitly not
a repeat of the existing simulated [NETWORK-HARNESS.md](NETWORK-HARNESS.md)
batches or the desktop-only [RESPONSE-BENCHMARK.md](RESPONSE-BENCHMARK.md)
result (local p95 27.6 ms / TV p95 88.2 ms are simulated/local-machine
numbers — keep them referenced, not restated, and do not present them as
real-network evidence).

**Devices/network**: at least one phone plus the host laptop, using both
configuration (a) same-Wi-Fi and configuration (c) host-Wi-Fi/guest-different-
Wi-Fi (a genuine WAN hop). A TV-equivalent view (second laptop or the host
phone's own shared-TV mode) if available, per #5's "five players plus TV"
framing — a smaller session is acceptable evidence as long as it's recorded
as smaller than #5's full ask, not silently substituted for it.

**Steps**:

1. Record the candidate route: ☰ MENU → ROOM → LINK DIAGNOSTICS `selected` pair on
   each device, per the [#12](#12--cellular-guest-direct-link) capture
   method.
2. Touch-to-photon latency has no in-repo phone instrumentation (the
   `RESPONSE-BENCHMARK.md` numbers are desktop CPU-timestamp measurements,
   not physical touch/photon). Approximate it manually: film the phone
   screen and your finger together at 120/240 fps (most phone cameras
   support this in a "Slo-Mo" mode) while pressing a steer button, then
   count frames between finger-contact and the on-screen visual response.
   Report this explicitly as a **manual slow-motion approximation, not an
   instrumented measurement** — do not present a frame count as equivalent
   to the desktop p95/p99 figures elsewhere in this repo.
3. Frame times: watch for visible stutter during normal play; there is no
   phone-side frame-time capture script, so this is a qualitative note
   (smooth / occasional stutter / frequent stutter) plus a screen recording
   if stutter is seen.
4. Correction tails: watch for visible rubber-banding/snapping of your own
   rider or others' after a steering input, especially on the WAN
   configuration; note frequency and severity.
5. Reconnect downtime: put the guest phone in airplane mode for ~5 seconds
   mid-race, then restore connectivity. Time from restoration to the guest's
   header showing `Connected` again and to gameplay resuming; repeat 3
   times and report each downtime plus min/median/max (not just one sample,
   per `AGENTS.md`'s "a single latest metric is insufficient").
6. Host background/refresh/duplicate-tab: as the phone **host**, (a) switch
   to another app for 10 seconds and return — confirm the game either
   pauses/resumes cleanly or shows an explicit suspended state, never a
   silent frozen game; (b) refresh the host's browser tab mid-lobby (not
   mid-race, to avoid disrupting a live match unexpectedly) and confirm
   settings/room state restore as documented in
   [HOME-MOBILE-ACCEPTANCE.md](HOME-MOBILE-ACCEPTANCE.md); (c) open the same
   invite URL in a second tab/duplicate the host session and confirm the
   product's actual behavior (reject, replace, or explicit conflict state)
   rather than two silently-diverging hosts — record whatever it actually
   does, since this is unverified per [ROADMAP.md](ROADMAP.md)'s "Sustained
   duplicate-tab, lifecycle and network partitions on the deployed service"
   row.

**Capture**: revision, all device models/OS/browser versions, network
configuration used per step, the LINK DIAGNOSTICS selected-pair text, the
slow-motion touch-to-photon frame count and video reference (explicitly
labeled manual/approximate), frame-time/correction qualitative notes with
any screen recordings, all 3 reconnect-downtime samples with min/median/max,
and the observed behavior for each of the three host lifecycle cases.

**Pass/fail**: #5 does not give numeric phone-side thresholds (unlike the
desktop ADR032/037 budgets it asks to be _compared_ against, not replicated
physically) — record what is measured and flag anything that looks clearly
broken (reconnect never completes, host backgrounding silently desyncs
without any suspended-state UI, duplicate tabs produce two live hosts
simultaneously) as a new issue rather than as a pass/fail verdict against an
undocumented number. Do not claim this run satisfies #5's "five players plus
TV" full scope unless that many real participants were actually used —
otherwise record it explicitly as partial coverage.

---

## Recording template

Copy this into `docs/online/device-evidence/<date>-<issue>.md` for each
session:

```markdown
# Device test — <date> — #<issue>

## Build under test

- release.json gitRevision: <sha>
- release.json verifiedCiRun: <ci run id>
- release.json apiOrigin / builtAt: <value> / <value>

## Devices

- Device A: <model>, <OS + version>, <browser + version>
- Device B: <model>, <OS + version>, <browser + version>
- Host laptop (if used): <OS>, <browser + version>

## Network

- Configuration: (a) same Wi-Fi / (b) host Wi-Fi + guest cellular / (c) host Wi-Fi + guest different Wi-Fi
- Notes: <SSID types, carrier if relevant — no need for exact network names, just enough to reproduce>

## Room

- Fresh room per step: yes/no (note any reuse and why)

## Results

| Step | Expected (from issue) | Observed | Pass/Fail | Evidence         |
| ---- | --------------------- | -------- | --------- | ---------------- |
| 1    | ...                   | ...      | ...       | screenshot-a.png |
| 2    | ...                   | ...      | ...       | ...              |

## Raw captures

- LINK DIAGNOSTICS (verbatim):
```

  <paste>
  ```
- Status-line text: `<paste>`
- Probe/benchmark JSON: [artifacts/...](../../../artifacts/...) (copy into this folder, don't just point at a gitignored artifacts/ path)
- Screenshots: ![label](<date>-<issue>-<device>-<label>.png)

## Defects filed

- #<new issue> — <one line>

## Known limitations acknowledged (not defects)

- <e.g. symmetric NAT/CGNAT on cellular without TURN, per ADR035>

```

Keep every run's file even if it fails or is incomplete — a failed or
partial run is still evidence, per the same standard the existing
`RESPONSE-BENCHMARK.md` trials use (failures are retained, not deleted or
overwritten by later successful ones).
```
