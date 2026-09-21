# Invisible phone controller regions

Real offline solo play, captured with Chromium phone emulation for issue #399.
The overlay stays invisible; white region outlines with outlined arrows and a
bomb briefly show at round start, then fade. Portrait uses the top half
for fire and the two bottom quarters for steering. Landscape uses two steering
quarters beside a half-screen fire region (swappable in Settings).

- [Landscape, after hints fade](landscape.png)
- [Landscape, white outline instructions](outlines.png)
- [Portrait, countdown](portrait.png)

Captured by scripts/mobile-landscape-smoke.ts and
scripts/portrait-arena-browser.ts. Both were also run with WebKit.
These are browser checks, not physical-phone qualification.
