# Scenery that moves: the drifting cross and the trains

Two maps put moving solids on the board. This note records the shape of the change and why it is shaped that way.

## Intended behaviour

- **Drifting cross** (`drift`): the wrapping board of `wrap` with a cross of two walls on it. The walls start on the board's edges — the round opens looking like the classic room — and slide across the board at a fixed velocity each, turned back by the edge they reach, so the cross wanders the way a screensaver logo does. Because the board is a torus, the cross always divides it into exactly one rectangular room, and that room drifts: riders have to keep moving with it, through the open edges when the room crosses them. Overtime closes the edges exactly as it does on `wrap`; the cross keeps drifting.
- **Trains** (`trains`): the classic walled board with two loops of track that never meet and three trains on them, two the same way round the outer loop and one the other way round the inner one. The track is paint; the cars are solid squares that kill on contact and stop shells and bullets. A train that rolls onto a rider kills it.
- Wandering walls and trains are **permanent**: a blast does not clear them and the overtime walls do not crush them. A map is its movers; a railway with nothing on it is the classic arena. In overtime the trains keep running through the closing band and across what is left of the field, so a level crossing inside the walls is as deadly as ever.

## Design

A mover is an ordinary `Obstacle` with a `motion` (`games/fuse-riders/src/engine/scenery-motion.ts`). Reusing the obstacle machinery means every existing interaction — rider death and the shield bounce, shell reflection, bullets stopping, pickups and gates keeping clear, bots planning around — works unchanged; the change is a step per tick and a few rules about what a mover is exempt from.

- **State, not derivation.** A mover's position and its `motion` (velocity, or distance round the loop) are state. A checkpoint restores a train where it was and every replica advances it with the same arithmetic (`+`, `-`, `*`, `/`, `Math.sqrt`; no time-based recomputation, no trigonometry). The tracks are map data, keyed by map id, and reach a screen as `view.tracks`.
- **One phase.** `moveScenery` runs after `fitField` and before anything rides, so the whole tick is judged against where scenery stands at the end of the tick. Per-tick displacement (at most 4 units) is small against a car's 32, so nothing tunnels; a rider crossing just behind a car is spared, which is the generous side.
- **Let-out rule.** A rider is let out of scenery it already stood in (immunity can lapse inside a rock). For a mover that is judged where the piece stood _before_ its step (`ctx.sceneryBefore`), so a car that has just rolled onto a rider is not something the rider was inside of, and the rider dies.
- **Open edges.** Scenery is now met across an open edge as trails are: the rider's step and a gun ray's leg are tested against each image of a piece that the wrap brings within reach (`movementImages`, `legImages`), and the bot planner lists the images within its reach. Shells already reflected off the image-shifted `solid` list. On a walled board the image list is the single identity offset, so those paths are bit-identical to before.
- **Checkpoint guard.** `motion` is admitted in its two shapes only, and only on `wall` and `train`; a `wall` stands only on `drift` and may span the board (half extents to half the board), other kinds stay bounded to a quarter; a `train` stands only on `trains`, on a loop the map has, within its length; a bouncing wall's step fits the room it bounces in, and `reflect` clamps as well, so no admitted state can put a mover off the board.
- **Rendering.** Standing scenery stays baked into the floor pass; movers are painted every frame from the interpolated view. The rails are baked. A car's lights face along the track; the lowest id of a train is its locomotive (cars are laid head first).

## Tradeoffs

- Trains do not bend rider planning: bots see a car where it is now, not where it will be. They outrun trains and re-plan every tick, which is enough to avoid most, not all, of them; that is deliberate — bots get no privileged physics.
- The cross's initial place and velocity are fixed rather than seeded, so every round of `drift` opens the same way. A seeded start would be a one-line change in `fixedScenery` and a rules bump.
- Neither map is in `rotate`. The rotation is what a default room plays, and both maps change what a round asks of a rider; a room opts in, as it does for `wrap` and `cross`.
