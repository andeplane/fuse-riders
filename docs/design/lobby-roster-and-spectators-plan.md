# Lobby roster, ready check, spectators and colours — implementation plan

> Planning document. Written 2026-09-18 against `main` at `71528c7` (rules `fuse-p2p-32`); the module paths below predate
> the `src/shared/` → `src/engine/` split, so read `src/shared/apply-tick.ts` as `src/engine/apply-tick.ts`.
>
> **Status.** Phase G (spectators) landed in #351 under rules `fuse-p2p-41`. Phase B (host badge and handover) and
> Phase D (kick) landed under rules `fuse-p2p-42`, with two departures from the plan below, both noted where they
> occur: the badge is the word HOST rather than a crown, because the crown already marks the round leader in the
> standings; and delegation is left exactly as the log defines it, so beside a creator that took no seat the first
> rider wears the badge as well as the creator's own page — every rule that would avoid that also strands a room whose
> unseated host has left (ADR 047 §9, `roomManager`).
>
> Phase F (ten colours, unique colours and avatars) landed under rules `fuse-p2p-48`, with one departure noted in §7:
> the `JOIN` entry keeps its shape, because it is the netcode's and shared with every game, so a joiner's colour is not
> carried on the join but follows as its own `COLOR` entry the moment the room seats it. The fold gives every join the
> lowest free colour, so the repair the plan asked for is where it should be and nobody is ever seated without one.
> Phases A, C and E are still open.
> Covers ten requested lobby and feel changes: host crown, kick, host handover, ready check, ten colours, unique
> avatars, spectators, ready check between rounds with a countdown sound, a lobby map picker, and a slower bomb range
> sweep. Each sub-phase is sized for one agent owning it end to end on a `codex/` branch, opening one pull request in
> the repo's usual shape (what changed, what was verified and what was not, what the subagent review found).

---

## 0. Executive summary

- **Everything the room must agree on goes into the shared input log.** Every device folds the same log
  ([ADR 047](../adr/047-p2p-input-log-lockstep-rollback.md)), so host identity, readiness, chosen colours, avatars and
  the spectator list are either log entries folded into `RoomState`, or they are not consistent, do not survive a
  reload and cannot gate `START`. Connection-scoped state (the voice roster) is the precedent for the opposite choice
  and is wrong here: a ready flag that one device missed would let the host start early.
- **Consequence: five of the seven feature phases change the fold**, so each bumps `RULES` in
  `src/shared/apply-tick.ts`, re-records the golden (`npx tsx scripts/update-golden-hashes.ts --record`, about a
  minute), moves the pin in `tests/input-log.test.ts`, and adds encode/decode/validation in `src/online/snapshot.ts`
  and `src/online/checkpoint.ts`. Fold-changing pull requests should land one at a time; two in flight conflict on
  `RULES` and the golden, as the `[rules 31→32]` merges in recent history show.
- **Much of the host story is already built.** `successionOrder`, `delegate`, `actingCreator` and `permitted` in
  `src/shared/apply-tick.ts` already hand management to the next connected human while the creator is away. Only
  `RoomRuntime.command` still refuses room commands from anyone but the creator, and the UI has no idea who is
  managing. Kick is one missing command over an existing entry (`LEAVE`).
- **Colour is currently the seat.** `SLOT_COLORS[slot]` is assigned at join, and the checkpoint validator insists
  `color === SLOT_COLORS[slot]`. Selectable colours mean colour becomes its own field in the join entry with its own
  uniqueness rule in the fold; the seat (`slot`) keeps ordering riders, naming bots and seeding the ink wobble.
- **Spectators are the one genuinely new concept.** They need a place in `RoomState`, presence handling, a rank in the
  succession order (so a spectating host can hold the crown) and a raised room capacity in the room service. Nothing in
  the room service changes for any other phase.
- **Order:** bomb feel first (isolated, instant playtest value), then host crown and handover, then the lobby map
  picker (tiny), then kick (the escape hatch the ready check needs), then the ready check with the countdown sound,
  then colours and avatars, then spectators. About 13–17 agent-days in total, see §9.

---

## 1. How the pieces are built today

| Concern       | Where                                                                                                                                                                                                                              | What matters for this plan                                                                                                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared fold   | `src/shared/apply-tick.ts` `applyTick`, `applyManagement`                                                                                                                                                                          | Management entries (kinds 10–15) apply first, only from the manager's stream and only when `permitted`; then player entries (0–5) from each rider's own stream in seat order; then `step`; then automatic round progression. New kinds slot into either group.                           |
| Entry shapes  | `src/shared/input-log.ts` `Entry`, `isEntry`, `isManagementKind`                                                                                                                                                                   | Shape and bounds validation on the wire. `isManagementKind` is a range check (`>= JOIN && <= BOT`), so new management kinds must stay contiguous.                                                                                                                                        |
| Room commands | `src/online/room-runtime.ts` `command`, `join`, `claimSlot`                                                                                                                                                                        | `join` seats a rider on the lowest free seat (0–4). `command` gates settings, start/rematch/lobby and AI changes on `this.creator`, although `this.manager` (creator or acting creator) already exists.                                                                                  |
| Succession    | `apply-tick.ts` `successionOrder`, `actingCreator`, `permitted`; `room-runtime.ts` `actingCreatorDuties`, `managerId`                                                                                                              | Creator first, then connected human riders by id. A creator with no player record (TV host, and later a spectating host) makes two members managers at once.                                                                                                                             |
| Lobby UI      | `src/online/ui.ts` (~2,260 lines): `lobbyEntries`, `rosterEntries`, `hostControls`, `joinForm`, `avatarButton`; `src/online/join-form.ts`; `src/online/mobile-play-layout.ts`; `src/online/online.css` `.room-rider`, `.ai-remove` | Rider rows carry `--rider-color`, an avatar portrait, name and a status line (`READY` today means connected). The AI remove button is already parented into the lobby row or the roster card depending on phase. The UI learns "am I host" from the `ready(peerId, host)` callback only. |
| Avatars       | `src/shared/avatars.ts`, `src/client/avatar-heads.ts`, ADR 027                                                                                                                                                                     | Ten avatars, picker marks taken ones (`.taken`) but allows duplicates. `AVATAR` entry (kind 5) applies unconditionally.                                                                                                                                                                  |
| Colours       | `src/shared/game.ts` `SLOT_COLORS`; `checkpoint.ts` lines 138 and 441                                                                                                                                                              | Five colours indexed by seat; renderer, trails and CSS all read `player.color` (hex string), nothing else assumes five.                                                                                                                                                                  |
| Bomb range    | `src/shared/bomb-launch.ts` `chargeRamp`; `src/client/bomb-preview.ts`; room setting `bombChargeTicks` (default 8 ticks = 0.4 s), `aimBounce`                                                                                      | One ramp definition shared by simulation and preview. Sweep speed is the room setting itself.                                                                                                                                                                                            |
| Maps          | `src/shared/arena-map.ts` `ARENA_MAP_CHOICES` (`rotate` + six maps), `chooseArenaMap`; `room-settings-menu.ts`                                                                                                                     | Map is a room setting written by a `SETTINGS` entry. `rotate` exists; `random` does not.                                                                                                                                                                                                 |
| Audio         | `src/client/audio-director.ts` `message`, `cue`                                                                                                                                                                                    | Cues fire from `GameEvent`s. The countdown is a phase (`COUNTDOWN_TICKS` = 60), not an event, so a countdown sound derives from snapshot ticks.                                                                                                                                          |
| Capacity      | `src/service/room-limits.ts` `maxGuests: 5`; `packages/fuse-network-be` `room-store.ts`                                                                                                                                            | Creator + five guests: five riders and a TV. Pinned by `tests/p2p-adr-constants.test.ts`.                                                                                                                                                                                                |
| Tests         | `tests/room-runtime.test.ts` + `tests/fixtures/fake-room.ts`, `tests/input-log.test.ts`, `tests/golden-hash.test.ts`, `scripts/online-smoke.ts`                                                                                    | The fake network drives real runtimes deterministically; the smoke drives Chromium/WebKit against `npm run dev:online`.                                                                                                                                                                  |

---

## 2. Phase A — Bomb range sweep feel (request 10)

**Goal.** Slow the aim sweep to 50–75 % of today's speed and pause about 250 ms at both ends before reversing.

**Design.** Today the sweep period is exactly `2 × bombChargeTicks`; speed _is_ the room's "Bomb aim time" setting.
Two changes:

1. `chargeRamp` gains a dwell: `BOMB_BOUNCE_DWELL_TICKS = 5` (250 ms at 20 Hz). The ramp rises from press to full
   reach in `max` ticks, holds `dwell` at maximum, falls `max`, holds `dwell` at minimum, repeats. No dwell at the
   very start of a press: the first rise begins immediately. The preview (`bombPreviewDistance`) uses the same
   function, so the on-screen ring and the landing point cannot disagree.
2. Default `bombChargeTicks` moves 8 → 12 (0.6 s, 67 % of today's speed). Because saved room settings keep the old
   value, `loadRoomSettings` migrates a stored `8` to `12` the way it migrates `match: "wins"`, so returning hosts feel
   the change too. The settings dialog copy ("Time to reach maximum bomb distance") stays true.

**Also touched.** `RULES` bump and golden refresh (the ramp is engine behaviour); `tests/aim-bounce.test.ts`
(period becomes `2 × (max + dwell)`, both plateaus asserted); `tests/room-settings.test.ts` for the migration;
`docs/adr/010-charge-and-fire-bombs.md` gets a one-line amendment. Check the interaction with the aim slowdown budget
(`aimSlowSpentTicks`, one second): a slower sweep means the rider is back to full speed while still aiming, which is
probably fine but should be felt in the playtest.

**Verification.** Unit tests above; `npx tsx scripts/bomb-preview-smoke.ts` for the ring; a two-rider local room to
feel it. Report the felt result and offer 10/12/14 ticks as the knob.

**Size.** S (half a day).

---

## 3. Phase B — Host crown and host handover (requests 1 and 3)

### B.1 Show who manages the room — S

- `RoomRuntime` publishes the current manager id with each frame: the creator while it is a connected rider (or, after
  Phase G, a connected spectator), otherwise `actingCreator`. The frame the UI consumes gains `managerId`.
- Rider rows (lobby list, in-round roster cards, phone lobby) draw a small neon crown badge over the top-left of the
  avatar portrait and prefix the status line: `HOST · READY`. Keep the word: the crown alone is ambiguous on a phone.
  _As built:_ the word alone, as a `HOST` pill in the rider's own colour at the end of the row, and no crown at all —
  `.online-score-card.leader::before` already puts 👑 on the round leader, so a second crown would read as a second
  kind of lead. The status line keeps saying `READY` / `OFFLINE` / `WATCHING` on its own.
- The join card's own-row copy ("Waiting for the host to start") names the host.

### B.2 The acting creator manages — M

- `command()` gates settings, start/rematch/lobby, AI changes (and kick, Phase D) on `this.manager` instead of
  `this.creator`. The fold already accepts every management kind from the acting creator (`permitted`), so this is a
  gate change plus tests, not a protocol change. The notice "Only the host can manage the room" stays for everyone
  else.
- `hostControls` in `ui.ts` show for whoever `managerId` names, not only `isHost`. `REMATCH` in the recap dialog
  likewise.
- Semantics to state plainly in the PR: this is **delegation**, the model the code already has. The crown moves to
  the next connected human when the creator drops (about 1–5 s later, `DISCONNECT_MS` / `CREATOR_SILENCE_MS`), and
  moves back when the creator returns, because the creator's token still owns the room code, the reserved seat and the
  only `END ROOM` capability in the room service. A permanent hand-over is §10 O1.
- Order: "next non-AI player in the list" today means lowest id, not list position. The list is ordered by seat, so
  making succession seat-ordered (creator, then connected humans by `slot`, then by id) is a one-line change in
  `successionOrder` that makes the crown move to the rider directly below the host. Recommended; it is a fold change
  (`RULES` bump) and must be mirrored in `actingCreatorDuties` and the ADR 047 §9 text.

### B.3 Leaving without ending — S

- The host's exit dialog offers `LEAVE ROOM` (default, room survives because members keep it alive, #262) and
  `END ROOM` (secondary, creator only). Today the creator can only end.
- Nothing else is needed for the crown to move: the service's `peer offline` becomes a `LEAVE`, the creator's player
  record disconnects, `actingCreator` names the next rider.

**Tests.** `tests/room-runtime.test.ts`: creator drops in the lobby → guest B holds the crown within 5 s and can
`start`; creator returns → crown returns and B's `start` is refused; creator drops mid-round → B can `lobby`/`rematch`
after the match. `tests/input-log.test.ts` for the reordered succession. Online smoke: add a step where the creator
tab closes and a guest starts the next match.

**Docs.** README room paragraph (LEAVE vs END), ADR 047 §9 (who may issue room commands; order of succession).

---

## 4. Phase C — Lobby map picker (request 9)

### C.1 `random` map choice — S

- `ArenaMapChoice` gains `"random"`: `chooseArenaMap` picks from all six maps with a deterministic hash of
  `(seed, round)` so every replica agrees and consecutive rounds can repeat. `rotate` keeps its meaning (every
  obstacle map before a repeat). `parseRoomSettings` accepts it. `RULES` bump: an older peer rejects a `SETTINGS`
  entry carrying an unknown map, so peers on different rules must not share a world.

### C.2 The picker in the lobby — S/M

- A compact `MAP` row on the lobby card for the manager only: chips `ROTATE · RANDOM · Classic · Desert · Forest ·
City · Wrap · Crossed` (labels from `ARENA_MAP_LABELS`), current one pressed. Tapping writes a `SETTINGS` entry
  through the existing `settings` command with only `map` changed. Everyone else sees a read-only line in the lobby
  footer: `Map · Forest`. The full room settings dialog stays the editor for everything else. Phone lobby uses a
  `<select>` for width.
- Per-round map playlists are §10 O6.

**Tests.** `tests/arena-map.test.ts` (random is deterministic per seed/round, covers all maps), `room-settings` parse.
Smoke: creator picks Desert, the round's map is desert on a guest.

---

## 5. Phase D — Kick (request 2)

### D.1 Command and message — S/M

- `RoomCommand` gains `{ type: "kick"; id }`. The manager appends `LEAVE` for a human rider, **between rounds only**
  (`reclaimable`), the same rule as removing an AI. Reason: during play a `LEAVE` only marks the rider disconnected,
  and the kicked device's UI auto-rejoins anyone it sees as disconnected (`ui.ts`, the `rejoinPending` path), which
  would undo the kick a second later. Between rounds `LEAVE` removes the player record outright, so there is nothing
  to auto-rejoin.
- The manager also sends the target a direct `{ type: "kicked" }` message so its UI can say "The host removed you
  from the room" over the join card, instead of the seat silently vanishing. Re-entry is allowed, as requested; the
  kicked device stays in the mesh as a viewer, exactly like a rider who has not joined yet. No room-service change, no
  wire-entry change, no `RULES` bump (the fold already handles a manager `LEAVE` for any id).

### D.2 Button — S

- Reuse the AI remove button (`row.remove`, `.ai-remove` style) for every human row except the manager's own, visible
  to the manager, disabled outside reclaimable phases with the same tooltip pattern ("Remove riders between rounds").
  Because a mis-tap on a friend is worse than on a bot, the first tap turns the button into `KICK?` for two seconds and
  the second tap kicks. `aria-label` "Remove Nova from the room".

**Tests.** Runtime: manager kicks B in the lobby → B unseated, B's frame shows no seat, B rejoins successfully; guest
cannot kick; kick during play is refused with a notice. Smoke: kick step in the lobby.

**Docs.** README lobby paragraph. Ban list, service-level eviction and room passwords are §10 O2.

---

## 6. Phase E — Ready check and countdown sound (requests 4 and 8)

### E.1 Readiness in the log — M

- New player kind `READY = 6`: `[seq, tick, 6, ready: 0 | 1]` from the rider's own stream, folded into
  `player.ready`. Bots are always ready. Readiness is cleared for everyone when an `ACTION` (`start`, `rematch`,
  `lobby`) applies and when the phase enters `roundOver`, so every pause asks again. Carried in snapshots, checkpoints
  and the frame. `RULES` bump.
- Decision (recommended): **the host readies too.** One rule for everyone, and between rounds there is no `START`
  button to stand in for it. The alternative ("START implies the host is ready") is a one-line change if it feels
  like friction.

### E.2 Gates — M

- `command("start" | "rematch")` refuses unless every connected human rider is ready, with a notice naming who is
  not. `applyManagement` checks the same condition defensively, so a `START` that raced a late `UNREADY` is a no-op on
  every replica alike.
- Between rounds, `applyTick`'s automatic progression (`roundOver` → `startNextRound` once `phaseEndsAtTick` passes)
  additionally waits for all connected humans to be ready. Rooms with bots only, and solo, advance exactly as today.
  The result card and the instant replay (ADR 044) keep their timing; the wait begins after them.
- The AFK stall is real: one rider away from the keyboard holds the room. Phase D's kick is the escape hatch, which
  is why D lands before E. Softer options (timeout auto-ready, a room setting to skip the between-round check) are
  §10 O3.

### E.3 UI — M

- Own row gets a `READY` toggle (pressed state `READY ✓`, tap again to unready) in the lobby list, on the results
  overlay between rounds, and on the phone lobby card and phone results overlay. Other rows show `READY` or
  `NOT READY` in the status line, replacing today's `READY`-means-connected wording (`OFFLINE` stays).
- Footer: `2 of 4 ready · waiting for Nova, Byte`. The manager's `START RACE` / `REMATCH` is disabled until the
  count is complete, with that list as its tooltip. The join card's own text becomes "Ready up, then wait for the host"
  once seated.
- Between rounds a rider who has not readied sees the button pulse after five seconds, gently.

### E.4 Countdown sound — S

- `AudioDirector.message` already sees every snapshot. When `phase === "countdown"`, derive
  `seconds = ceil(remaining / 20)`; on each change cue `countdownTick` (short, same pitch, ~80 ms) for 3, 2, 1 and
  `countdownGo` (longer, a fifth higher, ~300 ms) when `remaining` hits 0. Effects channel, so `EFFECTS OFF` and the
  master mute silence it. Guard against replays and late joins with the existing `scope` and `latestTick` checks.
- One cue table entry each in `cue()`; test with the fake synth in `tests/audio-director.test.ts` (fires once per
  second, not once per snapshot; silent on a joined-mid-countdown scope's first snapshot).

**Tests.** `input-log` shape/fold tests for `READY`; runtime tests: start refused until all ready, ready cleared on
start, round waits for the unready rider then advances, bots-only room unaffected, reload mid-pause restores `ready`
from the snapshot. Golden refresh. Smoke: all riders press READY before START.

**Docs.** README lobby and results paragraphs; PROTOCOL.md entry table; ADR 047 §9 (new player kind) and §10 note;
short design note `docs/design/ready-check.md` (what is gated, what is not, why the host readies).

---

## 7. Phase F — Ten colours, unique colours and avatars (requests 5 and 6)

_Landed under rules `fuse-p2p-48`. Built as written except for F.1's colour on the `JOIN` entry: that entry is the
netcode's, shared by every game in `packages/fuse-netcode`, and a colour index in it would push a Fuse Riders concept
into a game-agnostic wire format. The fold gives each join the lowest free colour instead, and the joiner's preference
follows as the `COLOR` entry of F.2 once it is seated — so the repair is unchanged and a rider always has a colour._

### F.1 Colour leaves the seat — M

- `RIDER_COLORS` (ten) replaces `SLOT_COLORS`; the first five stay identical so existing rooms look the same. Proposed
  additions, chosen to stay apart from each other, from pickups and portal palettes, and legible as a 4 px trail on the
  dark field and on the desert and forest grounds: amber `#facc15`, coral red `#f43f5e`, mint `#2dd4bf`, ice
  `#e2e8f0`, sky `#38bdf8`. Verify with a contact sheet across the three obstacle maps and both visual styles before
  locking them.
- `JOIN` and `BOT add` entries gain a `color` index (0–9). `PlayerIdentity.color` stays a hex string on the wire and in
  snapshots; `checkpoint.ts` validates it as a member of `RIDER_COLORS` and unique among seated riders instead of
  equal to the seat's colour. `slot` keeps its jobs (seat order, bot names, ink wobble). `RULES` bump.

### F.2 Choosing and repairing — M

- New player kind `COLOR = 7`: `[seq, tick, 7, colorIndex]`. Fold rule: applies only if no other seated rider holds
  that colour at that point of the tick; otherwise a no-op. Player entries fold in seat order, so two riders picking the
  same colour in one tick resolve identically everywhere.
- `JOIN` carries the colour the joiner asked for; the fold **repairs**: if it is taken when the entry applies, the
  rider gets the lowest free colour. The manager does the same when it writes the entry, so the repair is a safety net,
  not the normal path. Preference persists in `localStorage` (`fuse-riders-color`) like the avatar.
- Bots take the lowest free colour.

### F.3 Avatars become unique — S

- `AVATAR` (kind 5) becomes a no-op when another seated rider wears that head; `JOIN` repairs a taken avatar to the
  next free one in `AVATARS` order, as requested. Bots: recommended that bots keep `robot` and are exempt from the
  rule among themselves, and `robot` shows as taken for humans while any AI sits. ADR 027 is amended: "two foxes are
  allowed" is reversed.

### F.4 Lobby pickers and the "taken" pattern — M

- The join form gains a `Colour · Pink  CHANGE` row mirroring the avatar row, so both are settled before the seat is
  claimed. Once seated, tapping the avatar or the colour swatch on your own row opens the same picker in the dialog
  (`avatarButton` already does this for avatars).
- One "taken" pattern for both grids: the option is dimmed to about 45 %, disabled, and wears a small badge of its
  owner. A taken **colour** swatch shows the owner's mini avatar head; a taken **avatar** shows a ring in the owner's
  colour; both carry the tooltip "Taken by Nova". Your own choice keeps the bright ring and a check. The two badges
  point at each other, which is the intuitive part: you can see at a glance who took the pink and which head they wear.
- Phone lobby: the same pickers in the dialog; the row swatch is a 28 px circle beside the portrait.

**Tests.** `input-log` shapes; fold tests for both uniqueness rules and both repairs, including two riders racing in
one tick and a join whose avatar and colour are both taken; checkpoint validation of the new colour rule; runtime test
that a reloaded rider keeps its colour. Golden refresh (the recording's joins gain a colour field: re-record or
migrate the fixture, see `docs/design/engine-safety-net.md`). `scripts/map-styles-smoke.ts` contact sheet with ten
riders' colours painted as trails for the palette check. Smoke: two joiners with the same stored avatar get different
heads.

**Docs.** README (colours, uniqueness), ADR 027 amendment, PROTOCOL.md, ADR 047 §9 `JOIN` shape.

---

## 8. Phase G — Spectators (request 7, and the spectating host)

### G.1 Model — L

- `RoomState.spectators: Map<id, { name; connected; generation }>`, capped at `MAX_SPECTATORS = 5`. New management
  kind `SPECTATOR = 16`: `[seq, tick, 16, "join", memberId, name, generation]` and `[.., 16, "leave", memberId]`.
  `PRESENCE` and `LEAVE` look spectators up as well as riders. Spectators are folded, hashed and carried in snapshot
  payloads with validation, and never passed to `step`, the leaderboard or the match report. `RULES` bump.
- A TV display (`?display=1`) stays what it is: an unlisted viewer. A spectator is a named, listed member.

### G.2 Succession and the spectating host — M

- `successionOrder` becomes: creator; connected human riders (by seat, from B.2); connected spectators (by id).
  `actingCreator` treats a creator who is a connected spectator as present, which removes today's two-managers quirk
  for an unseated creator and lets a tournament host commentate from the spectator row wearing the crown.
- Crown, `hostControls`, kick and the map picker all follow `managerId` (B.1), so nothing else changes for them.

### G.3 Runtime, join flow, capacity — M

- `RoomCommand` gains `{ type: "spectate"; name }`; the `join` message to the manager gains `role: "spectator"`. The
  manager writes `SPECTATOR join` (or refuses with "Five spectators are watching already"). A spectator's runtime
  behaves like a display: no inputs, no seat, it still serves and receives snapshots, keeps the clock echo going, and
  can recover the world for anyone.
- Capacity: `ROOM_LIMITS.maxGuests` 5 → 10 (creator + five riders + five spectators; a TV display would be the
  eleventh socket, so decide whether the TV counts as a spectator slot, see §11). `tests/p2p-adr-constants.test.ts`,
  `room-capacity.test.ts` and ADR 047 §9 move with it. This is the only room-service change in the plan and needs all
  service instances updated (not a wire-protocol version change).
- Mesh cost check before raising the cap: eleven members is 55 links; a rider on a phone uploads its tick packet to
  ten peers (about 3–3.6 kB/s per link measured in the brief, so roughly 35 kB/s up). Run `scripts/p2p-measure.ts`
  with ten members and record it in the PR. Spectators sending fewer packets is §10 O5.

### G.4 UI — M

- Join card: `JOIN AS SPECTATOR` as a ghost/outline button under `JOIN AS PLAYER`, smaller type, no glow. Available to
  the creator too.
- Under the rider list, a `WATCHING` list with a distinct, quieter look: same row height, neutral grey border instead of
  `--rider-color`, a binoculars/eye glyph where the portrait goes, name, status `WATCHING` (or `HOST · WATCHING`).
  No colour and no READY; the manager can remove a spectator with the same kick button.
- Spectators see the arena and results, never the controls, the HUD or the ready button. Footer copy: `3 riders ready
· 2 watching`. Ready check (E) counts riders only.
- Switching sides between rounds (`TAKE A SEAT` / `WATCH INSTEAD`) is §10 O4.

**Tests.** Fixture `fake-room.ts` gains a `spectator` option. Runtime: spectator joins and sees rounds; reload
recovers the spectator record; sixth spectator refused; creator spectates and starts a match; creator spectates and
drops → crown to a rider; all riders drop mid-match → room keeps running for the spectators until the pause, then waits.
Store tests for the capacity. Smoke: one spectator plus four riders through a match; a spectating creator starts one.

**Docs.** README, ADR 047 §9 (members, capacity, succession), PROTOCOL.md, design note
`docs/design/spectators.md` (model, presence, why spectators are in the log, capacity and mesh cost).

---

## 9. Order, sizing and dependencies

Sizes: S ≈ half a day, M ≈ 1–2 days, L ≈ 3–4 days of one agent including tests, review and docs.

| #   | Phase                     | Size          | `RULES`         | Depends on                | Why here                                                               |
| --- | ------------------------- | ------------- | --------------- | ------------------------- | ---------------------------------------------------------------------- |
| 1   | A Bomb sweep              | S             | yes             | —                         | Isolated, felt immediately, unblocks playtesting the aim.              |
| 2   | B Host crown and handover | S + M + S     | yes (B.2 order) | —                         | Every later lobby control keys off `managerId`.                        |
| 3   | C Lobby map picker        | S + S/M       | yes (C.1)       | B.1                       | Tiny, visible, exercises the manager-only control pattern.             |
| 4   | D Kick                    | S/M + S       | no              | B                         | The escape hatch the ready check needs.                                |
| 5   | E Ready check + countdown | M + M + M + S | yes             | B, D                      | Biggest flow change; ships with its own safety valve in place.         |
| 6   | F Colours and avatars     | M + M + S + M | yes             | — (touch `JOIN` before G) | Changes the `JOIN` shape; do it before spectators add a sibling entry. |
| 7   | G Spectators              | L + M + M + M | yes             | B, E, F                   | New concept, room-service change, mesh measurement.                    |

Total: roughly 13–17 agent-days. Phases A, C and D are the natural one-PR phases; B, E, F and G split into one PR
per sub-phase where the sub-phase stands alone (B.1, B.2+B.3; E.1+E.2, E.3, E.4; F.1+F.2, F.3, F.4; G.1+G.2, G.3, G.4).
Serialise the `RULES`-bumping PRs.

Each pull request follows the repo's existing shape: a summary of what changed and why; a **Verification** paragraph
listing typecheck, unit test count and coverage, build, which browser smokes were run locally and which were not
(WebKit and physical phones are usually "not run"); the subagent review outcome and what was fixed or why it stands;
and the `RULES` move where applicable. Commit subjects are imperative sentences about the player-visible change; the
body says why and names the rules move (`RULES moves to fuse-p2p-NN`).

---

## 10. Optional phases (not requested; ideas surfaced while planning)

- **O1 Permanent host transfer.** `MAKE HOST` on a rider row; the room service reassigns `hostId` and the end
  capability to that member's token. Needs a `fuse-network-be`/`-protocol` change and a reserved-seat rethink. M/L.
- **O2 Ban list and room password.** Service-level eviction (`kick` frame, close code), a per-room deny list of member
  tokens, an optional join password checked at admission. Protocol version bump. L.
- **O3 Ready-check knobs.** Room settings: "Ready check between rounds: on/off"; auto-ready after 30 s idle; host
  `START ANYWAY` after 20 s with the unready riders sat out for the round. S/M.
- **O4 Switching sides.** `TAKE A SEAT` for a spectator and `WATCH INSTEAD` for a rider, between rounds only; the
  fold treats it as leave-then-join. M.
- **O5 Cheaper spectators.** Spectator runtimes send tick packets at a quarter cadence (they carry no inputs), and
  riders skip sending speculative packets to spectators. Measure first (G.3). M.
- **O6 Map playlists.** A per-round map sequence in room settings (`["desert", "wrap", "random", …]`) shown in the
  lobby as a strip, with `chooseArenaMap` indexing by round. S/M once C exists.
- **O7 Countdown on LAN.** The LAN display path has its own audio; port the countdown cue there. S.
- **O8 Spectator camera.** Follow a chosen rider or free view, with a commentator stat strip (kills, pickups held,
  round Elo delta) for tournament streams. M/L.

---

## 11. Decisions to confirm

1. **Host handover is delegation** (crown returns when the creator comes back) rather than a permanent transfer.
   Recommended; O1 is the alternative.
2. **Succession by seat order** rather than by id, so the crown goes to the rider directly under the host in the list.
3. **The host also presses READY**, rather than `START` standing in for the host's readiness.
4. **Between-round ready check is always on** in this pass; the knobs in O3 wait for a playtest.
5. **Kick between rounds only**, matching AI removal, because a mid-round kick would be undone by the target's
   auto-rejoin.
6. **Bots and avatars:** bots stay `robot`, are exempt among themselves, and `robot` reads as taken for humans while an
   AI sits. Alternative: bots take free heads like anyone else.
7. **Capacity:** ten people plus a TV display (eleven sockets), or ten including the TV.
8. **Colours:** the five proposed additions are a starting point; lock them after the contact sheet.
