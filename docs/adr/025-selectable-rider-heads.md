# ADR-025: Selectable rider heads

- Status: Accepted
- Date: 2026-09-13

## Decision

Add ten local neon-pixel head choices to the controller join form. Generate one cohesive ten-cell raster atlas with imagegen, store the final asset in public/avatars, and address cells through a shared typed avatar allowlist. Each cell contains one distinct character (robot, cat, fox, alien, astronaut, skull, octopus, dragon, owl, and slime), without text. The atlas is presentation only and has no network fetch outside the LAN.

An optional validated avatar id accompanies join; omitted ids use the default robot for backward compatibility. The server owns the chosen id on player identity and publishes it in snapshots. Reconnecting with an existing token preserves the server's identity. Players choose before a fresh join; local storage remembers the last selection. Invalid ids and unknown join fields remain rejected. No mid-round identity changes are added.

The TV draws the selected head at the existing rider center, rotated with heading, retaining the slot-colored outline and direction cue. Controller previews use the same atlas cell. Missing/loading art keeps the existing themed rider fallback. Themes retain their existing arena and effects; heads work across both and never change movement, collisions, player slots, scoring, or stats.

## Validation

Test the exact ten-id allowlist, invalid/omitted join ids, new-seat assignment and token reconnect preservation across the serialized server boundary. Verify picker persistence, selected snapshot identity, both-theme rendering and phone layout in isolated browser tests. Preserve generated art provenance and inspect the atlas before deciding source-cell rectangles.

## Review resolution

Root accepted before implementation, requiring inspection of the generated atlas and a clear player-color border and heading cue around the selected portrait.
