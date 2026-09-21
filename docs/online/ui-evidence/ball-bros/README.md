# Ball Bros phases 0–2

Real muted browser flows captured against the local built service at port 8792 during phase 2 implementation, committed as `5b206be1`. The final storage fallback correction does not change these layouts.

Commands: `pnpm exec tsx games/ball-bros/smoke.ts` and `pnpm exec tsx games/ball-bros/online-smoke.ts`, with `ONLINE_URL=http://localhost:8792/`.

- [Solo desktop](desktop.png): 1440×1000, after launch and block damage.
- [Solo phone](phone.png): 390×844, five touch controls.
- [Online lobby](online-lobby.png): two humans, three bots, room invite and manager start.
- [Online arena](online-arena.png): live WebRTC match.
- [Phone controller](controller.png): shared-screen controls and personal identity.
- [TV display](display.png): shared arena without consuming a player seat.

The solo run completed a round, rematched, restarted and exercised combined orbit/reach controls. The online run covered create failure/retry, reload recovery, identical results/rematch, creator departure, shared TV/phone mode and refused-storage creation/reconnect. No injected game state or accelerated clock was used. Phone screenshots are browser emulation, not physical-phone or cross-network evidence.
