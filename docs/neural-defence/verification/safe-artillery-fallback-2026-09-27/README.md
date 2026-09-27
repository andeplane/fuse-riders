# Isolated safe artillery fallback

This candidate is **not integrated**. Its base is `0f7d326f`, whose engine matches
`99c820e1`. The source patch, manifest and results accompany this note.

At 900 seconds on Narrow Front, Pressure/Relay has six Towers versus six Relays,
no live targets and no damage or losses in the last minute. Both sides reject all
seven threatened short-range firing sites, despite researched, legal, safe Siege
positions and plentiful resources. They build rear neurons instead.

The candidate considers safe, researched artillery only after the selected
short-range weapon fails to produce an admissible firing site. It does not add a
global distance restriction or alter construction costs or combat.

Twenty-five probes have zero rejected commands. All 21 default-map outcomes are
unchanged, with no new timeouts; Balanced/Defensive changes from 171 to 160 seconds
and Economy/Relay from 281 to 282 seconds. Both Narrow Front Pressure/Relay seats
finish with Relay winning at 599 seconds. Balanced/Defensive also finishes, with
Balanced winning at 737 and 616 seconds. That starting-side duration difference
needs investigation; the other maps remain unqualified. Do not treat this small
sample as proof of overall balance or promote without wider comparison.
