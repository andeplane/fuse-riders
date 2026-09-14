# Controller and lobby acceptance

Source `1a25594`, isolated local Worker `127.0.0.1:8797`, production build. Command:

```sh
ONLINE_URL=http://127.0.0.1:8797/ npx tsx scripts/shared-room-smoke.ts
```

Chrome and WebKit passed sequentially: shared QR/code, phone joining, separate TV, start/reset/end, and actual authoritative steering after holding left. Controller bounds fit 320×568, 390×844, and 844×390; landscape buttons are 277 CSS pixels tall. Held controls show feedback, clear on release, produce no selected text, and prevent contextmenu/selectstart events. This is browser emulation, not a physical iPhone long-press certification.

The desktop lobby and two WebKit controller screenshots are actual rendered UI. The initial navigation failure is retained separately: WebKit timed out during create-room navigation before control assertions, with no page errors. It also occurred on fresh local persistence; an isolated WebKit create check and the final full sequential suite succeeded. The cause of that initial setup timeout was not established; it was not suppressed in the test. Failure diagnostics now capture sanitized body and screenshot.

This evidence predates the separately requested landscape full-screen gameplay overlay. That overlay requires its own acceptance.

# End-of-match recap acceptance

Source `f4bf479` (rebased on `main` at `838e022`), isolated local Worker `localhost:8814`, production build. Command:

```sh
HOME_URL=http://localhost:8814/ npx tsx scripts/match-recap-smoke.ts
BROWSER=webkit HOME_URL=http://localhost:8814/ npx tsx scripts/match-recap-smoke.ts
```

Chrome and WebKit each play a one-round solo match to completion on a 1280×800 desktop viewport and an 844×390 phone-landscape viewport. The script records the dialog state at every authoritative snapshot and asserts the report stays closed for the 60-tick final-round pause; opens afterwards inside the viewport with an accessible CLOSE button and the accessible name `Match results`; has no horizontal document or dialog-body overflow; shows a champion card, at least one award, the eight totals and one comparison row per rider; closes, restoring the ordinary dialog width and the `Game menu` name; reopens from the header RESULTS button at the top of the report; and (desktop) is not reopened by a rematch. `match-recap-{chrome,webkit}-1280x800-f4bf479.png` and `match-recap-{chrome,webkit}-844x390-f4bf479.png` are the rendered dialogs at first open.

Since PR #41 a joined phone stays the landscape thirds controller in `matchOver`, so the header — and with it RESULTS — lives behind the ☰ MENU overlay; the phone leg of the smoke opens that overlay when RESULTS is not already on screen. The wide comparison table scrolls horizontally inside its own container on the phone; the page and the dialog body do not.

This is desktop emulation of a phone viewport, not a physical-phone acceptance.
