# Invisible phone controller regions

Real offline solo play, captured with Chromium phone emulation for issue #399.
The overlay stays invisible; the initial hints fade. Portrait uses the top half
for fire and the two bottom quarters for steering. Landscape uses two steering
quarters beside a half-screen fire region (swappable in Settings).

- [Landscape, after hints fade](landscape.png)
- [Portrait, countdown](portrait.png)

Captured by scripts/mobile-landscape-smoke.ts and
scripts/portrait-arena-browser.ts. Both were also run with WebKit.
These are browser checks, not physical-phone qualification.
