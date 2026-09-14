# LAN portal smoke fixture review

CI run 34816260886, WebKit, failed at `scripts/browser-smoke.ts:243` waiting for `PORTAL · PHASE`. The test uses manual simulation ticks, so the effect could not expire while the assertion waited. The old fixture moved a rider to a randomly placed gate after weapon tests without controlling linked-exit obstacles or checking authoritative transit first. Game RNG derives from a fresh server match ID. Valid portal transits deliberately reject unsafe linked exits.

The CI log contains no simulation dump, so the exact obstruction in that historical run cannot be established. The retained failure is a 30-second timeout at the PHASE text assertion, with no intermediate authoritative assertion reached.

Root independently approved isolating the transit fixture before implementation. The updated smoke still collects the real portal pickup and asserts that it created a pair. It then supplies two safe interior gate positions, separates other riders, clears prior weapon/trail hazards and cooldown, advances exactly two ticks, and asserts authoritative cooldown, phase grace and linked-gate arrival before asserting the real phone's PHASE text. No gameplay timing or portal logic changed; the UI assertion remains required.

Validation: `npm run typecheck`, `BROWSER=webkit npm run test:browser`, and `npm run test:browser` all completed successfully on the revised fixture. Both browser runs used the smoke's own ephemeral localhost server and closed it afterward.
