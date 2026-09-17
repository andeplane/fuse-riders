# N4 reproduction only — unfinished

Local WIP for #258 N4, based on main `6a6f377`. No production fix or hidden-member
policy has been implemented. Stop requested before choosing a policy.

`tests/fixtures/fake-room.ts` adds optional `hiddenTickMs`, leaving normal fixture
behavior unchanged. Hidden timer callbacks run once per configured interval;
WebRTC-like packet delivery and visibility callbacks remain event-driven.
This models timer throttling, not fully suspended browser execution.

Reproduce two known failures:

```sh
npx tsx --test tests/hidden-tabs.test.ts
```

- At 1 Hz with 120 ms jitter, the hidden guest alternates connected/disconnected
  between packets (`presence.size` is 2 instead of 1).
- After the creator becomes the sole hidden world holder for 30 seconds, a
  refreshed visible guest retains the match ID but fails to advance beyond tick
  500 within six seconds. The source world remains frozen.

A separate temporary experiment added `hiddenTickMs: 1000` to every `reliableMs: 30`
configuration in `tests/room-runtime.test.ts`, then ran:

```sh
npx tsx --test --test-name-pattern='hidden|reordered packets' tests/room-runtime.test.ts
```

Three existing hidden/solo tests passed. The hidden+jitter 3x pacing test advanced
44 ticks in one second, failing its existing minimum of 50. The temporary test
edits were reverted; the opt-in scheduler seam and two new regressions remain.
Output was recorded locally in `/private/tmp/fuse-hidden-repro.log`.

Next: choose and document a bounded hidden-member policy. Cover held-control
cancellation, stable membership, visible peer progression at normal and bot-only
speed, foreground recovery and a sole hidden snapshot holder. Preserve solo
pause. Do not rewrite N2 clock semantics before shared driver A3. Candidate ideas
were considered but none accepted or implemented: explicitly passive hidden
membership versus bounded background replication driven by throttled timers and
incoming peer messages. Physical-device behavior is unverified. Merge current
main before continuing; P4 and engine safety-net changes may overlap these files.
