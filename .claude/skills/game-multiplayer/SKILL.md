---
name: game-multiplayer
description: Load when a game needs online play (co-op, PvP, party, MMO-lite, turn-based, async) or accounts/matchmaking/leaderboards. Covers choosing Colyseus / PartyServer on Cloudflare Durable Objects / Geckos.io / Nakama / Photon / Godot / Unity netcode, client-side prediction, reconciliation, interpolation, lag compensation, rollback and deterministic lockstep, hosting on Cloudflare, and how to test netcode under latency.
---

# Multiplayer: architecture, netcode, hosting, testing

Multiplayer multiplies every bug. Decide the **authority model** and **netcode technique** before writing gameplay, and keep the simulation in a **shared, deterministic module** that both server and client import (the sim never imports the renderer).

## 1. Pick the stack by game type

| Game type | Web (three.js / Phaser) | Godot 4 | Unity 6 | Why / when NOT |
|---|---|---|---|---|
| Turn-based, board, party, async, ≤8 players, latency-tolerant | **PartyServer** (`cloudflare/partykit`, ISC) on **Durable Objects** with hibernation | `WebSocketMultiplayerPeer` + `@rpc` | Unity Multiplayer Services (Lobby/Relay) or Photon Realtime | One DO per room, costs nothing idle. Not for 60 Hz physics with many players |
| Real-time action, 2-32 players, server-authoritative | **Colyseus 0.18** (MIT, ~7.5k★): rooms, schema sync, **built-in prediction, reconciliation, interpolation and lag compensation** (Aug 2026) | `MultiplayerSpawner`/`MultiplayerSynchronizer` + **netfox** (MIT, ~1.1k★) | **Photon Fusion 2** (competitive) or Netcode for GameObjects (co-op) | Needs a Node host (not Workers). Below 1.0 (0.18 is "the last before 1.0") |
| Fast shooter/physics in the browser, want UDP-like | **Geckos.io 3** (BSD-3, ~1.5k★, WebRTC DataChannels) + `@geckos.io/snapshot-interpolation` | ENet (desktop only) | Unity Transport (UDP) | Needs open UDP port range on a VPS. No serverless. Many users need TURN |
| Fighting game / precise 2-4 player P2P | **Rollback**: `rollback-netcode` (TS, MIT, early, 5★) or NetplayJS (ISC, 575★, last release 2023). C++: GGPO (MIT) | **netfox** rollback | **Photon Quantum 3** (deterministic ECS + rollback) | Requires a fully deterministic sim + state save/load per frame |
| RTS / hundreds of units | **Deterministic lockstep** (custom, inputs only) | custom lockstep | Quantum 3 | Bandwidth = inputs only. One desync ruins a match. Needs cross-machine determinism |
| Accounts, matchmaking, leaderboards, storage, chat, parties | **Nakama** (Apache-2.0, ~13.3k★, Go server + Postgres/CockroachDB, JS/Godot/Unity SDKs) | `nakama-godot` | `nakama-unity` | Self-hosting Nakama is real ops work (DB, upgrades). Use it for meta, with game rooms elsewhere if you like |
| Jam / prototype P2P, no server | **Trystero** (MIT, serverless WebRTC signaling) or PeerJS | WebRTC peer | Photon free tier | No authority: cheating trivial, host migration hard |
| Unity live-ops (accounts, wallet, shop, cosmetics, achievements, daily rewards) | n/a | n/a | **Alchemishty/Multiplayer-LiveOps-Toolkit** (MIT, Unity 2022.3, NGO, Django backend) | Real but brand-new (~2★, Unity 6 "on roadmap"). Treat as reference code |
| Unreal | n/a | n/a | n/a | Built-in replication (+ Iris). Install `quodsoler/unreal-engine-skills` → `ue-networking-replication`, `ue-gameplay-framework` |

Photon: Fusion 2 and Quantum 3 include a free 100 CCU tier (check current pricing). Photon is proprietary SaaS. Colyseus Cloud and Heroic Cloud (Nakama) are managed options if you don't want ops.

## 2. Netcode techniques (what to use when)

| Technique | What it does | Needs | Use for |
|---|---|---|---|
| Snapshot **interpolation** | Render remote entities ~100 ms in the past, lerping between two server snapshots | Server timestamps, a buffer of ≥3 snapshots | Every real-time game, for *other* players |
| Client-side **prediction** | Apply your own input immediately with the same `applyInput` as the server | Shared deterministic-enough movement code | Your own character (otherwise controls feel 100+ ms laggy) |
| Server **reconciliation** | On a snapshot: reset to the authoritative state, drop acked inputs, replay unacked ones, smooth the visual error | Input sequence numbers + server ack | Always, together with prediction |
| **Lag compensation** | Server rewinds hitboxes to what the shooter saw | Position history per tick | Hitscan/melee PvP |
| Dead reckoning | Extrapolate with velocity when snapshots are late | Velocities in snapshots | Vehicles and ships. Cap it at ~250 ms |
| **Rollback** | Everyone simulates with predicted remote inputs. On late input, load the old state and resimulate | Deterministic sim, cheap `serialize/deserialize`, fixed tick | Fighting, sports, 2-4 player action, P2P |
| **Lockstep** | All peers advance tick T only once every input for T arrived (with input delay) | Bit-exact determinism, inputs only | RTS, huge unit counts, replays |

Defaults: server tick 20-30 Hz (Colyseus example: `setFixedTimestep(…, 30)`), client sim 60 Hz, interpolation delay ≈ 2-3 snapshot intervals, inputs sent every client tick with a sequence number. Quantize what you send (positions to cm, angles to 1/256 turn).

## 3. Recipes

### A. Project layout (enforced split)
```
shared/   applyInput.ts, sim.ts, schema.ts, constants.ts   ← pure TS, no DOM, no three/phaser, no Date/Math.random
server/   room code imports shared/*
client/   rendering + input + netcode, imports shared/*
```
Use the ESLint `no-restricted-imports` / `no-restricted-properties` block from `game-debug-tools`, applied to `shared/**`, plus a Node test that runs `shared/sim` for 10k ticks.

### B. Colyseus 0.18 with built-in prediction (from the 0.18 docs; verify against your version)
```bash
npm create colyseus-app@latest server   # scaffolds app.config + room; client: npm i @colyseus/sdk
```
```ts
// shared/MoveInput.ts
import { schema, t, type SchemaType } from "@colyseus/schema";
export const MoveInput = schema({ moveX: t.int8, moveY: t.int8, jump: t.boolean }, "MoveInput");
export type MoveInput = SchemaType<typeof MoveInput>;
// shared/applyInput.ts: pure function used by server AND client reconciler
export function applyInput(p: { x: number; y: number }, cmd: MoveInput, dt: number) {
  p.x += Math.sign(cmd.moveX) * 6 * dt; p.y += Math.sign(cmd.moveY) * 6 * dt;   // clamp: never trust input
}
```
```ts
// server/src/GameRoom.ts
import { Room, type Client } from "@colyseus/core";
import { schema, t } from "@colyseus/schema";
import { MoveInput } from "../../shared/MoveInput";
import { applyInput } from "../../shared/applyInput";
export const Player = schema({ x: t.float32, y: t.float32 }, "Player");
export const GameState = schema({ players: t.map(Player) }, "GameState");

export class GameRoom extends Room {
  maxClients = 8;
  state = new GameState();
  inputs = this.defineInput(MoveInput, { bufferMaxSize: 64 });      // per-session buffered inputs
  onCreate() { this.setFixedTimestep((ctx) => this.step(ctx), 30); } // 30 Hz, advertised to clients
  onJoin(client: Client) { this.state.players.set(client.sessionId, new Player()); }
  onLeave(client: Client, code: number) { this.state.players.delete(client.sessionId); } // 0.17+: close code
  step(ctx: { dt: number; tick: number }) {
    for (const [sid, p] of this.state.players) {
      const cmd = this.inputs.get(sid).next();     // one input per tick
      if (cmd) applyInput(p, cmd, ctx.dt);
    }
  }
}
// server/src/app.config.ts:  export const server = defineServer({ rooms: { game: defineRoom(GameRoom) } });
```
```ts
// client/net.ts
import { Client, Callbacks, Predict } from "@colyseus/sdk";   // check docs for Predict's import path
import { MoveInput } from "../shared/MoveInput";
import { applyInput } from "../shared/applyInput";
const client = new Client("http://localhost:2567");          // Client<typeof server> for end-to-end types
const room = await client.joinOrCreate("game");
const predict = Predict.get(room, { mode: "lerp", delay: 100 });
predict.attachAll("players", { mode: "lerp", fields: ["x", "y"] });   // remote players: interpolated
const input = room.input({ type: MoveInput });
if (input.tickRate === undefined) throw new Error("server did not advertise a fixed tick rate");
let me: ReturnType<typeof predict.reconciler> | undefined;
Callbacks.get(room).onAdd("players", (p, sid) => {          // reconciler watches input.send() itself
  if (sid === room.sessionId) me = predict.reconciler(p, { input, step: (ctx, s, cmd) => applyInput(s, cmd, ctx.dt), smoothMs: 65 });
});
function frame(now: number) {
  const n = predict.tick(now);                                  // fixed steps due this frame
  for (let i = 0; i < n; i++) { input.data.moveX = keys.x; input.data.moveY = keys.y; input.send(); }
  for (const [, p] of room.state.players) drawPlayer(predict.value(p, "x"), predict.value(p, "y"));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
Also in 0.18: `this.allowRewindState({ maxRewindMs: 500 })` + `rewind.lastSeenBy(sessionId)` (lag compensation), `import "@colyseus/sdk/debug"` (drift telemetry + latency simulator), and `room.request()`. The open-source "Prediction Playground" has 12 labs.

### C. PartyServer on Cloudflare Durable Objects (authoritative room)
```bash
npm i partyserver partysocket && npm i -D wrangler
```
```ts
// worker/src/index.ts
import { routePartykitRequest, Server, type Connection } from "partyserver";
import { createSim, applyInput, type Input } from "../../shared/sim";
type Env = { GameRoom: DurableObjectNamespace };

export class GameRoom extends Server<Env> {
  // static options = { hibernate: true };   // turn-based: enable, keep state in this.ctx.storage
  sim = createSim();
  queue = new Map<string, (Input & { seq: number })[]>();
  ack: Record<string, number> = {};
  timer?: ReturnType<typeof setInterval>;

  onConnect(conn: Connection) {
    this.sim.addPlayer(conn.id);
    conn.send(JSON.stringify({ t: "welcome", id: conn.id, tick: this.sim.tick }));
    this.timer ??= setInterval(() => this.tick(), 50);          // 20 Hz while anyone is connected
  }
  onMessage(conn: Connection, raw: string | ArrayBuffer) {
    const m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    if (m.t === "input" && Number.isInteger(m.seq)) {
      const q = this.queue.get(conn.id) ?? []; if (q.length < 32) q.push(m); this.queue.set(conn.id, q);
    }
  }
  onClose(conn: Connection) {
    this.sim.removePlayer(conn.id); this.queue.delete(conn.id); delete this.ack[conn.id];
    if ([...this.getConnections()].length === 0) { clearInterval(this.timer); this.timer = undefined; }
  }
  tick() {
    for (const [id, q] of this.queue) for (const m of q.splice(0, 3)) {   // ≤3 inputs/tick/player
      applyInput(this.sim, id, m, 1 / 20); this.ack[id] = m.seq;
    }
    this.sim.tick++;
    this.broadcast(JSON.stringify({ t: "snap", tick: this.sim.tick, time: Date.now(), players: this.sim.snapshot(), ack: this.ack }));
  }
}
export default {
  async fetch(req: Request, env: Env) {
    return (await routePartykitRequest(req, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```
```jsonc
// wrangler.jsonc
{ "name": "my-game", "main": "worker/src/index.ts", "compatibility_date": "2026-10-01",
  "durable_objects": { "bindings": [{ "name": "GameRoom", "class_name": "GameRoom" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }] }   // add a new tag per class change
```
```ts
// client
import { PartySocket } from "partysocket";
const ws = new PartySocket({ host: "my-game.<you>.workers.dev", party: "game-room", room: roomCode }); // binding → kebab-case
```
Client prediction, reconciliation and interpolation for this transport: `references/netcode-patterns.md`.

**Cloudflare notes.** A DO is single-threaded and lives where it was first created (pass `locationHint` via `routePartykitRequest(req, env, { locationHint })`). An interval keeps it awake (duration billing). Hibernation drops memory, so persist via `this.ctx.storage` or `connection.setState()` (≤2 KB). For P2P WebRTC, use Cloudflare Realtime TURN or coturn. Static client: Workers static assets or Pages. `npx wrangler dev` runs everything locally.

### D. Rollback (P2P) shape
```ts
import type { Game, PlayerId } from "rollback-netcode";      // npm i rollback-netcode (early; API may change)
class Fight implements Game {
  s = initialState(seed);                                    // all numbers, no objects with methods
  serialize() { return encode(this.s); }                     // Uint8Array, must be cheap (called often)
  deserialize(b: Uint8Array) { this.s = decode(b); }
  step(inputs: Map<PlayerId, Uint8Array>) { simulate(this.s, [...inputs].sort(([a], [b]) => (a < b ? -1 : 1))); }
  hash() { return hashState(this.s); }                       // desync detection
}
// createSession(...) + WebRTCTransport + your signaling: see the README
```
Godot: netfox `RollbackSynchronizer`. Unity: Quantum 3.

## 4. Determinism rules (rollback + lockstep; also helps replays)

- Fixed tick. Inputs are the only external data. Seeded RNG lives **inside** the state.
- Iterate entities in sorted id order, never in hash/insertion order that differs between peers.
- JS `+ − × ÷` and `Math.sqrt` are IEEE-exact everywhere. **`Math.sin/cos/tan/atan2/exp/log/pow` may differ between V8, SpiderMonkey and JavaScriptCore.** Cross-browser lockstep needs lookup tables, fixed-point math or a deterministic math lib. Same-engine-only (Electron, server replays) is safer.
- Physics: Rapier's deterministic builds (`@dimforge/rapier2d-deterministic-compat`, 3D equivalent). Matter, Phaser Arcade and cannon are not guaranteed.
- Hash the state every N ticks and exchange hashes. On mismatch, dump both states for diffing.

## 5. Pitfalls

- **PartyKit hosted platform is gone:** deploys stopped 16 Oct 2026 and it shut down 23 Oct 2026. `npx partykit deploy` no longer works. Use `partyserver` + `wrangler deploy`. Old `party/server.ts` tutorials use `onMessage(message, sender)`. PartyServer is `onMessage(connection, message)`.
- **Colyseus version soup:** ≤0.16 tutorials use `colyseus.js`, `@type` decorators, `onLeave(client, consented)` and `getStateCallbacks`. 0.17+ uses `@colyseus/sdk`, `Callbacks.get(room)`, `defineServer/defineRoom` and `onLeave(client, code)`. 0.18 brings Schema 5 (`schema({...}, "Name")`), a **63-field per-schema limit**, removes `client.id`, and renames `setSimulationInterval`→`setTimestep`. Check `package.json` first.
- **Trusting clients:** never accept positions, damage or hit results. Clamp inputs (Colyseus `defineInput(..., { sanitize })`) and rate-limit (`maxMessagesPerSecond`). Validate hits server-side with rewind.
- **Full JSON state at 60 Hz** melts bandwidth. Send 20-30 Hz deltas (Colyseus schema does this). Quantize. Interest management sends only nearby entities.
- **Rendering remote players at the latest snapshot** jitters. Always buffer and interpolate with a delay.
- **No input sequence numbers** makes reconciliation impossible. Snap back on every packet.
- **Testing at 0 ms localhost** hides every netcode bug. Always test at 100-150 ms RTT + jitter.
- **Geckos.io:** needs a UDP `portRange` open in the firewall and ESM + Node ≥16. Can't run on Workers/Vercel.
- **Godot web exports can't use ENet.** Use `WebSocketMultiplayerPeer` / `WebRTCMultiplayerPeer`.
- **Licences:** Nakama, Colyseus, PartyServer, Geckos and netfox are permissive. Photon is commercial SaaS (CCU pricing). Unity NGO is free, but Relay/Lobby are metered.

## 6. Verification

1. **Two-client bot test (Playwright):** open 2-4 pages in one room (`?room=test&bot=1`). Script inputs through `__game.press()`, then stop. After 2 s, assert all clients agree on every player position within ε (e.g. 0.05 m), via `__game.state().net`.
2. **Latency matrix:** run the same test with the injector (`references/netcode-patterns.md`) at {0, 80, 150, 250} ms RTT and 30 ms jitter (and Colyseus' `@colyseus/sdk/debug` simulator). Assert the max reconciliation correction (px) and the interpolation-buffer starvation count stay under budget.
3. **Net HUD:** `__game.state().net = { rtt, serverTick, snapBuffer, predErrorPx, inputsPending, bytesPerSec }`, also drawn on screen for screenshots.
4. **Determinism:** run the shared sim twice from recorded inputs and compare hashes every 60 ticks. For rollback/lockstep, also run in Chromium, Firefox and WebKit (Playwright projects) and compare.
5. **Load:** a Node bot script (or `@colyseus/loadtest`) runs N rooms × 8 bots for 5 min. Watch server tick duration (<50% of the tick budget) and memory.

## 7. Install instead of reinventing

- `gamedev-skills/awesome-gamedev-agent-skills`: `godot-multiplayer`, `roblox-networking`.
- `quodsoler/unreal-engine-skills` (MIT): `ue-networking-replication`, `ue-gameplay-framework`.
- `Jeffallan/claude-skills` → `skills/game-developer` (has a multiplayer section; generic).
- Listed on claudemarketplaces: `multiplayer-game` from `rivet-dev/skills` (Rivet Actors; the path wasn't visible on the repo page, so it's unverified). `rivetkit` (Apache-2.0) is an actor alternative to DOs.
- Colyseus Prediction Playground (open source, linked from the 0.18 blog). `foxssake/netfox` examples (Forest Brawl, rollback debugger).
- Related: `game-debug-tools` (hooks, determinism lint, Playwright harness).
