# The room runtime's collaborators

`packages/fuse-netcode/src/room-runtime.ts` had grown to about 2,100 lines and owned everything a member does in a
room at once: the handshake, the member table, the snapshot request/assemble/install path, divergence, seat allocation,
presence, succession, visibility, the tick loop, NACKs, status copy and metrics. Issue #258's N1 finding named the
consequence rather than the size: **the world's lifecycle was derived from a combination of flags on every tick**, and
sentinels doubled as dirty flags, so a reader had to reconstruct the state machine in their head each time.

This note records the split. It is behaviour-preserving — no wire change, no protocol change, no `RULES` bump, and the
golden hash is unchanged.

## What moved where

| File                | Owns                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `membership.ts`     | The member table and the `Member` record; the never-heard silence rule; `rulesAge`. `LINK_WAIT_MS`.                |
| `world-sync.ts`     | The world lifecycle state, the snapshot fetch, `noWorld` answers, catch-up hold, divergence. `DIVERGENCE_*`.       |
| `input-recorder.ts` | This device's own log entries: their tick stamps, and when the next packet is owed.                                |
| `room-manager.ts`   | Seating, presence and succession — who may write a management entry and what it says. `DISCONNECT_MS` and friends. |
| `room-runtime.ts`   | Wiring: transport events, handshake, the tick loop, packets and NACKs, visibility, status copy, metrics.           |

`room-runtime.ts` went from 2,097 lines to about 1,580.

`Pacer` from the issue's suggested split no longer applies: #349 deleted the pacing machinery when the clock stopped
changing rate.

## `RoomManager`: who may write a management entry

Management is the only part of the runtime whose entries are about _other members_ — seats, watching places, presence,
removals — and the only part whose authority moves: normally the creator's page, and the delegate the fold names
(`actingCreator`) while the creator is logged absent. `RoomManager` holds that predicate (`manager`, `managing`,
`managerId`) next to the duties that depend on it, so "may I write this?" and "what do I write?" are in one place:

- **Seating** — `join`, `spectate`, `claimSlot`, `kick`/`settleKick`, and the side switch that pairs two entries at one
  `InputRecorder.next()` tick so it lands whole or not at all.
- **Presence** — `creatorDuties` and `ensurePresence`/`logPresence`: present again only on a packet, absent only on
  silence this replica could have heard (`Membership.silent`).
- **Succession** — `actingCreatorDuties`: the lowest connected member still heard marks absent everyone ahead of it
  once the creator has been silent for `CREATOR_SILENCE_MS`.

It takes a `RoomManagerHost` port — the fold, who this device is, and the two side effects management has (an entry on
this device's own stream, a line on the screen). It holds no transport and no clock, so a test can drive it with plain
values.

## `WorldSync`: one state instead of three flags

The lifecycle used to live in three independent fields — `world?`, `snapshotRequest?`/`assembler?` and `outOfSync` —
read back together on every tick loop pass. Eight combinations were representable; four are meaningful. `WorldSync`
stores a discriminated union instead, so the world is present in exactly the states that have one and the assembler is
owned by the request it belongs to:

```ts
type Sync<W> =
  | { at: "NoWorld" }
  | { at: "Requesting"; request: SnapshotRequest }
  | { at: "Live"; world: W }
  | { at: "Resyncing"; world: W; request: SnapshotRequest }
  | { at: "Diverged"; world: W; request?: SnapshotRequest };
```

### States

- **NoWorld** — this replica has nothing to fold into and is asking nobody. A page that has just been welcomed, or one
  whose only source left mid-fetch.
- **Requesting** — no world, one fetch outstanding. The retry timer rotates it round the holders.
- **Live** — a world, no fetch outstanding. The ordinary state.
- **Resyncing** — a world _and_ a fetch outstanding: a gap that a NACK cannot repair, a backlog past `BEHIND_STEPS`, an
  unrepairable stream, or a hash mismatch below the divergence limit. The world keeps simulating meanwhile.
- **Diverged** — this replica missed `DIVERGENCE_LIMIT` authority hashes inside `DIVERGENCE_WINDOW_MS`. Latched, and
  absorbing: nothing clears it today.

### Transitions

| from         | `open` | `requestFrom` | `abandonRequest` | `installed` | `diverge` |
| ------------ | ------ | ------------- | ---------------- | ----------- | --------- |
| `NoWorld`    | Live   | Requesting    | NoWorld          | —           | —         |
| `Requesting` | —      | Requesting¹   | NoWorld          | Live        | —         |
| `Live`       | —      | Resyncing     | Live             | —           | Diverged  |
| `Resyncing`  | —      | Resyncing¹    | Live             | Live        | Diverged  |
| `Diverged`   | —      | Diverged²     | Diverged²        | Diverged²   | Diverged  |

¹ The same state with a new peer and a fresh assembler: `retrySnapshot` rotating round the holders, carrying the
failure count forward so `SNAPSHOT_FAILURES` still raises "could not load".

² `Diverged` absorbs the lifecycle. It carries an _optional_ request because a diverged replica still fetches when a
gap or a backlog demands one — a deliberate choice over splitting into a diverged-live and a diverged-resyncing pair
that no caller distinguishes.

`restartAssembly` is the one transition that does not change state: the peer answered but the snapshot failed
validation, so the same peer is kept, the failure count goes up and a fresh assembler waits on the retry timer.

### What the states rule out

The combinations that used to be spellable and are now unrepresentable: a request outstanding with no world _and_ no
`Requesting`/`Resyncing` distinction between the first fetch and a resync; an assembler alive without the request it
belongs to (`peer(offline)` cleared `snapshotRequest` but left `assembler` set); divergence held in a boolean beside a
lifecycle that did not know about it.

## Known behaviour this split deliberately preserves

`Diverged` is never cleared, and the replica keeps simulating. Once `DIVERGENCE_LIMIT` hashes miss inside
`DIVERGENCE_WINDOW_MS`, `WorldSync.diverge()` latches: the status line stops being refreshed from the advance path
(`!this.sync.diverged`) and nothing ever resyncs out of it — while the world goes on folding, drawing and sending a
state the room does not share. ADR-047 documents it; issue #258's N1 finding calls it a bug. It is left exactly as it
was here so this change can be reviewed as a refactor, and it is a one-line change to make `installed` clear the latch
once that is decided deliberately.

Issue #258's P4 finding — an unguarded `callbacks.state(...)` letting a UI exception into the netcode tick loop — no
longer applies: every consumer call in `room-runtime.ts` already goes through `deliver`, which catches and reports
through `options.callbackError`. See `docs/design/presentation-callback-errors.md`.

## The test seam

`AGENTS.md` forbids `as any` and private-field mutation in tests. Before this split, eleven `as unknown as` casts in
`games/fuse-riders/tests/` reached into `RoomRuntime`'s privates for the world, its streams, `hashAt`, `tickLoop` and
`requestSnapshot`. The collaborators give those a real public surface:

- `runtime.sync` — `WorldSync`, with `world`, `state`, `request`, `requesting`, `diverged`, `mismatchCount` and
  `hashChecks`. A test that wants the folded state asks `runtime.sync.world!.state`.
- `runtime.tickLoop()` — one loop pass. `dependencies.schedule` drives it every 10 ms in a page; a deterministic test
  drives it directly.
- `runtime.requestSnapshot(preferred?)` — force a fetch. It is a real operation a screen may offer, and `sync.state`
  reports what it did rather than leaving it to be inferred.
