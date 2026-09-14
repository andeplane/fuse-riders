# Direct actions: stopped-work handoff

Stopped at the user's request on 2026-09-15. Implementation branch: `codex/deterministic-action-log`; worktree: `/private/tmp/fuse-riders-action-log`; latest runtime: `07f6d63`. Tracking: [#82](https://github.com/andeplane/fuse-riders/issues/82). **Not ready to merge or release based on the current verification record.** No public deployment was made.

## Known remaining issue

**Intermittent WebKit refresh/setup failure.** With five players, refresh a guest, refresh the creator, then immediately switch to shared-TV mode. Some runs finish; others exhaust setup/recovery and require MAIN MENU. The latest completed failure (`direct-final-webkit-06.log`, runtime `3689b51`) left the creator unable to activate while guests had lobby worlds and the links appeared healthy.

The final fix (`07f6d63`) prevents a retained old-authority world from pausing a replacement connection that reused its numeric synchronization ID. Its regression fails on the preceding code and passes with the fix. An independent review approved the scope checks. **The browser fix is not confirmed:** the next WebKit run was interrupted when the user asked to stop. Do not report this intermittent failure as closed.

Earlier refresh fixes address recreated links wrongly starting recovery, retrying initial lobby setup before the creator installed a world, and WebKit reporting binary sends on closing channels. Those have specific regression evidence. The closing-channel response is deferred through the existing task queue; this does not prove that every native WebKit send/closure race is eliminated.

## Verification still outstanding

- Repeat the affected WebKit flow on the final runtime, with the existing zero-browser-error assertion unchanged, then verify the Chromium counterpart.
- Run the planned short impaired repeated-match regression on the final runtime. The reviewed incremental plan was at least 120 seconds; the final revision itself has not passed a 30-minute soak.
- Finish the final rendered-response, LAN and cross-browser replay checks. Earlier revisions passed these scopes, but the final sequential run stopped before reaching them.
- Real phones, real WAN loss/jitter and browser suspension remain unqualified. Current measurements do not establish mobile readiness or robust host failover.
- There is no matched old-versus-new total-wire bandwidth comparison. Current application-byte measurements are useful; an exact percentage reduction from the historical 29→12.7 KB/s prototype would be misleading.

Replay UI/export, killcams and scrubbing are follow-on features, not implemented by this branch. They are not blockers for the networking implementation milestone. Merge/deployment and public acceptance remain separate work.

## What is verified

- Direct, event-driven absolute-tick MessagePack actions; bounded redundancy/repair; whole-world simulation and rollback on full views; lightweight shared-TV controllers; adaptive remote presentation are implemented. Online mode uses the direct architecture by default.
- Runtime `f4a6e9b` passed 1,830.676 seconds / 57 three-round matches with five scripted player origins plus a display, mixed Chromium/WebKit, 75 ± 50 ms synthetic one-way delay, 5% fast-message loss and a 256 kbps sender cap. All six finalized outcomes matched, with no hidden recovery and no checkpoint chunks during the measured matches/rematches. This was desktop application-level impairment, not real IP loss or rendered/physical-phone qualification.
- That run measured about 1.17–1.35 KB/s application download per view. It includes rematches but excludes room join and wire overhead.
- Final runtime `07f6d63`: 660 tests passed; unchanged coverage gates passed (99.62% lines/statements, 94.48% branches, 99.23% functions); build including TypeScript passed. Worker typecheck passed before the final runtime-only changes.
- Native Chromium/WebKit transport tests passed pause ordering, deferred-send closure, loss recovery and connection replacement before the last runtime-only fix. Independent reviews of the subsequent runtime fixes are recorded in `docs/reviews/direct-actions-core-review.md`.

Evidence is retained locally at `/private/tmp/direct-action-stopped-evidence/manifest.json`, including the sustained run, failed refresh runs, regressions and the interrupted final run. Raw logs were not published: automatic approval review rejected their upload because they had not been fully checked for sensitive data. The local test server on port 8813 and the active browser sequence were stopped.

## Exact next steps, only if work is resumed

From `/private/tmp/fuse-riders-action-log`, start the already-built local fixture:

```sh
node node_modules/wrangler/bin/wrangler.js dev --port 8813
```

In a second terminal in that worktree:

```sh
BROWSER=webkit ONLINE_URL=http://localhost:8813/ ROOM_RENDERER=canvas node --import tsx scripts/online-smoke.ts
```

If it fails again, inspect activation readiness and scoped pause state before changing more lifecycle logic. Do not hide the failure by waiting for readiness before the UI settings action or by extending recovery deadlines.
