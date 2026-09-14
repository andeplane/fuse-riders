# Controller and lobby acceptance

Source `1a25594`, isolated local Worker `127.0.0.1:8797`, production build. Command:

```sh
ONLINE_URL=http://127.0.0.1:8797/ npx tsx scripts/shared-room-smoke.ts
```

Chrome and WebKit passed sequentially: shared QR/code, phone joining, separate TV, start/reset/end, and actual authoritative steering after holding left. Controller bounds fit 320×568, 390×844, and 844×390; landscape buttons are 277 CSS pixels tall. Held controls show feedback, clear on release, produce no selected text, and prevent contextmenu/selectstart events. This is browser emulation, not a physical iPhone long-press certification.

The desktop lobby and two WebKit controller screenshots are actual rendered UI. The initial navigation failure is retained separately: WebKit timed out during create-room navigation before control assertions, with no page errors. It also occurred on fresh local persistence; an isolated WebKit create check and the final full sequential suite succeeded. The cause of that initial setup timeout was not established; it was not suppressed in the test. Failure diagnostics now capture sanitized body and screenshot.

This evidence predates the separately requested landscape full-screen gameplay overlay. That overlay requires its own acceptance.
