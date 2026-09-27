# Player-controlled victory through the browser

Game source: `9567b319`, rules 9 / AI policy 5. Chromium desktop, 1920×1080,
Close Quarters, Spawn 1, Pressure opponent. The normal menu and player controls
produce Victory at **2:46**, followed by a successful Play again action: the
result hides and both starting brains return. No page errors occurred.

The fixed Relay-focused plan expands to resource-adjacent cells, researches
Growth, Conduction, Resonance and Excitation, changes to Swift particles, builds
Pulse and Relay weapons and moves supply priority toward the advancing front.
It is a fixed plan, not an AI reading the browser world. Every action uses the
ordinary visible UI; no world injection, privileged command dispatch, bonus
resources or accelerated clocks are used. The idle browser's reload socket is
disabled so unrelated development edits cannot reset the local match.

`player-plan.json` retains the headless reference (143 seconds, hash `54487e3f`),
including planned actions/times. `result.json` records their actual browser game
times, confirms displayed supply priority after each change, and retains the
visible Victory text. Selection and construction waits made the browser run take 166 seconds;
it is not presented as an exact replay of the headless reference.

- [Developed player battle](battle.png)
- [Actual Victory result](victory.png)

Reproduce while the preview is running on port 5174:

```sh
pnpm exec tsx scripts/fuse-craft-player-victory-smoke.ts /tmp/fuse-player-victory
```

This connects research, paid construction, supply and enemy destruction in one
real Player-vs-AI flow. It does not establish phone victory, human usability or
all-strategy balance. Existing sandbox tests separately exercise specialization
and cancellation; they are not claimed as part of this run.
