# One-way player platforms

Player motion sweeps downward against platform tops only; rising and horizontal motion can cross the illustrated ledges. Hooks retain the full solid platform rectangle for attachment and obstruction. Dummy motion and the ball field are unchanged.

A fresh S/Down-arrow press (or a downward left-thumb gesture) while supported drops through the current ledge. It moves the feet just below that top, gives a small downward velocity, clears jump grace/buffering and releases the hook. Other ledges still catch the player. Holding down does not skip subsequent ledges; release and press again. Airborne down input is not buffered. Down takes precedence over a simultaneous jump. Competitive reset remains disabled, but dropping remains ordinary movement with normal fall penalties.

No ignore timer or separate physics state is needed: once the feet are below a top, the next downward sweep cannot collide with it. Checkpoints allow bodies intersecting platform artwork during traversal and validate supported grounded states. Drop is part of validated logged input, including press/release pulses within one network tick. Rules advance to `hook-havok-5`.

Verification: `platforms.test.ts` covers rising through/landing, high-speed descent, side passage, solid hook surfaces, attached-hook release, one-drop-per-press, crossing checkpoint replay and touch cancellation. Movement tests cover a batched drop tap. The traversal fixture retains its complete ledge/recovery route with updated hook-release timings. Real WebRTC browser checks verify jump-through and drop-through positions agree on a second player; native CDP touch checks include dropping through the starting ledge. Physical-phone feel remains for user playtesting.
