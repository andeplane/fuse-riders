# Spiked wire everywhere (11A)

Rules are now **`hook-havok-11`**. Refresh every client and create a fresh room.

## 11A. Spiked wire everywhere

### Why

Playtesting after 10D found that the spikes lied. The wire only existed while the hook flew or held with fire down, so a retracting hook drew a plain rope that popped nothing. The lethal segment also stopped at the first ledge, although since 10A the rope passes through ledges, and it vanished while the hand was inside a platform.

### Rules

- **The wire is the rope.** With **Tether → Spiked wire**, the lethal segment runs from the keeper's chest to the hook in every phase the rope is drawn: flying, attached and retracting. Ledges neither clip nor disable it, and a hand inside stone does not either. Only a rope shorter than one unit, which draws nothing, is inactive. `activeWire` in `engine/wire-contact.ts` owns this; `paintSpikes` draws exactly that segment.
- **Balls only.** The wire still pops only balls. Rival knockback and the brass target keep tip-only contact.
- **A pop ends the shot.** Because a retracting rope is now lethal, a pop by the wire or by the tip ends a spiked shot at once (the hook is ready again) instead of retracting. Otherwise the children, which spawn on or beside the rope, would pop on the next tick and one shot could clear a family. One shot still pops one ball. Tip mode keeps its harmless six-tick retract.
- **Spiked is the default** for new rooms. `CLASSIC_TUNING` keeps the tip so older fixtures stay pinned.

### Verification

`tests/control-trials.test.ts` covers the retracting wire (direct and through an ordinary release step), a rope through the lower-middle ledge, a chest inside that ledge, the degenerate short rope, respawn and tip mode, a pop ending the shot with children surviving, a tip pop in both modes, stable priority between two wires, and the new default.
