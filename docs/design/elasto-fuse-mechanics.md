# Elasto Fuse mechanics spec

Reference mechanics for the Elasto Fuse bike physics, recovered by static analysis of the original `Elma.exe`
(PE32 i386, 348160 bytes; version strings `Registered version 1.0` / `Shareware version 1.0`; level magic `POT14`).
The binary was never executed. Only mechanics are documented here; levels and art are original to Elasto Fuse.

Provenance tags used throughout:

- **READ** - read from the binary; the address of the code or data is given.
- **XCHK** - also confirmed against a named public source (URL in section 12).
- **INF** - inferred; not directly proven.

Conventions inside the engine (READ): doubles everywhere, world is **y-up** (gravity "down" is `(0,-1)`), angles in
radians, counter-clockwise positive, `rot90(v) = (-v.y, v.x)`. Level files are y-down; the loader negates y (section 9).
`pi` is the truncated constant `3.141592` (0x44dfa0).

## 1. Summary of the model

- Three rigid bodies: a frame (never collides) and two wheels (circles, collide with level lines). A fourth point mass,
  the **rider point**, is tied to the frame by a stiff spring and clamped to a small region in frame coordinates; the
  **head** (the only thing that dies on ground contact) is a circle at a fixed offset from the rider point.
- Wheels hang from the frame on isotropic spring-dampers (K = 10000, C = 1000). No rigid joints anywhere.
- Integrator: semi-implicit (symplectic) Euler, variable step `dt <= 0.0055` time units, driven by the wall clock.
- Wheel-ground contact is a hard positional constraint with at most two contact points: with one active contact the
  wheel **rolls without slipping** about that point (infinite friction, zero restitution); with two active contacts
  the wheel is frozen. Level lines are two-sided; "ground" vs "sky" is rendering only.
- Gas applies a constant torque to the rear wheel up to a speed limit; brake is a stiff angular spring-damper locking
  both wheels to the frame; volt is an instantaneous change of frame angular velocity (+-12) undone after 0.1 time
  units; turn only toggles a flag.

## 2. Time

| item | value | provenance |
|---|---|---|
| game clock | `now = timeGetTime_ms * 0.182 * 0.0024` | READ 0x43ad40 (0.182 at 0x4475a0), 0x41f1ad (0.0024 at 0x447468) |
| one time unit | `1 / 0.4368 s = 2.28937729 s` | derived from the line above |
| max physics step | `0.0055` units (= 12.59 ms) | READ 0x41f227 (0x447458) |
| step loop | `while (t < now - 1e-6) { dt = min(0.0055, now - t); step(t, dt); t += dt }` | READ 0x41f1a8-0x41f3b8 |
| finish time | `(int)(t * 228.937728938)` hundredths of a second, truncated, `t` = start time of the step in which the exit was touched | READ 0x41fc49 (0x447470) |
| volt cooldown | 0.4 units (0.916 s) | READ 0x41f849, global 0x4537b8 set at 0x401aaa |
| volt duration | `0.4 * 0.25 = 0.1` units (0.229 s) | READ 0x420eb4-0x420eba |

The step is **not fixed**: every rendered frame the simulation catches up to the wall clock in slices of at most
0.0055, the last slice being shorter. Input is sampled once per slice for gas/brake/volt and once per rendered frame
for turn. For a deterministic remake use a fixed `dt` of 0.0055 or smaller (INF: the original feel corresponds to
slices of 0.0055 plus one short remainder per frame).

Time is derived from the physics clock, not from a frame count; the timer shown is `t * 228.94` in 1/100 s.

## 3. Constants

All values READ. "set at" is the instruction that stores the value (init function 0x401940 unless noted).

### 3.1 Bodies (0x401650)

Rigid body record, 0x68 bytes: `+0x20 rot`, `+0x28 angVel`, `+0x30 radius`, `+0x38 mass`, `+0x40 inertia`,
`+0x48 pos (2 doubles)`, `+0x58 vel (2 doubles)`.

| body | bike offset | radius | mass | inertia | initial pos | set at |
|---|---|---|---|---|---|---|
| frame | +0x000 | 0.3 (unused) | 200 | 60.5 | (2.75, 3.6) | 0x4016ca-0x401702 |
| left wheel | +0x068 | 0.4 | 10 | 0.32 | (1.9, 3.0) | 0x401794-0x4017d4 |
| right wheel | +0x0d0 | 0.4 | 10 | 0.32 | (3.6, 3.0) | 0x40186c-0x4018ab |
| rider point | pos +0x158, vel +0x168 | - | (uses frame mass 200) | - | (2.75, 4.04) | 0x4018fe-0x40190a |

Other bike fields: `+0x138` head centre (vec), `+0x148` flipped flag (0 = faces left, the initial state),
`+0x150` gravity direction (0 up, 1 down, 2 left, 3 right; initial 1), `+0x178` apples taken, `+0x17c` previous brake,
`+0x180/+0x188` brake reference angles (left/right), `+0x190/+0x194` right/left volt active, `+0x198/+0x1a0` volt start
times, `+0x1a8/+0x1b0` frame angular velocity saved at volt start.

Derived at init (0x401c9d-0x401d73) from the initial positions:

| name | value | global |
|---|---|---|
| left wheel rest offset in frame coords | (-0.85, -0.6) | x 0x453790, y 0x453788 |
| right wheel rest offset | (0.85, -0.6) | x 0x4537a8, y 0x4537a0 |
| rider point rest height above frame centre `H` | 0.44 | 0x4537b0 |

### 3.2 Forces and controls

| name | value | units | address | used at |
|---|---|---|---|---|
| gravity acceleration `g` | 10 | units/time^2 | 0x453700 (set 0x401a5a) | 0x42126a, 0x40343e |
| suspension stiffness `K` | 10000 | force/unit | 0x453798 (set 0x401ad2) | 0x4221d3, 0x4031e2 |
| suspension damping `C` | 1000 | force/(unit/time) | 0x453718 (set 0x401afa) | 0x422558, 0x403381 |
| rider spring factor | 5 (so 50000) | - | 0x4471e8 | 0x4031ea |
| rider damping factor | 3 (so 3000) | - | immediate | 0x40326c |
| gas torque | 600 (right wheel +600 when not flipped, left wheel -600 when flipped) | torque | immediates | 0x420cbe, 0x420ce3 |
| gas speed limit | wheel angVel 110 (applied only while `angVel < 110`, resp. `> -110`) | rad/time | 0x447490, 0x447498 | 0x420ca9, 0x420cce |
| brake angular stiffness | 1000 | torque/rad | 0x447488 (-1000) | 0x420cfe |
| brake angular damping | 100 | torque/(rad/time) | 0x447198 | 0x420d0d |
| volt angular velocity step | 12 | rad/time | 0x44e0b0 | 0x420ed1, 0x42102b |
| volt after-brake | 3 | rad/time | 0x44e0b8 | 0x420f0f, 0x420fc5 |
| volt cooldown | 0.4 | time | 0x4537b8 | 0x41f849 |
| volt duration | 0.1 | time | 0x4537b8 * 0x4473e0 | 0x420eb4 |
| zero-extension threshold of suspension | 1e-4 per axis | units | 0x4473e8, 0x4474a0 | 0x421feb-0x422022 |

### 3.3 Collision and objects

| name | value | address | used at |
|---|---|---|---|
| wheel radius | 0.4 | body record | 0x4021f2 |
| head radius | 0.238 | 0x4537d8 (set 0x401c35) | 0x422874, 0x422936 (XCHK elma-rust `HEAD_RADIUS`) |
| object radius | 0.4 | 0x449268 | 0x436140 (XCHK elma-rust `OBJECT_RADIUS`) |
| head centre offset from rider point | `0.63` along frame up, `0.09` along frame axis (sign by facing) | immediates | 0x420a21, 0x420a73 |
| contact penetration allowance | 0.005 | 0x453730 (set 0x401a46) | 0x4029e4 |
| contact separation speed tolerance | 0.01 | 0x453720 (set 0x401a32) | 0x402b6f |
| contact merge distance | 0.1 | 0x453728 (set 0x401a6e) | 0x435c24 |
| speed threshold between the two 2-contact tests | 1.0 | 0x447190 | 0x40224d, 0x40239e |
| bump sound threshold / scale / cap | 1.5 / 0.125 / 0.99 | 0x449310, 0x4471d8, 0x4471d0 | 0x402c80-0x402c9a |
| collision grid cell | 1.0, padded 6 units around the level, max 200x200 | 0x4474e8 (6) | 0x430100 |
| max polygons / objects / pictures | 300 / 52 / 5000 | immediates | 0x434058, 0x43410e, 0x4341d5 |

### 3.4 Rider point clamp region (frame coordinates, 0x4035b0)

| name | value | set at |
|---|---|---|
| line point `A` | (-0.35, 0.13) | 0x403719-0x403738 |
| line direction `B` | (0.49, 0.23); normal `n = unit(-0.23, 0.49)` | 0x403758-0x403810 |
| max y | 0.48 | 0x4471c0 |
| min x | -0.5 | 0x4471f8 |
| max x | 0.26 | 0x4471c8 |
| quarter ellipse for x > 0, y > 0 | semi-axes 0.26 (x) and 0.48 (y) | 0x403a45-0x403ac8 |

### 3.5 Set but unreferenced by the physics (READ, single write xref each)

`0x453708 = 100`, `0x453b58 = 5`, `0x453b50 = 5`, `0x453710 = 10000`, `0x4537c8 = 0.5`, `0x4537c0 = wheelRadius + 0.5`,
`0x449278 = (0.4 + 0.3)^2`. Vectors `0x453748 = (0.2, 0.05)`, `0x453738 = (-0.6, -0.04)`, `0x453778 = (-0.05, 0.4)`,
`0x453768 = (-0.3, -0.5)`, `0x453758 = (0, 0.6)` are copied by the bike reset at 0x401611-0x401639 (INF: sprite anchor
points for drawing; not used by any force).

## 4. Step pseudocode

Call tree per slice (READ 0x41f840): read volt keys -> `physicsStep` (0x420bb0) -> `deathAndTouch` (0x422810) ->
record frame -> process queued events (0x41fcd0). Order inside `physicsStep` matters and is exactly as below.

```
physicsStep(bike, t, dt, gas, brake, newRightVolt, newLeftVolt):          // 0x420bb0
  F = bike.frame; WL = bike.leftWheel; WR = bike.rightWheel; R = bike.rider
  axis = (cos F.rot, sin F.rot);  up = rot90(axis)

  // brake reference capture (rising edge)
  if brake and not bike.prevBrake:
      bike.relL = WL.rot - F.rot;  bike.relR = WR.rot - F.rot
  bike.prevBrake = brake

  // wheel torques
  tqL = 0; tqR = 0
  if gas:
      if bike.flipped:  if WL.angVel > -110: tqL = -600
      else:             if WR.angVel <  110: tqR = +600
  if brake:                                   // overrides gas on both wheels
      tqL = -1000*(WL.rot - (F.rot + bike.relL)) - 100*(WL.angVel - F.angVel)
      tqR = -1000*(WR.rot - (F.rot + bike.relR)) - 100*(WR.angVel - F.angVel)
  else:
      wrapAngle(WL.rot); wrapAngle(WR.rot)    // 0x421e40: if rot < -pi: rot += 2pi;  if rot > pi: rot -= 2pi

  // suspension forces from the pre-step state
  (FwL, FfL, TfL) = suspension(F, WL, axis, up, (-0.85, -0.6), tqL)
  (FwR, FfR, TfR) = suspension(F, WR, axis, up, ( 0.85, -0.6), tqR)

  // volts act on F.angVel directly, before integration
  volt(bike, t, newRightVolt, newLeftVolt)

  G = gravityVector(bike.gravityDir)          // up (0,1), down (0,-1), left (-1,0), right (1,0)

  riderStep(bike, G, axis, up, dt)                                  // 0x4030a0, uses pre-step frame state
  freeStep(F,  FfL + FfR + G*F.mass*10,  TfL + TfR, dt)            // frame: never collides
  wheelStep(WL, FwL + G*WL.mass*10, tqL, dt)                        // 0x402180 with collide = 1
  wheelStep(WR, FwR + G*WR.mass*10, tqR, dt)
  updateHead(bike)                                                  // 0x4209c0
```

```
suspension(F, W, axis, up, off, tq):                                       // 0x421e80
  rest = axis*off.x + up*off.y                 // rest offset in world axes
  d = (F.pos + rest) - W.pos
  if |d.x| <= 1e-4 and |d.y| <= 1e-4:  Fs = (0,0); Ts = 0
  else:
      n = unit(rest); p = rot90(n)
      Fs = p*(dot(d,p)*10000) + n*(dot(d,n)*10000)         // = d*10000
      Ts = -( |rest| * dot(d,p) * 10000 )
  r = W.pos - F.pos; rn = unit(r); rp = rot90(r); rpn = rot90(rn)
  vrel = (F.vel + rp*F.angVel) - W.vel                     // frame point velocity minus wheel velocity
  D1 = rn  * (dot(vrel, rn)  * 1000)
  D2 = rpn * (dot(vrel, rpn) * 1000)
  T  = rpn * (tq / |r|)                                    // reaction of the wheel torque, as a force pair
  Fwheel = Fs + D1 + D2 - T
  Fframe = -Fs - D1 - D2 + T
  Tframe = Ts - dot(D2, rp)
  return (Fwheel, Fframe, Tframe)
```

Notes: the wheel torque `tq` is applied to the wheel as a torque and to the frame only through the force pair `T`
(equal and opposite forces at the two centres, which carries the reaction torque). The suspension spring is isotropic;
the split into `n`/`p` exists only to compute the frame torque `Ts`.

```
freeStep(B, Fvec, tq, dt):                                                 // 0x4027a6
  B.angVel += tq / B.inertia * dt
  B.rot    += B.angVel * dt
  B.vel    += Fvec / B.mass * dt
  B.pos    += B.vel * dt
```

```
riderStep(bike, G, axis, up, dt):                                          // 0x4030a0
  clampRider(bike, axis, up)                                // section 4.1, position only
  target = F.pos + up*0.44
  d = target - R.pos                                        // length floored at 1e-7 for the normalisation
  Fspring = d * 50000
  vFramePoint = F.vel + rot90(R.pos - F.pos)*F.angVel
  Fdamp = (R.vel - vFramePoint) * 3000
  Ftot = Fspring - Fdamp + G*F.mass*10
  R.vel += Ftot / F.mass * dt                               // mass 200
  R.pos += R.vel * dt
```

The rider point exerts **no reaction** on the frame (READ: the frame force is only `FfL + FfR + gravity`, 0x4212c7).
It is a follower that lags the frame; its only gameplay effects are the head position and the volt kick below.

```
updateHead(bike):                                                          // 0x4209c0
  s = bike.flipped ? +1 : -1
  bike.head = R.pos + axis*(0.09*s) + up*0.63               // axis/up recomputed from the new F.rot
```

### 4.1 Rider clamp (0x4035b0)

```
clampRider(bike, axis, up):
  rel = R.pos - F.pos
  x = dot(axis, rel);  if bike.flipped: x = -x
  y = dot(up, rel)
  n = unit((-0.23, 0.49));  A = (-0.35, 0.13)
  s = dot((x,y) - A, n);  if s < 0: (x,y) -= n*s            // stay above the sloped line
  if y > 0.48: y = 0.48
  if x < -0.5: x = -0.5
  if x > 0.26: x = 0.26
  if x > 0 and y > 0:
      e = (0.48/0.26)^2 * x*x + y*y
      if e > 0.48^2: k = 0.48/sqrt(e); x *= k; y *= k
  R.pos = F.pos + up*y + axis*(bike.flipped ? -x : x)
```

Velocity is not touched by the clamp.

## 5. Controls

Key slots of the per-player key record (READ 0x41f840, 0x41fe20): `+0` gas, `+4` brake, `+8` and `+0xc` volts,
`+0x10` turn. With the swap flag at 0x48564c clear, slot `+0xc` is right volt and slot `+8` is left volt.

### 5.1 Gas (0x420c97-0x420ce3)

Drives the **rear** wheel only: when not flipped (facing left) the right wheel gets `+600` (counter-clockwise, which
rolls the bike towards -x); when flipped the left wheel gets `-600`. The torque is all-or-nothing and is cut while the
driven wheel's angular velocity is at or beyond +-110. There is no other speed limit or drag.

### 5.2 Brake (0x420c48-0x420d3f)

On the rising edge the current angle of each wheel relative to the frame is stored. While held, each wheel receives
`tq = -1000*(angle error) - 100*(wheel.angVel - frame.angVel)`, i.e. the wheels are locked to the frame by a stiff
angular spring-damper (both wheels, and gas is ignored). Through `T` in `suspension` and the rolling constraint this
is what transfers wheel rotation into frame rotation. While not braking, wheel angles are wrapped to (-pi, pi].

### 5.3 Turn (0x41fe57-0x41fe7b)

Rising edge, sampled once per rendered frame: `bike.flipped = !bike.flipped`, then `updateHead`. Nothing else changes:
no positions, velocities or wheel roles are mirrored. The consequences are that the driven wheel swaps (5.1), the
rider clamp region mirrors (4.1) and the head offset `0.09` changes sign.

### 5.4 Volt (0x41f849-0x41f92f, 0x420e7a-0x42114c)

A new volt is accepted when `t > lastVoltTime + 0.4`; both directions share the timer. Accepting sets
`lastVoltTime = t` and queues replay event 6 (right) or 7 (left).

```
volt(bike, t, newRight, newLeft):
  any = newRight or newLeft
  old = F.angVel
  if bike.rightActive and (any or t > bike.rightStart + 0.1):
      F.angVel += 12
      if F.angVel > bike.savedR: F.angVel = bike.savedR
      if F.angVel > 0: F.angVel = max(0, F.angVel - 3)
      bike.rightActive = false
  if bike.leftActive and (any or t > bike.leftStart + 0.1):
      F.angVel -= 12
      if F.angVel < bike.savedL: F.angVel = bike.savedL
      if F.angVel < 0: F.angVel = min(0, F.angVel + 3)
      bike.leftActive = false
  if newRight: bike.rightStart = t; bike.savedR = F.angVel; bike.rightActive = true; F.angVel -= 12   // clockwise
  if newLeft:  bike.leftStart  = t; bike.savedL = F.angVel; bike.leftActive  = true; F.angVel += 12
  if any: R.vel += rot90(R.pos - F.pos) * (F.angVel - old)
```

So a volt is a velocity impulse of 12 rad/time on the frame only (wheels are untouched), held for 0.1 time units and
then taken back, never ending with more spin in the volt direction than before, plus a counter-spin damp of up to 3
when the frame is rotating against the volt direction at that moment. The rider point receives the matching tangential
velocity only when the volt starts.

**Alovolt** (both volt keys accepted in the same slice) is not a separate feature in this version; it falls out of the
code above: both flags are set, the two +-12 steps cancel, both timers start with `savedR = w0` and `savedL = w0 - 12`,
and when they expire in the same slice (right first, then left) the result is asymmetric. Example from rest: right end
gives `+12 -> clamped to 0`, left end gives `-12`, not below `savedL`, then `+3`, leaving `-9` (clockwise). INF from
the READ code; no explicit alovolt branch exists.

## 6. Wheel collision

### 6.1 Geometry (0x42f850, 0x42fce0, 0x430100)

- Every non-grass polygon contributes one segment per edge (vertex i to i+1, closed). Segment record: start, vector,
  unit direction, length. Grass polygons (flag != 0) are skipped (READ 0x42f9a0).
- Segments are **two-sided lines**. Polygon winding, nesting and the even-odd fill rule play no role in physics
  (READ 0x435d10: only distance to the segment is tested). Ground/sky is decided by the renderer only (INF: even-odd
  fill, as public level tools assume).
- Broad phase: uniform grid, cell size 1.0, origin = level bounding box minus 6 units, at most 200x200 cells; each cell
  holds a linked list of the segments passing within `1.5 * max(wheelRadius, headRadius)` of it (READ 0x425a2b,
  0x42fe93). A query looks up the single cell containing the circle centre.

### 6.2 Contact search (0x435ae0, 0x435d10)

```
contacts(c, r) -> (count, p1, p2):
  count = 0
  for seg in cell(c):
      q = closestPointOnSegment(c, seg)        // start point, end point or perpendicular foot
      if distance(c, q) >= r: continue         // strict: contact needs distance < r
      if count == 0: p1 = q; count = 1
      else:                                    // count == 1
          if |p1 - q| < 0.1: p1 = (p1 + q) * 0.5        // merge, still one contact
          else: p2 = q; return (2, p1, p2)              // stop at the second distinct point
  return (count, p1, p2)
```

At most two contact points are ever handled. Points closer than 0.1 are averaged into one.

### 6.3 Wheel step (0x402180)

```
wheelStep(W, Fvec, tq, dt):
  (n, p1, p2) = contacts(W.pos, W.radius)
  if n >= 1: pushOut(W, p1)
  if n == 2: pushOut(W, p2)

  if n == 2:
      if |W.vel| > 1:
          if not staysOnByVelocity(other = p1, pivot = p2, W):      { p1 = p2; n = 1; goto single }
          if not staysOnByVelocity(other = p2, pivot = p1, W):      { n = 1; goto single }
      if |W.vel| < 1:
          if not staysOnByForce(other = p1, pivot = p2, W, Fvec, tq): { p1 = p2; n = 1; goto single }
          if not staysOnByForce(other = p2, pivot = p1, W, Fvec, tq): { n = 1; goto single }
      if not activeContact(W, p2, Fvec): n = 1                      // also strips normal velocity when active
  else if n == 0:
      freeStep(W, Fvec, tq, dt); return

single:
  if activeContact(W, p1, Fvec):
      if n == 2: W.vel = (0,0); W.angVel = 0; return                // wedged: nothing moves this slice
      roll(W, p1, Fvec, tq, dt); return
  else:
      if n == 2: roll(W, p2, Fvec, tq, dt)                          // p2 was found active above
      else:      freeStep(W, Fvec, tq, dt)
```

```
pushOut(W, p):                                                             // 0x402910
  d = |W.pos - p|
  if d < W.radius - 0.005: W.pos += unit(W.pos - p) * (W.radius - 0.005 - d)

activeContact(W, p, Fvec):                                                 // 0x402a70
  n = unit(W.pos - p)
  if dot(n, W.vel) > -0.01 and dot(n, Fvec) > 0: return false       // separating and pushed away: no contact
  vn = n * dot(n, W.vel)
  W.vel -= vn                                                       // inelastic: kill the normal component
  if |vn| > 1.5: emit ground event, volume = min(|vn|*0.125, 0.99)
  return true

staysOnByVelocity(other, pivot, W):                                        // 0x402ed0
  r = W.pos - pivot; tdir = rot90(unit(r))
  return dot(other - pivot, tdir) * ( dot(tdir*|r|, W.vel) + W.angVel ) >= 0

staysOnByForce(other, pivot, W, Fvec, tq):                                 // 0x402cf0
  r = W.pos - pivot; tdir = rot90(unit(r))
  return dot(other - pivot, tdir) * ( dot(tdir*|r|, Fvec) + tq ) >= 0

roll(W, p, Fvec, tq, dt):                                                  // 0x402564-0x40279b
  r = W.pos - p; L = |r|; tdir = rot90(unit(r))
  W.angVel = dot(W.vel, tdir) / W.radius                            // rolling: spin follows linear motion
  angAcc = (dot(Fvec, tdir)*W.radius + tq) / (W.mass*L*L + W.inertia)
  W.angVel += angAcc * dt
  W.rot    += W.angVel * dt
  W.vel     = tdir * (W.angVel * W.radius)
  W.pos    += W.vel * dt
```

Response summary:

- **Restitution**: none. The normal velocity is removed outright.
- **Friction**: infinite. While a contact is active the wheel's spin is slaved to its tangential speed
  (`angVel = v_t / radius`) and all tangential force plus the wheel torque accelerate the wheel as one body about the
  contact point (moment `m*L^2 + I`, with `L` the actual centre-to-contact distance, normally 0.395 to 0.4). Wheelspin
  and sliding do not exist; a braked wheel on the ground therefore drags the frame through the brake spring.
- **Leaving the ground**: a contact is dropped when the wheel moves away from it (normal speed > -0.01) and the net
  force also points away. In that slice the wheel integrates freely, with spin and velocity independent.
- **Two contacts**: either one is discarded because the current motion (speed > 1) or the current force/torque
  (speed < 1) rotates the wheel away from it about the other, or the wheel is completely frozen for the slice
  (`vel = 0`, `angVel = 0`, no integration). At exactly speed 1 neither test runs.
- The wheel is kept at distance `radius - 0.005` from each contact point by direct position correction.

The frame has no collision at all; only the wheels and the head touch the level.

## 7. Death, objects, start, finish

### 7.1 Head (0x4209c0, 0x422810)

- Head circle: radius 0.238, centre `rider + up*0.63 -/+ axis*0.09` (minus when not flipped). At rest that is
  `(frame.x - 0.09, frame.y + 1.07)`, i.e. 1.67 above the wheel axles.
- After every physics step: `if contacts(head, 0.238).count != 0 -> dead` (READ 0x422874-0x422888). Same two-sided
  line test as the wheels; grass polygons excluded.
- Touching a killer object with either wheel or the head also kills (7.2).

### 7.2 Objects (0x436030, 0x422890-0x422990, 0x41fcd0)

- Object record: `+0 x`, `+8 y`, `+0x20 type` (1 exit, 2 food, 3 killer, 4 start), `+0x24 gravity` (0 none, 1 up,
  2 down, 3 left, 4 right), `+0x28 animation`, `+0x2c active`.
- Touch test, for each of left wheel (r 0.4), right wheel (r 0.4), head (r 0.238), in that order:
  `distance(centre, object) < 0.4 + r` (strict). So wheels pick up at 0.8, the head at 0.638. The frame and the rider
  point do not touch objects. One object per part per step: the first active object in list order that passes.
- At level start objects are sorted killers first, then food, then exits (READ 0x4354f0), so a killer wins a tie.
- Food: deactivated immediately, apple counter +1, replay event 4; if its gravity property is 1..4 the bike's gravity
  direction becomes up/down/left/right (property 0 leaves it unchanged) (READ 0x41fd65-0x41fdcc).
- Killer: dead (READ 0x41fd23).
- Exit: finishes only if `applesTaken (both players summed) >= number of food objects in the level`; otherwise
  ignored (READ 0x41fdd2-0x41fdfb). Finish time as in section 2.
- Start: never active as a touchable object. At level start the whole default bike is translated so that the
  **left wheel centre sits on the start object** (READ 0x435368: `delta = start.pos - leftWheel.pos`). With the
  default pose that puts the frame at start + (0.85, 0.6), the right wheel at start + (1.7, 0), facing left.

### 7.3 Gravity directions

`gravityDir` 0 up `(0,1)`, 1 down `(0,-1)`, 2 left `(-1,0)`, 3 right `(1,0)`; magnitude always 10; applies to frame,
wheels and rider point alike (READ jump table 0x421e24, cases at 0x421489, 0x421166, 0x4217a2, 0x421ac8; only the
down case was traced line by line, the other three were checked for the direction constant).

## 8. Timing and scoring

- Finish time: `(int)(t * 228.937728938)` hundredths (section 2). Physics-clock based, so identical inputs with
  identical slices give identical times; in the original the slices depend on frame timing.
- Best times: level files carry two top-ten lists (single player, multiplayer) of 344 bytes each, 688 (0x2b0) total
  (READ 0x4342c0; XCHK elma-rust `PLAYER_TOP10_SIZE = 344`): `int32 count`, `int32 time[10]` in hundredths,
  `char nameA[10][15]`, `char nameB[10][15]` (layout XCHK only). `state.dat` holds the internal levels' lists and
  settings (READ string 0x450390; contents not analysed).

## 9. Level file `.lev`

Layout READ from the loader at 0x433bc0 (polygon 0x419f50, object 0x432390, picture 0x432a60) and XCHK against
elma-rust `lev.rs`. Little-endian.

| offset (POT14) | size | content |
|---|---|---|
| 0 | 5 | `"POT14"`; the loader accepts versions 6 (Across `POT06`) and 14 only (READ 0x433d14-0x433d1c) |
| 5 | 2 | low bytes of the level id (read when version >= 13) |
| 7 | 4 | level id (links replays to the level) |
| 11 | 4 x 8 | integrity doubles (below) |
| 43 | 51 | level name, NUL terminated (15 bytes when version < 14) |
| 94 | 16 | LGR name (version > 6) |
| 110 | 10 | ground texture name (version >= 8) |
| 120 | 10 | sky texture name (version >= 8) |
| 130 | 8 | `polygonCount + 0.4643643` (double) |
| ... | per polygon | `int32 grass` (version >= 8), `int32 n`, then `n` x (`double x`, `double y`) |
| ... | 8 | `objectCount + 0.4643643` |
| ... | per object | `double x`, `double y`, `int32 type`, `int32 gravity` (version >= 9), `int32 animation - 1` (version >= 11) |
| ... | 8 | `pictureCount + 0.2345672` (version > 6) |
| ... | per picture (54 bytes) | `char name[10]`, `char texture[10]`, `char mask[10]`, `double x`, `double y`, `int32 distance`, `int32 clipping` (field order XCHK) |
| ... | 4 | end-of-data marker `0x0067103A` |
| ... | 688 | top-ten block, encrypted |
| ... | 4 | end-of-file marker `0x00845D52` |

For version < 14 the loader seeks to absolute offset 100 before the polygon count (READ 0x434007).

- **y axis**: file y is down. Segments are built with y negated (READ 0x42fb0b, 0x42fb25) and object y is negated once
  after load (READ 0x4356fa).
- **Limits**: 300 polygons, 3..1000 vertices each, 52 objects, 5000 pictures (READ).
- **Integrity** (READ 0x4351e0, 0x434328): `sum = 3247.764325643 * (sum over polygon vertices of (x + y) + sum over
  objects of (x + y + type) + sum over pictures of (x + y))`, using file coordinates. Integrity[0] must equal `sum`
  within 0.01 or the level is "Corrupt". Integrity[1..3] must lie in the ranges [9786, 36546], [9786, 36546],
  [9875, 32345] relative to the sum (READ 0x433dd9-0x433ec5; elma-rust writes `rand % 5871 + 11877 - sum` for them);
  values above 20000 set two flags (XCHK: topology-error and locked markers).
- **Top-ten encryption** (READ 0x434384-0x4343ca; XCHK): `int16 a = 21; int b = 9783;` for each byte:
  `byte ^= a & 0xff; b += (a % 3389) * 3389; a = (int16)(b * 31 + 3389);`.

## 10. Replay file `.rec`

Field layout XCHK against elma-rust `rec.rs`; scales and semantics READ from the recorder/player (0x42cbe0,
0x42d3c0, 0x42cf00).

Header: `int32 frameCount`, `int32 0x83`, `int32 multi`, `int32 flagTag`, `uint32 levelId`, `char levelName[16]`.
Then one array per field, each `frameCount` long:

| field | type | meaning |
|---|---|---|
| bike x, bike y | float32 | frame centre, world units (y-up) |
| left wheel x, y | int16 | offset from frame centre, units of 1/1000 (0x44fee8) |
| right wheel x, y | int16 | same |
| head x, y | int16 | **rider point** offset from frame centre, 1/1000 (this is bike+0x158, not the head circle) |
| bike rotation | int16 | 10000 units per turn (`2*pi/10000`, 0x486998), wrap-aware interpolation |
| left wheel rotation | uint8 | 250 units per turn |
| right wheel rotation | uint8 | 250 units per turn |
| flags | uint8 | bit 0 gas held, bit 1 flipped; bits 2, 3 player/view flags |
| sound byte | uint8 | driven-wheel speed for the engine sound: `min(|angVel|*0.025, 30)` mapped by `2 - e^(-v)` (READ 0x41fba0-0x41fbe6) |
| collision byte | uint8 | suspension/bump strength (not analysed) |

Frames are sampled at 30 per second: `frameIndex = t * 30 * 2.289377289` (READ 0x42cbcc), with linear interpolation on
playback. Capacity 8981 frames (READ 0x42d503).

Events: `int32 count`, then per event `double time` (physics time units), `int16 info`, `uint8 type`, `uint8 pad`,
`float32 volume`. Types: 0 object touch (info = object index), 1 ground bump (volume 0..0.99), 4 apple taken,
5 turn, 6 right volt, 7 left volt (types 0, 1, 4, 6, 7 READ at their `0x42e500` call sites; 5 XCHK only).
End marker `0x00492F75` (READ 0x42dd68).

The replay stores poses only; playback never re-simulates. The visible state the original considers sufficient is:
frame position and rotation, the two wheel offsets and rotations, the rider point offset, the facing flag and gas.

## 11. Camera and unit scale

- Pixels per world unit: `0.48 * 100 = 48` at the default setting, `0.3 * 100 = 30` when option flag
  `[settings + 0x108bc]` is set (READ 0x40196a-0x401988, global 0x4537d0). XCHK recplay ("1 Elma unit is 48 px").
- Reference screen 640x480, i.e. 13.3 x 10 units at 48 px/unit.
- View size factor in [0.7, 1.0], changed in steps of x1.1 (READ 0x41b540-0x41b5be).
- Camera (READ 0x41bc68): `viewLeft = frame.x - (m + (viewWidth - 2m) * s)`, `viewBottom = frame.y - viewHeight/2`,
  with `m = 0.15 * 640/ppu` (2 units at 48 px/unit) and `s` a smoothed 0..1 facing value. So the bike is vertically
  centred and sits 15% of the screen width from the edge behind it, sliding across on a turn. No look-ahead by speed.
- Sizes for proportions: wheel diameter 0.8 (38.4 px), head diameter 0.476 (22.8 px), object diameter 0.8 (drawn 40 px
  in recplay), wheelbase 1.7, axle line 0.6 below the frame centre, rider point 0.44 above it, head centre 1.07 above
  it. Apples bob by `sin(15.5*t + phase) * 5 px` (READ 0x41be27).

Seconds conversion for a remake that works in SI-like time (multiply times by 2.28937729, divide rates by it):
gravity 10 -> 1.908 units/s^2; max wheel speed 110 -> 48.05 rad/s; volt step 12 -> 5.24 rad/s; max step 12.59 ms.

## 12. Cross-check sources

- elma-rust (elmadev): https://github.com/elmadev/elma-rust - `src/lev.rs`, `src/rec.rs`, `src/constants.rs`
  (https://docs.rs/crate/elma/latest/source/src/constants.rs). Used for level/replay layouts, marker values, event
  type names, `HEAD_RADIUS = 0.238`, `OBJECT_RADIUS = 0.4`, top-ten size.
- recplay (Maxdamantus): https://github.com/Maxdamantus/recplay - `src/player.ts`, `src/recRender.ts`,
  `src/objRender.ts`. Used for 48 px per unit and sprite proportions.
- No public write-up of the physics step was found; the original source is not public
  (https://elastomania.com/contributor.html). Everything in sections 2 to 7 is from the binary.

## 13. Confidence and open questions

| area | confidence | notes |
|---|---|---|
| time base, step loop, finish time | high | read directly; only the per-frame call pattern around the loop was skimmed |
| body constants, rest offsets | high | all stored immediates |
| suspension, frame/wheel integration | high | traced symbolically, formulas verified on the gravity-down path |
| gas, brake, turn | high | |
| volt and alovolt | high for the code path, medium for the alovolt interpretation | the worked example is derived, not observed |
| rider point and clamp | high for formulas; medium for which side of the sloped line is kept | sign read as "project when `dot(p - A, n) < 0`" |
| wheel contact logic | high for single contact; medium-high for the two-contact branch ordering | branch structure reconstructed from jumps; argument order of both test pairs verified |
| head and object rules | high | |
| level format | high (read and cross-checked) | Across-only polygon fields (versions < 8 or >= 12 extras at 0x419fe2-0x41a09b) not decoded |
| replay format | medium-high | layout cross-checked, scales read; last two per-frame bytes not analysed |
| camera | medium | origin formula read; smoothing of the facing value (0x420000) not decoded |

Open questions and things not determined:

1. Grid iteration order inside a cell (list order follows polygon order as loaded, INF). It decides which two contact
   points win when more than two are in range.
2. The three non-down gravity cases were not traced line by line (assumed identical apart from the vector).
3. `0x4229b0` / `0x422a80` (called from `suspension` and after the step) only feed a global used for sound (INF).
4. The option flag behind the 30 px/unit scale and the volt key swap flag `0x48564c` were not identified by name.
5. Multiplayer specifics (second bike at 0x449254, shared apple count, `0x45e398` toggles) were only noted in passing.
6. `state.dat` layout, picture clipping/distance semantics and LGR contents were not analysed (no `elma.res` available).
7. Whether the frame-time-dependent slicing has a measurable effect on outcomes was not quantified; the remake should
   pick a fixed step and treat exact time parity with the original as out of scope.
