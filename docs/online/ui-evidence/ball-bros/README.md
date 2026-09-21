# Ball Bros phases 0–4

Real muted browser flows captured against the local built service at port 8792. The phase 4 Fuse Frenzy implementation is committed as `d7126d2d`; the earlier phase 3 implementation is `06b5fc2d`. Arena/phone captures preceded the final landing form and room-code contrast adjustment; the landing/lobby captures include it.

Commands: `pnpm exec tsx games/ball-bros/smoke.ts`, `pnpm exec tsx games/ball-bros/online-smoke.ts` and `pnpm exec tsx games/ball-bros/presentation-smoke.ts`, with `ONLINE_URL=http://localhost:8792/`.

- [Solo desktop](desktop.png): 1440×1000, selected Dragon core, live pickup and bomb-ball indicator after launch/damage.
- [Solo phone](phone.png): 390×844, five touch controls.
- [Online lobby](online-lobby.png): human plus bot, room invite and manager start.
- [Online arena](online-arena.png): live WebRTC match.
- [Phone controller](controller.png): shared-screen controls and personal identity.
- [TV display](display.png): shared arena without consuming a player seat.
- [Avatar selection](avatar-choice.png): shared portrait choice before solo/create/join.
- [Portrait fallback](portrait-fallback.png): the atlas request is aborted; gameplay still starts with simple cores.
- [Fuse Frenzy](frenzy.png): the authoritative late-round phase with moving bases, escalating neutral balls, arena pulse and live ball count.

The solo run selected an avatar, observed an active power effect, reached Fuse Frenzy without clock injection, completed a round, rematched, restarted and exercised combined orbit/reach controls. The online run covered create failure/retry, reload recovery, identical results/rematch, creator departure, shared TV/phone mode and refused-storage creation/reconnect. Radio remained off; typed media-player tests cover play/rejection/teardown. No injected game state or accelerated clock was used. Phone screenshots are browser emulation, not physical-phone or cross-network evidence.
