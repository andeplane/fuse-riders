import test from "node:test";
import assert from "node:assert/strict";
import { assess, type WorkflowRun } from "../scripts/main-health.js";

const run = (conclusion: string | null, sha = "a".repeat(40)): WorkflowRun => ({
  conclusion,
  head_sha: sha,
  html_url: `https://github.com/o/r/actions/runs/${conclusion}`,
});
const green = {
  "Deploy backend": [run("success")],
  "Deploy Pages": [run("success")],
};

test("main is green when its latest CI run and both deployments succeeded", () => {
  assert.deepEqual(assess([run("success"), run("failure")], green), {
    red: false,
    deployRed: false,
    reasons: [],
  });
});

test("a failed CI run on main makes main red, but not its deployments", () => {
  const health = assess([run("failure", "b".repeat(40)), run("success")], {
    // CI was red, so the deployments were skipped: they say nothing.
    "Deploy backend": [run("skipped"), run("success")],
    "Deploy Pages": [run("skipped"), run("success")],
  });
  assert.equal(health.red, true);
  assert.equal(health.deployRed, false);
  assert.equal(health.reasons.length, 1);
  assert.match(health.reasons[0]!, /^CI failure on bbbbbbbb /);
});

test("a timed-out or broken CI run is red too; a cancelled one says nothing", () => {
  for (const conclusion of ["timed_out", "startup_failure", "action_required"])
    assert.equal(assess([run(conclusion)], green).red, true, conclusion);
  assert.equal(assess([run("cancelled"), run("success")], green).red, false);
  assert.equal(assess([run("cancelled"), run("failure")], green).red, true);
});

test("a failed deployment makes main red and asks for the cd-fix label", () => {
  const health = assess([run("success")], {
    "Deploy backend": [run("skipped"), run("failure"), run("success")],
    "Deploy Pages": [run("cancelled"), run("success")],
  });
  assert.equal(health.red, true);
  assert.equal(health.deployRed, true);
  assert.deepEqual(
    health.reasons.map((reason) => reason.split(" on ")[0]),
    ["Deploy backend failure"],
  );
});

test("no finished runs is not red: a new repository or a fresh workflow blocks nothing", () => {
  assert.deepEqual(assess([], { "Deploy backend": [], "Deploy Pages": [] }), {
    red: false,
    deployRed: false,
    reasons: [],
  });
});
