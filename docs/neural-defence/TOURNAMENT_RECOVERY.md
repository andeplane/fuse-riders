# Interrupted strategy tournaments

Resume a stopped run using its original options and output directory:

```sh
pnpm exec tsx scripts/fuse-craft-tournament.ts --maps close-quarters --seconds 900 --out /tmp/fuse-durable-final-close-quarters --resume
```

Confirm the old process has stopped before resuming. Completed rows are retained;
only missing matches run again. A match interrupted before its result was saved
is replayed from the start. Result files and resumed manifests use temporary
files followed by atomic rename. A new run refuses to overwrite an existing
manifest or result file.

Resume requires matching maps, strategy order, time limit, simulation source and
harness version. Engine and map files are compared against the original source
revision, including working-tree edits. Presentation and documentation changes
do not invalidate the simulation. New manifests record simulation dirtiness
separately; legacy manifests must have been fully clean. The original manifest
is retained with an appended resumption record; each new result records its
actual source revision. Duplicate, unexpected and foreign-source rows fail
before the files are rewritten.

The harness version covers match setup, command generation, simulation stepping
and result measurement. Bump it when those behaviors change. Legacy manifests
without a version used the same version-1 simulation loop. Resume is a single
writer operation; do not launch multiple processes against the same directory.

Regression coverage runs a real short tournament, removes a completed seat,
resumes it and compares the exact results. It also checks completed-run resume,
overwrite refusal, configuration/harness mismatch, dirty simulation and duplicate
rows. This recovery mechanism preserves evidence; it makes no balance claim.
