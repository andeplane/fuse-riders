# ADR 026: Return to main menu during a match

Status: Accepted; reviewed by root before implementation.

Add authenticated host action `lobby`, available in every phase. A persistent TV Main Menu button is enabled outside the lobby and immediately returns there, without a confirmation dialog. The transition aborts unfinished round results rather than awarding points. It creates a fresh match scope, clears hazards, all current match statistics and powerups, queued inputs, timers and progress, and keeps connected player identities/tokens and the session leaderboard. Disconnected seats are pruned; waiting players become normal lobby participants. Starting again uses the fresh scope and normal player-count validation.

Use a pure engine returnToLobby(state,newMatchId) transition and the existing server host authorization gate. Tests cover playing/countdown/matchOver resets, no fabricated scores, identity/session retention, disconnected cleanup, stale charge cancellation and host-only transport. Browser smoke presses Main Menu and starts again with the same connected phones.
