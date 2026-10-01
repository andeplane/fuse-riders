# Complete skirmish presentation

The acceptance target is the user's detailed RTS reference: a grounded battlefield with readable, distinct buildings, animated connected tissue and combat, and a dense contextual command console. Previous isolated texture/sprite corrections did not meet that target. Tests establish behavior, not visual acceptance.

Implementation scope:

- Distinct illustrated Pulse, Siege and Relay buildings, consistently used in world, ghosts, portraits and commands. Grounding shadows, organic network territory and supply/combat effects must integrate them into the scene.
- A proper tactical command console: navigable minimap, framed selection information, readable resources and time, and QWE/ASD commands. Preserve phone landscape/portrait usability and gesture control.
- Complete the existing PvAI loop: default to skirmish, explain build/connect/charge, show queued waiting requirements, accurate enemy inspection, clear research/profile effects, direct rematch with restored starting camera.
- Presentation audio for actions/combat/results with injected lifecycle, mute/volume settings and `?mute` support. No simulation timing depends on audio or animation.
- The map is authoritative for visual obstruction: flat traversable ground under every open tile; raised obstacle and resource art only on matching non-open cells, clipped to their footprint. Category-restricted variants cannot disguise an open tile as a rock. Minimap terrain, construction restrictions and visible objects agree with the same cell data.

The engine and roster remain authoritative. No speculative units, network lobby, deployment or balance rewrite is part of this presentation completion. Art is bundled locally. New visuals consume world state; no alternate simulation is introduced. A minimap maps pointer positions to the existing camera rather than modifying game state.

Acceptance requires real menu-to-game browser captures at desktop, phone portrait and short landscape; actual construction, supply, research, combat and finish flows; asset consistency across views; reduced-motion/mute controls; focused tests and repository checks; and visual comparison against the reference. Keep the goal active while these items lack evidence or the rendered result remains below the target.
