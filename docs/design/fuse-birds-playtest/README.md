# Phase 1 playable captures

These are real Chromium room flows, not concept images or injected game states. They implement the [Neon burrow V2 direction](../fuse-birds-concepts/01-neon-burrow-v2.png) with the two-weapon Phase 1 tray. Captured locally using rules `fuse-birds-4-snapshot2`; no public deployment is implied.

- [Shared TV](shared-tv.png): the entire map, tiny widely spaced birds, navy scenery, cyan contours and fixed weapon counts.
- [Keyboard aiming](keyboard-aim.png): the actual quantized shot preview before Enter launches; Escape cancellation also tested without spending ammo.
- [Phone zoom](phone-zoom.png): 390×844 emulated phone, independent 190% view, fixed-size controls and direction labels for off-screen birds.
- [High-DPI phone zoom](phone-zoom-dpr2.png): rules-5 review fix, 390×844 CSS pixels at DPR2; marker text and safe margins retain their CSS size.
- [Ammo refill](refill.png): the exhausted player's next turn visibly shows ×1 after an ordinary Pebble shot collected a naturally spawned crate. This capture predates the new keyboard/edge-label controls; terrain art and inventory behavior are unchanged.
- [Round result](result.png): completed real match, followed by a verified rematch with fresh ammunition.

Visual review: the rendered game preserves the approved small-bird/large-map ratio, quiet navy sky, layered distant scenery, faceted purple rock, thin cyan terrain light and readable neon HUD. Authored rock is clipped to authoritative terrain; crater surfaces receive the same material and edge lighting. The generated ridges are smoother and surface vegetation sparser than the concept, with no waterfalls or additional theme packs in Phase 1. This is a working adaptation of the reference, not pixel-identical concept art. No background grid is present. Portrait controls and counts fit the inspected viewport; labels stay inside its edges.

Run `pnpm dev`, open the printed URL with `/fuse-birds/?mute`, and create a room with a second tab/device. User playtesting of feel and appearance remains separate from these automated/emulated checks; no physical-phone performance claim is made.
