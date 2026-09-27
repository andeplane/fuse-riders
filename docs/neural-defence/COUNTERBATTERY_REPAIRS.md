# Clearing guns before repairing a supply line

The rules-7 Close Quarters Pressure mirror repeatedly rebuilt its supply gap,
reactivated both armies, and lost the gap again. At 900 seconds each player had
only 2.5 Biomass left, 31 completed buildings and 23 losses. Increasing repair
durability had not removed this resource sink.

The AI now considers a Siege position outside the dormant guns' range before
repairing a gap they cover. It must have Ballistics, a legal connected site and
normal construction resources. If no suitable artillery site exists, normal
repair planning remains available. This adds no privileged damage or supplies.

One of the four supply destinations is reserved for an existing Siege gun
covering a dormant weapon that threatens a supply gap. Without that reservation,
four forward guns could starve the counterbattery gun indefinitely. The existing
Bastion reserve remains available. Selections use home-relative ordering.

Engine rules remain 7; the public AI policy identifier advances to
`neural-defence-7-skirmish-3`. Regression coverage checks ordinary queue acceptance,
avoids duplicate artillery for an already covered threat, and checks ammunition
priority with four competing frontline guns. Independent review identified the
supply starvation case; the regression and reservation address it.

An initial normal-rules Pressure mirror on Close Quarters finished with both
brains destroyed at 220 seconds, versus the previous 900-second timeout. That
trial preceded the competing-guns supply correction. Broader final-source
comparisons remain required; this observation is not a general balance claim.
