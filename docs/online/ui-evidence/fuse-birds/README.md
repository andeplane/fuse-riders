# Fuse Birds browser evidence

Captured on 2026-10-14 from the combined build at `9f16083e2a7d36d1d513e6de12ca46e001097d7d`, served by the in-memory room service at `http://127.0.0.1:4917/fuse-birds/?mute`. These are actual Chromium screens reached through the landing page and ordinary room controls, with no injected game state or modified clocks.

- [Solo practice](practice.png): entered through **1 PLAYER PRACTICE**, fired Pebble and Scatter, reset ammunition with **NEW MAP**, and reloaded the practice URL without any room requests. The shared portal was exercised on the landing page and is first in the practice header.
- [Phone viewport](phone.png): an independent emulated 390×844 controller joined an actual room and rendered its own camera with the two-player roster.
- [TV](tv.png): a display-only page showed the full map and hid camera/turn controls.

All three images were inspected. Phone emulation is not physical-device evidence.

Commands:

```sh
pnpm exec tsx scripts/fuse-birds-practice-smoke.ts http://127.0.0.1:4917 /tmp/birds-combo-practice
pnpm exec tsx scripts/fuse-birds-online-smoke.ts http://127.0.0.1:4917 /tmp/birds-combo-online
```

The practice command passed. The original online command failed at the first Scatter-ammunition assertion. Temporary passive diagnostic copies observed a real Scatter launch reaching all three replicas, phone refresh restoring the same health/turn, and ordinary PASS actions progressing through turn 14, but did not prove result/rematch. A further diagnostic exposed a controller whose recovered seat was still `away`: the UI enabled PASS while the runtime rejected it. Its document was visible and canvas ready, so this is a seat-readiness defect, not evidence of a finished online round. The source fix and a successful repeat remain required before claiming the complete online flow passes.
