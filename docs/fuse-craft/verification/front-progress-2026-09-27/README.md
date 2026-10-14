# Rules-9 front progress diagnosis

Engine source `290c4086`, unchanged through `1eef4ec4`. Balanced/Economy on
Skirmish24, Alpha slot0, was rerun once because the wider tournament's sample
mode omitted this replay. Both the rerun and complete command replay reproduce
the tournament hash `f9893173` at tick18000 (900 seconds).

The final state is not a demonstrated static deadlock. In the final60 seconds,
Alpha completes five builds and deals140 damage; Beta completes four and deals 210. There are no site losses or construction cancellations in that minute.
Both brains remain at240HP, with the closest connected opposing structures
14/12 traversable steps away.

Alpha has nine connected Siege weapons and one Bastion. Only Siege246 has firing
targets: disconnected enemy neurons296/319. It holds24 ammunition. Beta has ten
connected Siege weapons and two Towers, none with a target. Alpha prioritizes
Bastion105 and Siege246; Beta prioritizes179/180/203/226 and has80 particles in
transit. These facts establish lack of reachable live targets at this snapshot,
not global ammunition starvation.

Both workers are actively constructing artillery (Alpha270, Beta133). The
snapshot and ordinary-command replay are retained for continued measurement.
Do not infer infinite stalemate from a900-second cutoff: longer continuation is
being measured separately, without changing the production rules or the
original tournament cap.

## Continuation to 1,800 seconds

The unchanged AI continued from the validated snapshot to tick36000. Command-only
replay verifies final hash `7f248230`; the match is still unfinished and both
brains retain240HP. Alpha advances to distance4 by1260 seconds and usually stays
there; Beta repeatedly loses and reconnects its forward branches. Exact
60-second measurements are in `continuation-samples.json`.

At the end, Alpha can legally queue Siege426 through connected425/402, reaching
the enemy brain. Three enemy Siege weapons (453/405/476) cover that site. The
other brain-reaching Siege cell403 is an illegal deposit; no Tower site reaches
the brain. Alpha instead pursues peripheral Tower283. Its global nearest-enemy
distance is2 due to structures282/258 near enemy235/211, causing the global
close-support override to exclude Siege before comparing candidate sites.

This proves a spatially global weapon choice and a threatened finishing position,
not that switching the weapon alone would win. Both support-selection trials
already regressed other cases. The original900-second matrix remains unchanged;
these separate longer measurements do not erase its timeouts.
