# Dimensional supply conduits

Connections now have a ground shadow, dark sheath, raised highlight and team-color
core. Supply particles and builders follow the exact visible quadratic curve;
their trails use its exact subcurve and glyphs face its tangent. Ground travelers
render below the shared building/terrain silhouettes. This changes presentation
only: departure/arrival ticks, routes, authoritative coordinates and rules are
unchanged. Curves are prepared once per snapshot rather than rebuilt per frame.

Focused regressions cover endpoints, reversed travel, curved trails, ground-layer
occlusion, state immutability and reduced motion. Independent review additionally
checked diagonal and stationary paths; its floating-point test assertion finding
was fixed with a tolerance rather than changing geometry. All 1,795 repository
tests, typecheck, focused lint and build pass.

The normal menu → Watch AI vs AI → Start → Find battle flow ran in Chromium
(1280×800) and WebKit (390×844), muted, using the ordinary game clock. Both captures
show firing and moving supply with no page errors. The desktop sample also caught
building collapse; the coarser phone samples did not. Both final screenshots were
retained, along with the final 15 seconds of each unaccelerated capture.

- [Desktop battle](chromium-desktop-battle.png), [clip](live-desktop.mp4)
- [Phone battle](webkit-phone-battle.png), [clip](live-phone.mp4)

Reproduce with `pnpm exec tsx scripts/fuse-craft-live-watch.ts /tmp/fuse-conduit-capture`
while the preview serves port 5174. Browser emulation is not physical-phone
evidence. This visual improvement does not establish overall AAA quality or human
play-feel acceptance.
