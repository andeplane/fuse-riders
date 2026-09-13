# Fuse Riders architecture

This is the accepted implementation contract derived from ADR-001 through ADR-003 and the independent review in `docs/adr/review.md`.

## Runtime and trust boundary

```text
phone /controller -- validated intents --> Node HTTP + ws server -- complete snapshots --> /display -- HDMI --> TV
        reconnect token <-------------- authoritative simulation ------------ events (effects only)
```

One Node process binds `0.0.0.0` on a configurable port, serves both browser surfaces, and owns the only mutable match. At startup it discovers and prints a private-LAN controller URL and a host display URL. `HOST_IP` may override interface detection when needed. The QR contains only `http://<lan-address>:<port>/controller`; this single-room household-LAN MVP has no lobby admission secret or matchmaking.

The server also prints `http://<lan-address>:<port>/display#<host-token>`. The fragment is read by the display, removed from browser history with `history.replaceState`, and sent once in `hostAuth`; URL fragments are never included in HTTP requests. The server binds host capability to that authenticated WebSocket. Loading `/display` or sending a host-shaped message grants no authority. Host and player tokens never appear in QR payloads, snapshots, controller responses other than the owning player's initial `joined` response, or application logs.

`src/shared/game.ts` is a deterministic rules engine. `src/shared/protocol.ts` is the only wire contract and validates messages before dispatch. `src/server/index.ts` owns sockets, tokens, input buffers, the fixed-step loop, and broadcasting. `src/client/main.ts` selects display/controller mode; `src/client/style.css` owns responsive touch and TV presentation.

## Constants

All world geometry uses continuous coordinates in a 1200 by 700 arena. Slot colours in order are cyan, pink, lime, orange, and violet.

```ts
export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const MAX_CATCH_UP_STEPS = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

export const RIDER_SPEED = 150;          // world units per second
export const RIDER_TURN_RATE = 2.8;      // radians per second
export const RIDER_RADIUS = 7;
export const TRAIL_WIDTH = 6;
export const TRAIL_LIFETIME_TICKS = 160; // 8 seconds
export const SELF_TRAIL_GRACE_TICKS = 10;

export const BOMB_FUSE_TICKS = 40;       // 2 seconds
export const BOMB_COOLDOWN_TICKS = 80;   // 4 seconds between accepted placements
export const BOMB_BLAST_RANGE = 150;
export const BOMB_BLAST_HALF_WIDTH = 12;
export const BLAST_VISIBLE_TICKS = 8;

export const COUNTDOWN_TICKS = 60;
export const ROUND_OVER_TICKS = 60;
export const OVERTIME_START_TICK = 1200; // 60 seconds after round start
export const OVERTIME_INSET_PER_TICK = 0.5;
export const ROUND_DRAW_TICK = 1800;     // 90-second hard limit

export const INPUT_RESEND_TICKS = 2;     // controller resends held state at 10 Hz
export const INPUT_STALE_TICKS = 10;     // neutral after 500 ms without input
export const HEARTBEAT_INTERVAL_MS = 2000;
export const SOCKET_TIMEOUT_MS = 6000;
```

The loop uses a monotonic clock and advances at most five catch-up steps per callback. If more elapsed time remains, it discards the excess and restarts the accumulator from the current monotonic time. Simulation ticks never derive from render frames or client clocks. The server broadcasts every second tick and immediately after authentication, phase transitions, and reconnect. The display renders about 100 ms behind the newest pair of snapshots and interpolates position and angle only; phase, collisions, scores, bombs, trails, and deaths are never predicted.

## Wire contract

```ts
export type PlayerId = string;
export type PlayerToken = string;

export type ClientMessage =
  | { type: 'join'; name: string; playerToken?: PlayerToken }
  | { type: 'input'; seq: number; left: boolean; right: boolean; bomb: boolean }
  | { type: 'heartbeat' }
  | { type: 'leave' }
  | { type: 'hostAuth'; token: string }
  | { type: 'hostAction'; action: 'start' | 'nextRound' | 'rematch' };

export type ServerMessage =
  | { type: 'joined'; playerId: PlayerId; playerToken: PlayerToken; slot: number;
      color: string; nextInputSeq: number }
  | { type: 'hostAuthenticated' }
  | { type: 'snapshot'; matchId: string; round: number; tick: number; state: GameSnapshot }
  | { type: 'event'; matchId: string; round: number; tick: number; event: GameEvent }
  | { type: 'error'; code: 'invalid_message' | 'full' | 'unauthorized' | 'stale' |
      'invalid_phase' | 'not_enough_players' };

export interface TrailSegment {
  x1: number; y1: number; x2: number; y2: number;
  createdTick: number; expiresAtTick: number;
}

export interface BlastRect {
  x: number; y: number; width: number; height: number; // x/y are top-left
}

export interface GameSnapshot {
  phase: 'lobby' | 'countdown' | 'playing' | 'roundOver' | 'matchOver';
  phaseEndsAtTick?: number;
  roundStartedTick?: number;
  width: number; height: number; boundaryInset: number;
  players: ReadonlyArray<{
    id: PlayerId; name: string; slot: number; color: string; connected: boolean;
    x: number; y: number; angle: number; alive: boolean; roundWins: number;
    bombReadyAtTick: number; trail: ReadonlyArray<TrailSegment>;
  }>;
  bombs: ReadonlyArray<{
    id: number; ownerId: PlayerId; x: number; y: number; explodeAtTick: number;
  }>;
  blasts: ReadonlyArray<{
    bombId: number; rects: ReadonlyArray<BlastRect>; expiresAtTick: number;
  }>;
  roundWinnerId?: PlayerId;
  matchWinnerId?: PlayerId;
}

export type GameEvent =
  | { type: 'bombPlaced'; bombId: number; playerId: PlayerId }
  | { type: 'explosion'; bombId: number }
  | { type: 'playerEliminated'; playerId: PlayerId;
      cause: 'wall' | 'trail' | 'explosion' | 'rider' }
  | { type: 'roundEnded'; winnerId?: PlayerId }
  | { type: 'matchEnded'; winnerId: PlayerId };
```

Snapshots contain every fact needed to reconstruct the current screen. Events only trigger transient sound, vibration, and particles; missing an event cannot change rendered gameplay state. Every envelope carries match, round, and tick scope. Clients discard messages from an older match/round, snapshots with a strictly older tick, and events already handled at that tick; equal-tick snapshots are accepted as replacements.

Runtime validation rejects unknown discriminants or fields, non-booleans, non-integer or unsafe sequences, non-finite numbers, names longer than 18 Unicode code points, and messages larger than 2 KiB. Names are inserted with text APIs, never HTML. Only a joined socket may send input/leave; only the host-authenticated socket may send host actions. Input is rate-limited to 30 messages per second per socket and joins to five attempts per minute per address.

## Server dependency boundaries

`src/server/index.ts` receives a type-safe `ServerDependencies` object so tests can control time and connection checks without real timers:

```ts
export interface InputTransport { send(message: ServerMessage): void; }
export interface ServerDependencies {
  now: () => number;
  token: () => string;
  manualAdvance?: boolean;
  checkConnections?: () => void;
  inputTransport?: InputTransport;
}
```

Production supplies real clock, token, connection-check, and transport implementations. Tests inject deterministic functions, manually advance the server, and collect messages through `InputTransport`.

## Seat and socket lifecycle

A join without `playerToken` may claim the lowest free slot in `lobby`, `roundOver`, or `matchOver`; a join during `countdown` or `playing` receives `invalid_phase`. `matchOver` is an inactive boundary where a new party may replace seats, but only authenticated `rematch` resets wins and starts a new match. The sixth occupied seat receives `full`. A new seat gets a cryptographically random 128-bit player token which remains valid until explicit leave, replacement after the reconnect grace described below, or server restart. `removePlayer` is also permitted at `matchOver` while preparing a rematch.

A matching token reclaims the same seat in any phase and receives a complete snapshot plus `nextInputSeq = lastAcceptedSeq + 1`. If its old socket is still open, the server closes the old socket, neutralizes its input, and binds the seat to the new socket. A token can never claim another seat. Invalid tokens receive `unauthorized` and never fall through to new-seat admission.

Socket close or a six-second heartbeat timeout marks the player disconnected and immediately sets left/right/bomb false. The rider continues straight while disconnected because neutral intent has no steering; the current round still treats it as alive. The seat is reserved through the current round and following `roundOver` interval. If it has not reconnected when the next countdown is requested, it is removed before participant validation. Explicit leave in `lobby`/`roundOver` frees the seat immediately. Explicit leave during `countdown`/`playing` marks the rider dead, neutralizes input, and reserves the seat until that round ends.

Controllers send the full current input state whenever it changes and every two ticks while any control is held. Input sequences increase across reconnects using `nextInputSeq`. Non-increasing sequences are rejected as stale. If no input arrives for ten ticks, the server uses neutral intent. `pointerup`, `pointercancel`, `blur`, `visibilitychange`, page teardown, socket close, and watchdog timeout all clear every held control locally or authoritatively. Bomb presses are rising edges in accepted input, and reconnect always begins with bomb false, so an old press cannot place a bomb.

## Match lifecycle and engine API

Legal transitions are:

```text
lobby --start (2..5 connected seats)--> countdown --> playing
playing --one/zero alive or hard timeout--> roundOver
roundOver --automatic after 3 seconds (2..5 connected seats, no winner at five)--> countdown
playing --winner reaches five--> matchOver
matchOver --rematch (2..5 connected seats)--> countdown of a new match
```

Countdown and round-over timers are authoritative. Host `start` and `rematch` are valid only at their corresponding source phase. After the three-second round-over presentation, the server boundary automatically calls `startNextRound` when at least two connected seats remain; the engine remains in `roundOver` until that guarded server command runs. A new match gets a new `matchId`, resets all wins, and starts at round 1. A next round increments `round` and preserves wins. Both reset alive state, positions, directions, trails, bombs, blasts, cooldowns, and buffered input.

Participants are the connected seats at countdown creation, sorted by slot. For N players, spawn points are equally spaced on a circle centered in the arena with radius `0.28 * min(width, height)`. Player zero starts at angle `-pi/2`; each next player adds `2*pi/N`. Each heading is the clockwise tangent (`spawnAngle + pi/2`). This gives two players opposite spawns and evenly spaces three to five players.

The engine exports explicit command boundaries rather than a generic phase setter:

```ts
export function createGame(matchId: string): GameState;
export function addPlayer(state: GameState, player: PlayerIdentity): void; // lobby/roundOver/matchOver only
export function removePlayer(state: GameState, playerId: PlayerId): void; // lobby/roundOver/matchOver
export function startMatch(state: GameState): void;      // lobby -> countdown
export function startNextRound(state: GameState): void;  // roundOver -> countdown
export function resetMatch(state: GameState, newMatchId: string): void; // matchOver -> countdown
export function step(state: GameState, inputs: ReadonlyMap<PlayerId, InputIntent>): TickResult;
export function toSnapshot(state: GameState): GameSnapshot;
```

These commands and `step` are the only game-state mutators. The periodic server loop calls only `step`; join and authenticated host handlers call the guarded commands.

## Deterministic tick transaction

`step` increments the tick and then performs these phases exactly once:

1. Expire trail segments and visible blasts whose expiry tick is less than or equal to the new tick. Advance phase timers. Countdown transitions automatically to playing at `phaseEndsAtTick`; round-over remains authoritative until the server's automatic next-round boundary invokes `startNextRound` after its end tick.
2. For each alive player in slot order, apply bounded steering and compute a candidate swept movement from the old center to the new center. Do not mutate positions or trails yet.
3. Accept bomb rising edges for players whose candidate exists and whose `bombReadyAtTick <= tick`. Place at the old center, set cooldown, and allow at most one un-exploded bomb owned by a player; otherwise ignore the edge.
4. Resolve every bomb due at or before this tick. A blast is the union of a horizontal and vertical rectangle, each clipped to the current arena boundary: horizontal spans `x +/- BOMB_BLAST_RANGE`, has total thickness `2 * BOMB_BLAST_HALF_WIDTH`, and vertical is analogous. There are no solid obstacles. Any un-exploded bomb whose center lies in a blast is queued; a set guarantees each bomb explodes once. All bombs in the transitive chain use this tick. Add their clipped rectangles to `blasts` through `tick + BLAST_VISIBLE_TICKS`.
5. Remove each entire active trail segment that intersects any new blast rectangle. This intentionally creates a gap at least one tick-segment long. Mark a rider for explosion death if its candidate swept centerline, expanded by `RIDER_RADIUS`, intersects a new blast rectangle.
6. Against the post-blast trail set, compute all remaining deaths without mutating players: boundary if the candidate center crosses the inset arena minus rider radius; trail if the swept center comes within `RIDER_RADIUS + TRAIL_WIDTH/2` of an active segment; rider if two candidate swept centerlines come within `2 * RIDER_RADIUS`. A player ignores only its own segments with `createdTick > tick - SELF_TRAIL_GRACE_TICKS`; endpoints otherwise count as collision. Any pairwise rider collision kills both. Explosion cause takes precedence, then wall, trail, rider for stable event reporting.
7. Commit all deaths simultaneously. Commit candidate position and append the movement as one independent trail segment only for survivors. A rider killed during this tick creates no new segment. Existing trails of dead riders remain until their normal expiry or blast removal.
8. During playing, update overtime, scoring, and phase once. One survivor wins immediately and receives one round win; zero survivors draw with no win. If more than one survives at `ROUND_DRAW_TICK` relative to `roundStartedTick`, the round is a draw. Reaching five wins transitions directly to `matchOver`; otherwise the result is `roundOver`.

Trail segments expire when `expiresAtTick <= tick`, so one created at T with expiry T+160 is active through T+159. Bomb cooldown starts on accepted placement; readiness is `bombReadyAtTick <= tick`. Bombs do not block riders. A player may therefore ride across any bomb before it explodes.

The initial `boundaryInset` is 20 world units. At 60 seconds of playing, `boundaryInset` increases by 0.5 units each tick. The current tick's inset is used by both blast clipping and boundary collision. At 90 seconds, a round with multiple survivors is a draw. These rules replace heuristic no-progress detection.

## Verification gate

Implementation must include focused tests for deterministic replay; exact tick ordering; swept boundary, body, and trail collisions; self grace; simultaneous deaths; trail expiry; blast-created gaps without phantom segments; bomb cooldown/capacity and chain idempotence; first-to-five and draw transitions; fair two-to-five-player spawns; catch-up capping; five-seat admission and sixth rejection; reconnect and duplicate-token replacement; stale input; host authorization; secret omission; malformed messages; full snapshot resync; and controller touch cleanup.
