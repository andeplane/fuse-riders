# AI riders

The room host can click **ADD AI** on phone or desktop, then start a race with one human and one or more AI opponents. Humans plus AI share five rider slots. An AI added during a race joins the next round automatically. Use **×** beside its roster entry to remove it in the lobby, between rounds or after a match. During racing/countdown, return to the menu first if removal is needed. The LAN TV has the same ADD AI and roster removal controls; its authenticated host token is required.

Bots consume no WebRTC connection or backend membership. Their controller runs inside the simulation itself: on LAN in the Node server, online on every device, because each replica folds the same input log and the AI reads only that folded state (it is deterministic, seeded from the match). It emits ordinary left/right/fire/aim inputs; shared movement, charge, cooldown, collision, pickups, eliminations and scoring remain unchanged. The initial controller is a lightweight survival/attack opponent, not expert competitive AI.

`src/shared/bot-controller.ts` evaluates three steering choices over 16 fixed ticks with at most 512 nearby trail segments. It reuses the pure rider-motion kernel and checks known walls, trails, heads, projectiles and blasts. It heads toward pickups/opponents and uses ordinary charged, target, shell and cannon attacks. Deterministic injected tie-breaking uses its own stateless stream, leaving pickup randomness untouched. It never examines future human controls or future drops.

Online, an AI rider is a management entry in the creator's stream (`BOT add`/`remove` in `src/shared/apply-tick.ts`): every replica seats it and simulates it, the bot set travels inside the world snapshot a joiner installs, and a stream named after a bot is ignored, so no client can steer one. The physics/snapshot player shape does not gain a client-controlled bot flag.

Validation commands:

```sh
npx tsx --test tests/bot-controller.test.ts tests/server-bots.test.ts
npx tsx scripts/benchmark-bots.ts
# Run against an isolated local room service serving the current build (`npm run dev:online`).
ONLINE_URL=http://localhost:8787/ BUILD_DIRECTORY=dist npx tsx scripts/ai-browser.ts
BROWSER=webkit ONLINE_URL=http://localhost:8787/ BUILD_DIRECTORY=dist npx tsx scripts/ai-browser.ts
```

The browser script creates disposable rooms, verifies desktop/phone add/remove/solo-start and real round scoring, and separately tests an ephemeral LAN TV. It must not target an occupied room. Artifacts include `artifacts/ai-online-desktop.png`, `ai-online-phone.png`, `ai-lan.png` and `bot-benchmark.json`.

Initial Node 22 / macOS arm64 measurement: four decisions together took p95 about **0.10 ms** with no trails, **0.18 ms** with 800 trails and **0.44 ms** with 4,000 trails. Each workload used 50 warmups and 500 samples; raw samples/method are in the generated benchmark report. This measures decision overhead only, not rendering, simulation, network or physical phone performance. Re-run after changes; it is not an online release certification.
