# AI riders

The room host can click **ADD AI** on phone or desktop, then start a race with one human and one or more AI opponents. Humans plus AI share five rider slots. An AI added during a race joins the next round automatically. Use **×** beside its roster entry to remove it in the lobby, between rounds or after a match. During racing/countdown, return to the menu first if removal is needed. The LAN TV has the same ADD AI and roster removal controls; its authenticated host token is required.

Bots consume no WebRTC connection or backend membership. Their controller runs in the existing authority (creator browser online, Node server on LAN). It emits ordinary left/right/fire/aim inputs; shared movement, charge, cooldown, collision, pickups, eliminations and scoring remain unchanged. The initial controller is a lightweight survival/attack opponent, not expert competitive AI.

`src/shared/bot-controller.ts` evaluates three steering choices over 16 fixed ticks with at most 512 nearby trail segments. It reuses the pure rider-motion kernel and checks known walls, trails, heads, projectiles and blasts. It heads toward pickups/opponents and uses ordinary charged, target, shell and cannon attacks. Deterministic injected tie-breaking uses its own stateless stream, leaving pickup randomness untouched. It never examines future human controls or future drops.

Online ownership is a host-side bot registry, persisted as a bounded validated `botIds` array in checkpoint container version 3. The physics/snapshot player shape does not gain a client-controlled bot flag. Restored bots reconnect locally with neutral charge; restored humans still require real reconnect. Incompatible older checkpoints are rejected under the existing recovery policy.

Validation commands:

```sh
npx tsx --test tests/bot-controller.test.ts tests/server-bots.test.ts
npx tsx scripts/benchmark-bots.ts
# Run against an isolated Worker/online service serving the current build.
ONLINE_URL=http://localhost:8787/ BUILD_DIRECTORY=dist npx tsx scripts/ai-browser.ts
BROWSER=webkit ONLINE_URL=http://localhost:8787/ BUILD_DIRECTORY=dist npx tsx scripts/ai-browser.ts
```

The browser script creates disposable rooms, verifies desktop/phone add/remove/solo-start and real round scoring, and separately tests an ephemeral LAN TV. It must not target an occupied room. Artifacts include `artifacts/ai-online-desktop.png`, `ai-online-phone.png`, `ai-lan.png` and `bot-benchmark.json`.

Initial Node 22 / macOS arm64 measurement: four decisions together took p95 about **0.10 ms** with no trails, **0.18 ms** with 800 trails and **0.44 ms** with 4,000 trails. Each workload used 50 warmups and 500 samples; raw samples/method are in the generated benchmark report. This measures decision overhead only, not rendering, simulation, network or physical phone performance. Re-run after changes; it is not an online release certification.
