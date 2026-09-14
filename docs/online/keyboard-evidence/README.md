# Desktop keyboard acceptance

One isolated run of `npx tsx scripts/keyboard-smoke.ts` against local static port4188 passed Chromium and WebKit. Exact source revision and built bundle SHA are recorded in the adjacent JSON. No public room or LAN server was used.

The script sends browser keyboard events through the real solo UI and shared input/host simulation. It checks authoritative snapshot heading changes in both directions, Space charge followed by the snapshot-derived bomb recharge indicator, modal cancellation without recharge, and normal arrow/delete editing inside a settings input. Repeated Space keydown is included. There were no page errors.

This verifies desktop browser interaction with the actual local simulation. It does not claim online network delivery, physical keyboard hardware, or pixel-level bomb rendering validation. The five typed keyboard regressions separately check exact press/release/cancel counts and pointer coexistence.
