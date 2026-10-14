# Birds after final network integration

These inspected real Chromium captures were produced at immutable source
`1423b7735410fae02e5a0250308f00a9400366a1`, including reviewed network candidate
`706e3c5b67c5651e147988b756b8edd3d5e80572` and shared-social source `c16eaf87`.
Birds production code was unchanged; the affected shared input recorder, runtime
and snapshot changes were exercised through real play.

The source Vite server and fresh in-memory room service ran from the owned Birds
integration worktree. The affected command was
`pnpm exec tsx scripts/fuse-birds-online-smoke.ts <source-url> /tmp/fuse-birds-521-online`,
using a URL without a trailing slash. It exited successfully with a desktop
player, an emulated 390×844 phone and a separate shared TV, all muted.

The flow passed Scatter launch and ammunition agreement, automatic
current-generation admission after phone reload, receiver-applied ordinary PASS
in both directions, a bounded round, results and rematch with fresh ammunition.
Its paired baselines require the receiving peer's actor ordinal to advance in
the same match and round; sending alone and automatic deadlines cannot pass.
The strict page-error and console-error assertions passed.

All 23 focused Birds/input-recorder/packet-atomicity/runtime tests passed on this
revision, together with typecheck and diff checks. This affected qualification
does not claim a new global coverage result or a repeated full repository suite.
The earlier coherent coverage and full-unit revisions remain recorded in the
[previous qualification](../qualified-2026-10-14/README.md).

- [Desktop room](desktop.png)
- [Automatically recovered phone](recovered-phone.png)
- [Completed round](result.png)

The screenshots were inspected after the successful flow. Browser phone
emulation does not establish physical-phone or WAN recovery, and muted play does
not establish audible-sound acceptance. OAuth and gamepad acceptance remain
untested. Local qualification is separate from GitHub CI and deployment.
