# Graveyard Shift proof of concept

One 90-second cemetery shift for 2–5 hunters. Bank captured wisps (1 energy) and wraiths (4) at either shrine; equal banked scores share placement. Tanks hold five ghosts. Unbanked ghosts can be released by a directional air pulse.

The game implements the shared RollbackGame contract and RoomRuntime. The room service only signals peers. Fixed integer simulation steps own motion, resistance, contests, cooldowns, spawning and deposits; Canvas consumes a view. Held controls are fenced by match, round and member generation. Checkpoints validate the complete state before installation.

Contests accumulate suction contribution while resistance drains, then allow a short tug window. Highest contribution captures; a deterministic rotating priority resolves exact ties at the deadline. Total ghosts across the arena and tanks is bounded. Deposits remove ghosts, allowing replenishment. Bots emit the same movement/vacuum/pulse controls as humans.

This POC uses one arena and no elimination, health, gameplay relay or production deployment.
