# Hook Havok art direction

## Desired qualities

Bold irregular ink contours against painterly atmospheric depth; blue-gray and violet foundations; plum cloth; weathered stone and brass; restrained amber lighting. Dark foreground framing, quieter distant structures, clean active silhouettes. The user-supplied images are visual references, not instructions to reproduce their UI, characters or rules.

Original working character: a compact lantern keeper with an ochre fabric hood, visible dark face, short turquoise scarf and brass hook equipment. Avoid horned white masks, skull faces, insect-knight silhouettes and long capes. Keep costume detail simple enough to reproduce across animation frames. This character is provisional.

## Readability hierarchy

1. Character, hook and immediate threats.
2. Walkable edges and valid attachment surfaces.
3. Atmospheric architecture and decorative detail.

Use pale edge accents for terrain and low-contrast distant scenery. Do not make background bridges look like playable ledges. Keep foreground away from landing areas. Reserve saturated player colors and strong flashes for action. Avoid a giant bright central landmark competing with the player.

## Candidate environments

- **Lantern Belfry (provisional recommendation):** compact architectural vocabulary, amber lamps and brass bells give hooks a natural material identity. Risk: repetitive gothic detail and too many hanging chains.
- **Flooded Observatory:** weathered celestial instruments, distant water and broken copper rings. Risk: a bright moon or large instrument dominating the arena.
- **Overgrown Sanctuary:** inked foliage, mossy ruins and lanterns. Risk: leaves and roots obscuring collision edges.

Judge images at actual gameplay scale, not only full-screen. Compare the small character against the central background and platform edges in each. The concepts need not precisely match the future collision coordinates.

## Asset preparation

Source masters: PNG, sRGB, preserved unchanged. Production cutouts require genuine alpha, not a painted checkerboard. Use consistent upper-left illumination for foreground assets. Backgrounds may use atmospheric backlighting.

Requested background size: 2560 × 1440. Accept native generator sizes without distortion; crop/pad deliberately for 16:9 later. Character source: 512 × 512 per frame, transparent padding. Runtime starting point: 128–256 pixel frame cells, displayed at approximately 64 pixels tall; finalize based on device pixel ratio and actual fit. Platform source: 1024 × 256 with horizontal edge and modular end caps. Asset preparation must inspect seams, pivots, edge fringes and outline weight.

Target essential runtime art download around 5 MB excluding music. Measure decoded texture memory separately. Use painted glow and sparse particles first; expensive full-screen effects need evidence. Do not infer runtime performance from these source files.

## Animation proof and remaining work

The first six-pose study is now available in the art lab: two idle and four running poses, a simplified right-facing profile, shared scale and aligned lowest opaque pixels. A's character identity is retained alongside a denser eight-platform composition. See [animation trial](animation-trial.md). This is a workflow proof, not a finished animation set; torso registration, near/far-leg readability, smooth transitions and landing/fire/pull poses still need refinement.

Produce a short idle and 6–8-pose run or jump sequence from an approved character reference. Align size/baseline/pivot and inspect at gameplay scale. If generated costume or silhouette drifts, edit/reuse the approved sprite or separate parts rather than accumulating inconsistent frames. Two unrelated poses are not proof of production-ready animation.
