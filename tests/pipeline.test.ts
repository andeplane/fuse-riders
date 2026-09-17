import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { PHASES } from "../src/engine/sim/pipeline.ts";
import { sourceFiles, syntax } from "./fixtures/source-guards.js";

const SIM = "src/engine/sim";

/**
 * The tick contract, written out a second time on purpose: the order of PHASES is part of the rules, so moving,
 * adding or removing a phase has to be said twice — here and in `pipeline.ts` — and needs a `RULES` bump unless the
 * golden recording proves it changes nothing.
 */
test("PHASES is the tick order the design note describes", () => {
  assert.deepEqual(
    PHASES.map((phase) => `${phase.when === "always" ? "*" : ""}${phase.name}`),
    [
      "*advanceClock",
      "*expire",
      "*startPlay",
      "ageTrails",
      "fitField",
      "spawnPickups",
      "moveRiders",
      "collectPickups",
      "bounceImmuneRiders",
      "moveShells",
      "explodeFuses",
      "hitProjectiles",
      "burnTrails",
      "detectHazards",
      "detectRiderContacts",
      "settleSceneryContacts",
      "resolveDefences",
      "portalTransit",
      "stopAtContact",
      "commitMovement",
      "commitSweepDeaths",
      "launchWeapons",
      "fireGuns",
      "explodeInstant",
      "resolveInstantHits",
      "commitInstantDeaths",
      "observeDodges",
      "recordFacts",
      "resolveRound",
    ],
  );
  assert.equal(new Set(PHASES.map((phase) => phase.name)).size, PHASES.length);
  const firstPlaying = PHASES.findIndex((phase) => phase.when === "playing");
  assert.ok(
    PHASES.slice(firstPlaying).every((phase) => phase.when === "playing"),
    "the early-out ends the tick at the first playing phase, so no always-phase may follow one",
  );
});

/** Names a file imports as values (not types) from a module whose path ends with one of `modules`. */
function valueImports(file: string, modules: readonly string[]): string[] {
  const names: string[] = [];
  for (const statement of syntax(file).statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !modules.some((name) =>
        (statement.moduleSpecifier as ts.StringLiteralLike).text.endsWith(
          `/${name}.js`,
        ),
      )
    )
      continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.push(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        if (!element.isTypeOnly)
          names.push((element.propertyName ?? element.name).text);
  }
  return names;
}

test("recordFacts is the only phase that writes statistics, the shot log or moments", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SIM)) {
    // The round's resolution scores the match and freezes the decided round's log: outcome, not physics.
    if (
      file === `${SIM}/phases/record-facts.ts` ||
      file === `${SIM}/phases/resolve-round.ts`
    )
      continue;
    for (const name of valueImports(file, ["match-stats", "shot-log"]))
      offenders.push(`${file}: ${name}`);
    for (const name of valueImports(file, ["moments"]))
      if (/^(detect|push|record)/.test(name) || name === "*")
        offenders.push(`${file}: ${name}`);
  }
  assert.deepEqual(offenders, []);
  assert.ok(
    valueImports(`${SIM}/phases/record-facts.ts`, ["match-stats"]).length > 0,
    "the guard reads the imports it claims to",
  );
});

test("no phase or sim helper imports game.ts: the engine's runtime imports stay a DAG", () => {
  const offenders = sourceFiles(SIM).filter((file) =>
    syntax(file).statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        /\/game\.(js|ts)$/.test(statement.moduleSpecifier.text),
    ),
  );
  assert.deepEqual(offenders, []);
});
