# Parallel coverage collection

The coverage job on PR #530 took 16m29s: instrumented unit tests took 6m53s, followed by about 8m16s of browser flows. Several flows intentionally wait for real rounds to finish. Raising the timeout would leave that serial bottleneck intact.

CI runs unit coverage and browser coverage on separate runners, then downloads both raw datasets into one report job. The existing `coverage` gate requires both collectors to succeed before checking the unchanged combined thresholds. Missing artifacts and failed collectors fail the gate; passing percentages cannot hide a failed flow. Separate runners avoid increasing CPU contention in instrumented browser simulations.

`pnpm test:coverage` still runs the complete suite locally. CI selects `COVERAGE_PHASE=unit`, `browser`, or `report`. Each phase logs elapsed time. All coverage jobs retain a 20-minute ceiling. The expected critical path is the slower collector plus setup, artifact transfer and reporting, rather than the sum of both collectors. This adds runner setup and raw-artifact transfer; measure CI before claiming the expected reduction.

No tests, replay checks, browser assertions or coverage thresholds are removed by this scheduling change. PR #530's existing browser quarantines remain separately tracked in issue #250.
