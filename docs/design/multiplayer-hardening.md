# Multiplayer input and recovery hardening

The deterministic input log and direct WebRTC mesh remain authoritative. No engine rules or protocol fields change.

- A fast packet validates its stream, including a proposed replacement generation, before adopting peer timing or identity. Window refusals retain bounded liveness grace but cannot sample the clock. Violations leave healthy stream identity and timing intact.
- New local entries are stamped after both the clock and the simulated world. This includes eager solo folds and hide/resume neutralization; multiple entries for one transition still share a tick.
- Snapshot decoding validates replay tails with the live stream rules. Recovery builds a complete candidate world and own-stream continuity before committing it, preserving the current world on rejection and retrying on the existing bounded timer.
- Published frame revisions change when corrected history actually becomes visible, after paced replay completes. Counting received late packets alone would start visual recovery before the corrected frames exist.
- Remote portrait and heading corrections settle over 120 ms. Their poses travel separately to the rider drawing pass: canonical trails, trail tips, projectiles, gun sights, collisions and local controls retain their supplied geometry. Armed guns and charging weapons use canonical poses. Death, portal transit, scope/phase/identity changes, long render gaps and corrections exceeding 120 units reset offsets immediately. A portrait may briefly separate from the corrected trail; no artificial lethal trail segment is drawn to connect it.

`games/fuse-riders/tests/reconcile.test.ts` reproduces the delayed-release snap under a seeded 20 ms link and 500 ms sender blackout. It gates correction size, convergence, reset boundaries and local responsiveness. `scripts/network-recovery-smoke.ts` repeats the actual two-browser flow with `?mute`, records displayed/canonical poses, and captures the real canvas.

`scripts/p2p-measure.ts` measures applied steering press/release transitions within their match/round and before the next steering edge. Missing and superseded responses are counted, including those exceeding the deadline. It uses seeded application-message impairment and reports payload bytes. Desktop browser measurements do not establish physical-device or real-network latency.

Run a preview from this checkout, then:

```sh
ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/network-recovery-smoke.ts
BROWSER=webkit ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/network-recovery-smoke.ts
ONLINE_URL=http://localhost:PORT/ pnpm exec tsx scripts/p2p-measure.ts
```
