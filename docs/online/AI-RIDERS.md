# AI riders

The room host can click **ADD AI** on phone or desktop, then start a race with one human and one or more AI opponents. Humans plus AI share five rider slots. An AI added during a race joins the next round automatically. Use **×** beside its roster entry to remove it in the lobby, between rounds or after a match. During racing/countdown, return to the menu first if removal is needed. The LAN TV has the same ADD AI and roster removal controls; its authenticated host token is required.

Bots consume no WebRTC connection or backend membership. Their controller runs inside the simulation itself: on LAN in the Node server, online on every device, because each replica folds the same input log and the AI reads only that folded state (it is deterministic, seeded from the match). It emits ordinary left/right/fire/aim inputs; shared movement, charge, cooldown, collision, pickups, eliminations and scoring remain unchanged.

**Every part of a decision must be a pure function of folded state.** `World.rewind` restores the folded state from a snapshot and replays `applyTick`, but it does not restore anything the controller kept for itself, so a remembered decision would replay differently than it was first played and diverge the room. This is why a weak rider's lapses are keyed off the tick number (`BOT_BLUNDER_WINDOW`) rather than held in the controller.

## Difficulty

Each AI is rolled **Easy**, **Medium** or **Hard** when it is added, and the tier is shown in its name (`AI Turing · Hard`), so the roster, scoreboard and recap all display it without any protocol or checkpoint change. The name is the only per-bot payload the action log carries, so the tier rides in it: `botDisplayName` writes it and `botDifficulty` reads it back, and they cannot drift apart. The roll uses the same injected stateless random stream as the controller, so tests can pin it.

`BOT_TIERS` in `src/shared/bot-controller.ts` holds the knobs: how far the rider looks ahead, how much it values having room left, how badly it aims a target bomb, and how often it stops steering well for a moment. Measured over 100 matches per pairing with seating swapped: Easy loses to Medium 22-75, Medium loses to Hard 34-59, Easy loses to Hard 19-79. Against the previous controller, two against two: Hard wins 65-35, Medium is level at 49-49, and Easy loses 23-75 by design.

## Controller

`src/shared/bot-controller.ts` evaluates three steering choices over its tier's lookahead with at most 512 nearby trail segments. It reuses the pure rider-motion kernel and checks known walls, trails, heads, projectiles and blasts. It heads toward pickups/opponents and uses ordinary charged, target, shell and cannon attacks. Deterministic injected tie-breaking uses its own stateless stream, leaving pickup randomness untouched. It never examines future human controls or future drops.

Beyond surviving the lookahead, Medium and Hard score **how much room is left in front of them** at the end of each candidate turn: a coarse occupancy grid is flooded from the endpoint, counting only cells ahead of the facing plane, because a rider needs about 107px to turn around and a pocket narrower than that is fatal even when the mouth it came through is wide open. This is what stops a rider driving into an area it cannot get out of. Easy weighs no space at all and drives straight in. A deeper multi-turn plan search was built and measured against this and came out inside the noise, so it is not in the shipped controller.

Online, an AI rider is a management entry in the creator's stream (`BOT add`/`remove` in `src/shared/apply-tick.ts`): every replica seats it and simulates it, the bot set travels inside the world snapshot a joiner installs, and a stream named after a bot is ignored, so no client can steer one. The physics/snapshot player shape does not gain a client-controlled bot flag.

Validation commands:

```sh
npx tsx --test tests/bot-controller.test.ts tests/server-bots.test.ts
npx tsx scripts/benchmark-bots.ts
# Headless league: no rendering, network or clock, so tiers are compared by evidence rather than feel.
npx tsx scripts/ai-league.ts 100
# Run against an isolated local room service serving the current build (`npm run dev:online`).
ONLINE_URL=http://localhost:8787/ BUILD_DIRECTORY=dist npx tsx scripts/ai-browser.ts
BROWSER=webkit ONLINE_URL=http://localhost:8787/ BUILD_DIRECTORY=dist npx tsx scripts/ai-browser.ts
```

The browser script creates disposable rooms, verifies desktop/phone add/remove/solo-start and real round scoring, and separately tests an ephemeral LAN TV. It must not target an occupied room. Artifacts include `artifacts/ai-online-desktop.png`, `ai-online-phone.png`, `ai-lan.png` and `bot-benchmark.json`.

Node 22 / macOS arm64 measurement of four Hard decisions together (the most expensive tier): p95 about **0.19 ms** with no trails, **0.36 ms** with 800 trails and **0.80 ms** with 4,000 trails. Each workload used 50 warmups and 500 samples; raw samples/method are in the generated benchmark report. This measures decision overhead only, not rendering, simulation, network or physical phone performance. Re-run after changes; it is not an online release certification.
