# AI riders

The room host can click **ADD AI** on phone or desktop, then start a race with one human and one or more AI opponents. Humans plus AI share five rider slots. An AI added during a race joins the next round automatically. Use **×** beside its roster entry to remove it in the lobby, between rounds or after a match. During racing/countdown, return to the menu first if removal is needed.

Bots consume no WebRTC connection or backend membership. Their controller runs inside the simulation itself on every device, because each replica folds the same input log and the AI reads only that folded state (it is deterministic, seeded from the match). It emits ordinary left/right/fire/aim inputs; shared movement, charge, cooldown, collision, pickups, eliminations and scoring remain unchanged. The initial controller is a lightweight survival/attack opponent, not expert competitive AI.

**Every part of a decision must be a pure function of folded state.** `World.rewind` restores the folded state from a snapshot and replays `applyTick`, but it does not restore anything the controller kept for itself, so a remembered decision would replay differently than it was first played and diverge the room. This is why a weak rider's lapses are keyed off the tick number (`BOT_BLUNDER_WINDOW`) rather than held in the controller.

## Difficulty

Every newly added AI uses **Hard** difficulty, with a plain name such as `AI Turing`. The roster, scoreboard and recap do not show a difficulty label. Hard uses full lookahead and no attention lapses; the attract screen uses the same full-strength controller.

The controller still recognizes explicit Easy/Medium/Hard suffixes in existing logs and benchmark fixtures, preserving their deterministic replay. `BOT_TIERS` defines those settings; new bot creation does not roll a difficulty or encode one in the name.

Measured over 100 matches per pairing, four riders, seating swapped and spawns jittered (identical deterministic brains on symmetric spawns mirror each other into a simultaneous crash, which measures the arena rather than the riders): Easy loses to Medium, Medium loses to Hard, and Easy loses to Hard by a wide margin. Reproduce with `npx tsx scripts/ai-league.ts 100`.

`src/shared/bot-controller.ts` evaluates 15 bounded steering plans over 32 fixed ticks (1.6 seconds), with at most 512 nearby existing trail segments. Plans include straight travel and left/right turns lasting 2, 4, 8, 12, 16, 24 or 32 ticks, followed by straight travel. Every tick it replans through the shared motion kernel. Swept collision checks consider existing trails, the bot’s projected own trail, opponents continuing straight and laying new trails, heads, projectiles, blasts and shrinking overtime walls. Predicted survival takes priority over clearance or chasing a target; equally safe plans prefer room away from walls and trails. It still heads toward pickups/opponents and uses the same ordinary charged, target, shell and cannon attacks. Deterministic injected tie-breaking uses its own stateless stream, leaving pickup randomness untouched. It never examines future human controls or future drops.

Online, an AI rider is a management entry in the creator's stream (`BOT add`/`remove` in `src/shared/apply-tick.ts`): every replica seats it and simulates it, the bot set travels inside the world snapshot a joiner installs, and a stream named after a bot is ignored, so no client can steer one. The physics/snapshot player shape does not gain a client-controlled bot flag.

Validation commands:

```sh
npx tsx --test tests/bot-controller.test.ts
npx tsx scripts/benchmark-bots.ts
npx tsx scripts/benchmark-bot-survival.ts
# Run against an isolated local room service serving the current build (`npm run dev:online`).
```

The browser checks create disposable rooms and verify desktop/phone add/remove/solo-start and real round scoring. They must not target an occupied room.

Initial Node 22 / macOS arm64 measurement: four decisions together took p95 about **0.10 ms** with no trails, **0.18 ms** with 800 trails and **0.44 ms** with 4,000 trails. Each workload used 50 warmups and 500 samples; raw samples/method are in the generated benchmark report. This measures decision overhead only, not rendering, simulation, network or physical phone performance. Re-run after changes; it is not an online release certification.

Steering changes and their measured limits are recorded in [BOT-STEERING-2026-09-16.md](BOT-STEERING-2026-09-16.md). Prediction remains an approximation: it does not simulate opponent decisions, portal transit or shell bounces. Each peer must use the same bot rules for deterministic online replay; this change does not establish compatibility between old and new builds.
