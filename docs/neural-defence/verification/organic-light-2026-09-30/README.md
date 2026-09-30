# Organic network and light — 2026-09-30

Branch `claude/fuse-craft`. Presentation only: engine rules, AI and maps are
unchanged, and the AI matrix below confirms it.

## What changed

- **Neurons** are procedural cells instead of three near-identical sprites.
  Each cell's type (stellate, pyramidal, bipolar or granule), soma outline,
  dendrite tree and one of three tones come from its location, so the
  world, placement ghost, inspector portrait and build button all agree.
  Dendrites sway in two counter-phased groups, carry signal sparks and reach
  toward each connected neighbour, which reaches back.
- **Growth**: a paid neuron grows in a throbbing cocoon, then sprouts; new
  dendrites and links grow in from the older end.
- **Creep**: a raised, veined slab of muted tissue spreads from every
  structure as it is built and recedes when one is destroyed or cut off.
  Brains send a heartbeat ripple through it.
- **Buildings** rise from lit tissue mounds with roots spreading into the
  creep; brains breathe.
- **Death**: a destroyed neuron bursts into droplets, a ring and a fading splat.
- **Light**: a WebGL2 canvas adds emissive light over the board through the
  same camera transform: glowing nuclei, brains, towers, deposits and
  cocoons; a signal along every live axon; lit particles in transit;
  drifting spores; hit flashes and bouncing sparks, embers on destruction
  and rising motes on construction, each timed to the shot's arrival. A
  vignette grades the view. Without WebGL2 the game renders without it.
- **Reduced motion**: both the in-game setting and the system preference
  stop sway, sparks, ripples, breathing and the light layer's motion.

## Blood flow and living deposits

Added after the captures below, at source `353ac0b5`: faint blood vessels
thread the ground (seeded per map, beneath rocks and creep) and blood cells
glow through them in surges on a ~1.1 s heartbeat; biomass pods breathe and
puff spores; insight crystals hover and sparkle; mined deposits stream motes
into their miners. [Desktop](blood-desktop-battle.png) and
[phone](blood-phone-battle.png) captures. Profiles on the same workload:
Chromium on GPU still a locked 60 fps
([raw](profile-chromium-gpu-dpr2-blood.json)); WebKit 42–46 callbacks per
second across runs, median 18–22 ms
([raw](profile-webkit-dpr2-blood.json)), about the same as before within
run-to-run noise. Removing an opacity group on the vessels avoided an
offscreen layer in WebKit; the deposit CSS animations measured as free.

## Lighting and readability pass

At source `282a636c`: somas are low domes on the tissue with a shadowed
base, a quieter highlight and a brighter nucleus, and dendrites are
thicker, so neurons read as branching cells rather than glossy balls at
play zoom. A warm key light from the shadow direction, team-coloured light
pools under each network, a wide halo around bright sources (a bloom
stand-in) and pulses of light running out along every building's roots
tie the mechanical buildings into the living network.
[Contact](lit-desktop-contact.png) and [battle](lit-desktop-battle.png)
captures. Chromium on GPU still holds 60 fps
([raw](profile-chromium-gpu-dpr2-lit.json)); WebKit 45.5 callbacks per
second, median 22 ms ([raw](profile-webkit-dpr2-lit.json)).

## Captures

Ordinary Watch AI vs AI on Close Quarters (Pressure vs Balanced), normal
clock, from `scripts/fuse-craft-live-watch.ts` at source `e19f2120`:

- [Desktop battle](chromium-desktop-battle.png) and [contact](chromium-desktop-contact.png), Chromium 1280×800
- [Phone battle](webkit-phone-battle.png) and [contact](webkit-phone-contact.png), WebKit 390×844
- 30-second clips: [desktop](live-desktop.mp4), [phone](live-phone.mp4)

These are browser emulation, not physical-device evidence.

## Frame timing

`scripts/fuse-craft-frame-profile.ts <out> 2 all gpu` — 20 s of callback
intervals in the same live battle at device pixel ratio 2, 1280×800. The
`gpu` flag matters: default headless Chromium renders WebGL in software
(SwiftShader), which overstates the light layer's cost several-fold.

| Source                                                                                           | Browser (renderer)             | Median  | p95     | Over 50 ms | Callbacks/s |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | ------- | ------- | ---------- | ----------- |
| `a63e84f2`…`ae19b481`, before this branch ([cached tints](../cached-tints-2026-09-27/README.md)) | WebKit                         | 21 ms   | 47 ms   | 15         | 44.8        |
| `0bd67ec0`, organic network, no light ([raw](profile-webkit-dpr2-before-light.json))             | WebKit (Apple GPU)             | 21 ms   | 30 ms   | 0          | 52.7        |
| `71b437a4`, with light ([raw](profile-webkit-dpr2.json))                                         | WebKit (Apple GPU)             | 22 ms   | 44 ms   | 0          | 46.2        |
| `71b437a4`, with light ([raw](profile-chromium-gpu-dpr2.json))                                   | Chromium (Metal, Apple M4 Max) | 16.7 ms | 16.7 ms | 0          | 60.0        |

Chromium holds 60 fps with the full light layer. WebKit is better than
before this branch but the light layer costs it about six callbacks per
second; capping the canvas at one pixel per CSS pixel and reading layout
before DOM writes did not change WebKit's figure, so its remaining cost is
elsewhere (tracked in [TODO](../../TODO.md)). All figures are headless
callback intervals on an M4 Max, not physical-phone frame rates.

## AI against AI

`pnpm exec tsx scripts/fuse-craft-tournament.ts --maps all --seconds 900`
on the merged source `0bd67ec0` ([results](tournament-results.jsonl),
[manifest](tournament-manifest.json)): all 210 map/opening/seat cases are
identical to the qualified matrix in
[durable reconnect](../durable-reconnect-2026-09-27/README.md) by replay
hash, result and duration. 208 finish within 900 seconds (148 decisive results
and 60 mutual-destruction draws); the same two Pressure/Relay cases time
out as before. Zero rejected commands.

## Tests and smokes

- `pnpm typecheck`, lint and all game unit tests pass, including new tests
  for neuron anatomy, creep contours and growth, the death burst, cocoons and
  the light field.
- Browser smokes run in Chromium and WebKit: network, terrain, UI and
  roster pass. The smokes now check procedural neurons instead of sprite
  images. The roster smoke's WebKit tower selection was already flaky on the
  pre-branch source (one failure in two runs); it clicked sprite heads that
  sit under the HUD when the camera rests at the map's top edge, and now
  clamps the click into the visible board.
