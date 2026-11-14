# Netcode patterns (transport-agnostic TypeScript)

Use these with PartyServer, plain WebSockets, or Geckos. Colyseus 0.18 has them built in (`Predict`), so prefer that there.

## 1. Server clock estimate (needed for interpolation)
```ts
// Server stamps every snapshot with `time` (ms). Client keeps a smoothed offset.
let offset = 0, haveOffset = false;
export function onServerTime(serverMs: number, rttMs: number) {
  const sample = serverMs + rttMs / 2 - performance.now();
  offset = haveOffset ? offset + (sample - offset) * 0.1 : sample;  // EMA; reject outliers if needed
  haveOffset = true;
}
export const serverNow = () => performance.now() + offset;
// RTT: send {t:"ping", c: performance.now()} every 2 s, server echoes, rtt = now - c.
```

## 2. Snapshot interpolation buffer (remote entities)
```ts
type Pos = { x: number; y: number; z?: number };
type Snap<T extends Record<string, Pos>> = { t: number; s: T };
export class InterpBuffer<T extends Record<string, Pos>> {
  private snaps: Snap<T>[] = [];
  starved = 0;                                    // expose in __game.state().net
  constructor(public delayMs = 100) {}
  push(serverTimeMs: number, state: T) {
    if (this.snaps.length && serverTimeMs <= this.snaps[this.snaps.length - 1].t) return; // drop out-of-order
    this.snaps.push({ t: serverTimeMs, s: state });
    if (this.snaps.length > 32) this.snaps.shift();
  }
  sample(nowServerMs: number): T | undefined {
    const t = nowServerMs - this.delayMs, S = this.snaps;
    if (!S.length) return undefined;
    if (t <= S[0].t) return S[0].s;
    for (let i = S.length - 1; i > 0; i--) {
      const a = S[i - 1], b = S[i];
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t), out = {} as Record<string, Pos>;
        for (const id in b.s) {
          const pa = a.s[id] ?? b.s[id], pb = b.s[id];
          out[id] = { ...pb, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k,
                      z: pb.z === undefined ? undefined : (pa.z ?? pb.z) + (pb.z - (pa.z ?? pb.z)) * k };
        }
        return out as T;
      }
    }
    this.starved++;                               // t is newer than the newest snapshot
    return S[S.length - 1].s;                     // hold (or extrapolate ≤250 ms with velocity)
  }
}
// render loop: const view = buf.sample(serverNow()); for (const id in view) if (id !== myId) draw(id, view[id]);
```
Angles: interpolate along the shortest arc (`((b - a + 540) % 360) - 180`). Rotations as quaternions: `slerp`.
Geckos' library does the same: `SI.snapshot.create(state)` on the server, then `SI.snapshot.add(snap)` and `SI.calcInterpolation("x y")` on the client (`@geckos.io/snapshot-interpolation`, BSD-3).

## 3. Client prediction + server reconciliation (your own player)
```ts
import { applyInput, type Input } from "../shared/applyInput";
const DT = 1 / 60;
let seq = 0;
const pending: { seq: number; input: Input }[] = [];
const me = { x: 0, y: 0, vx: 0, vy: 0 };
const visualError = { x: 0, y: 0 };

export function fixedStep(input: Input) {          // called by the fixed-step loop
  const msg = { t: "input", seq: ++seq, ...input };
  socket.send(JSON.stringify(msg));
  pending.push({ seq, input });
  applyInput(me, input, DT);                       // predict now, same code as server
}

export function onSnapshot(snap: { players: Record<string, typeof me>; ack: Record<string, number> }) {
  const auth = snap.players[myId]; if (!auth) return;
  const acked = snap.ack[myId] ?? 0;
  while (pending.length && pending[0].seq <= acked) pending.shift();   // server already applied these
  const before = { x: me.x, y: me.y };
  Object.assign(me, auth);                                             // rewind to authority
  for (const p of pending) applyInput(me, p.input, DT);                // replay unacked inputs
  visualError.x += before.x - me.x; visualError.y += before.y - me.y; // hide the snap visually
}

export function renderPos() {                       // per render frame
  visualError.x *= 0.85; visualError.y *= 0.85;    // ~65-100 ms smoothing at 60 fps
  return { x: me.x + visualError.x, y: me.y + visualError.y };
}
```
Gotchas: the server must step each input with the **same dt** the client used (send inputs per fixed tick, not per frame). If the server tick is 20 Hz and the client 60 Hz, the server applies up to 3 inputs per tick (as in the PartyServer recipe). If `|error|` exceeds a teleport threshold (e.g. 2 m), snap instead of smoothing.

## 4. Lag / jitter / stall injector (test-only, wrap your send and receive)
```ts
export function withNetSim<T>(deliver: (d: T) => void, o = { ms: 60, jitter: 20, stallChance: 0.005, stallMs: 300 }) {
  let lastAt = 0;                                       // keep order (WebSocket/TCP semantics)
  return (d: T) => {
    let at = performance.now() + o.ms + (Math.random() * 2 - 1) * o.jitter;
    if (Math.random() < o.stallChance) at += o.stallMs;   // TCP retransmit spike; WS doesn't "lose" packets
    at = Math.max(at, lastAt); lastAt = at;
    setTimeout(() => deliver(d), at - performance.now());
  };
}
// const send = withNetSim((d: string) => ws.send(d));  ws.onmessage = (e) => recv(e.data) → withNetSim(recv)
// Apply on both directions: one-way 60 ms each ≈ 120 ms RTT. For UDP/Geckos, also allow drops and reordering.
```
Enable it with `?netsim=120,30` so Playwright tests can sweep RTTs.

## 5. Deterministic lockstep (RTS-style)
```ts
const INPUT_DELAY = 4;                        // ticks; hides RTT ≤ INPUT_DELAY * tickMs
const inputs = new Map<number, Map<string, Cmd[]>>();   // tick → player → commands
const sentFor = new Set<number>();                      // ticks we already sent commands for
function localCommand(cmd: Cmd) {
  const target = sim.tick + INPUT_DELAY;
  net.broadcast({ t: "cmds", tick: target, from: myId, cmds: [cmd] }); sentFor.add(target);
  addInput(target, myId, [cmd]);
}
function everyTickBoundary() {                // e.g. 15-20 Hz
  // every peer must send something per tick, even an empty list, so others can advance
  const next = sim.tick + INPUT_DELAY;
  if (!sentFor.has(next)) { net.broadcast({ t: "cmds", tick: next, from: myId, cmds: [] }); addInput(next, myId, []); sentFor.add(next); }
  const ready = inputs.get(sim.tick);
  if (!ready || ready.size < players.length) return showWaiting();   // stall, never guess
  const ordered = [...ready].sort(([a], [b]) => (a < b ? -1 : 1));    // deterministic order
  sim.step(ordered);
  if (sim.tick % 60 === 0) net.broadcast({ t: "hash", tick: sim.tick, h: sim.hash() });
}
```
Requirements: bit-identical sim (see the determinism rules in SKILL.md), integer or fixed-point positions for cross-browser play, and identical initial state + seed. Late joiners need a state snapshot + command log. Save the command log as the replay file.

## 6. Interest management (MMO-lite, big maps)
- Grid the world into cells (e.g. 32 m). Each client subscribes to its cell + 8 neighbours. Only send entities in subscribed cells.
- Colyseus: `StateView` / filtered views (check docs for 0.18). PartyServer: build per-connection snapshots in `tick()`.
- Update rate by distance: near 20 Hz, far 5 Hz, off-screen 1 Hz.

## 7. Nakama (meta: auth, matchmaking, leaderboards). Check docs for exact signatures
```ts
import { Client } from "@heroiclabs/nakama-js";
const client = new Client("defaultkey", "127.0.0.1", "7350", false);
const session = await client.authenticateDevice(deviceId, true);
await client.writeLeaderboardRecord(session, "weekly", { score: 1200 });
const socket = client.createSocket(false, false);
await socket.connect(session, true);
socket.onmatchmakermatched = async (m) => { const match = await socket.joinMatch(m.match_id, m.token); /* ... */ };
await socket.addMatchmaker("*", 2, 4);
```
Run locally: `docker compose up` with the Nakama + Postgres/CockroachDB compose file from heroiclabs docs. Authoritative match logic lives in server modules (Go, TypeScript or Lua).
