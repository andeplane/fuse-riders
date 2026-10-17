import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  jobSteps,
  loadManifest,
  parseManifest,
  select,
  smokeEnv,
  stepNames,
  smokeJobs,
  verifyJobs,
  type CiManifest,
} from "../scripts/lib/ci-manifest.js";
import { browserKind } from "../scripts/lib/browser.js";
import { roomServiceUrl } from "../scripts/lib/server.js";
import { devBanner } from "../service/dev.js";

// scripts/ci-manifest.json is the only list of CI steps. These tests fail when .github/workflows/ci.yml or
// scripts/ci-local.sh stops reading it, or when the hand-written copies (the gate jobs and `coverage`, which
// keep their step names in the GitHub UI) differ from it.
const manifest = loadManifest();
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const cd = readFileSync(".github/workflows/cd.yml", "utf8");
const local = readFileSync("scripts/ci-local.sh", "utf8");
/** When the release jobs (coverage and the browser matrix) run: CD, a dispatch, or a pull request with `full-ci`. */
const RELEASE =
  "github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'full-ci')";

/** The text of one job, without a YAML parser: jobs are the two-space keys after `jobs:`. */
function job(name: string): string {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);
  const blocks = jobs.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m);
  const block = blocks.find((item) => item.startsWith(`  ${name}:`));
  assert.ok(block, `ci.yml has no ${name} job`);
  return block;
}
/**
 * Every command a job runs, whether the step is `- run: x` or a named step with `run: x` on its own line.
 * A `run: |` block yields "|", which equals no manifest command, so a multi-line step fails the comparison.
 */
const runsIn = (jobText: string) =>
  [...jobText.matchAll(/^ {6}(?:- | {2})run: (.+)$/gm)].map(
    (match) => match[1]!,
  );
const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
const scriptsIn = (text: string) => [
  ...new Set(withoutComments(text).match(/scripts\/[\w./-]+/g) ?? []),
];

test("each gate job runs exactly the manifest's steps for it", () => {
  for (const name of verifyJobs(manifest)) {
    const steps = jobSteps(manifest, name);
    // A job of several steps runs them side by side through the runner, which reads them from the manifest.
    assert.deepEqual(
      runsIn(job(name)),
      [
        "pnpm install --frozen-lockfile",
        ...(steps.length > 1
          ? [`pnpm exec tsx scripts/ci-run.ts --job ${name}`]
          : steps.map((step) => step.command)),
      ],
      `the ${name} job`,
    );
    // A gate job waits for nothing and is never skipped: every pull request runs all of them.
    assert.doesNotMatch(job(name), /^ {4}(needs|if):/m, `the ${name} job`);
  }
});

test("verify is the one check name, and it reports every gate job", () => {
  const verify = job("verify");
  assert.ok(
    verify.includes(
      `    needs: [${[...verifyJobs(manifest), "coverage", "e2e"].join(", ")}]\n`,
    ),
    "verify must need the gate jobs and, when the release jobs run, coverage and e2e",
  );
  // Without `always()` a failed gate job would leave verify skipped, which a branch rule reads as not-failed.
  assert.ok(verify.includes("    if: always()\n"));
  for (const name of verifyJobs(manifest))
    assert.match(
      verify,
      new RegExp(`needs\\.${name}\\.result`),
      `verify does not look at the ${name} job's result`,
    );
  assert.equal(
    runsIn(verify).length,
    1,
    "verify runs one check and nothing else",
  );
});

test("the unit shards cover the whole suite, and only a pull request thins the replay check", () => {
  const unit = job("unit");
  const list = / {8}shard: \[([\d, ]+)\]/.exec(unit)?.[1];
  const divisor = / {6}TEST_SHARD: \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(
    unit,
  )?.[1];
  assert.ok(list && divisor, "the unit job must shard the suite");
  // Drift between the two silently drops part of the suite: shard 4/3 runs nothing, and [1,2,3] of 4 skips a quarter.
  assert.deepEqual(
    list.split(",").map((item) => Number(item.trim())),
    Array.from({ length: Number(divisor) }, (_, index) => index + 1),
    "the shard list and the TEST_SHARD divisor must agree",
  );
  // A sampled replay budget is the pull request's alone; anything else (a push, a dispatch) checks every tick.
  assert.match(
    unit,
    /FUSE_REPLAY_STRIDE: \$\{\{ github\.event_name == 'pull_request' && '\d+' \|\| '1' \}\}/,
    "the replay stride must fall back to 1",
  );
});

test("coverage collectors run independently and preserve the release commands and timeout", () => {
  assert.deepEqual(runsIn(job("coverage-unit")), [
    "pnpm install --frozen-lockfile",
    "pnpm test:coverage",
  ]);
  assert.deepEqual(runsIn(job("coverage-browser")), [
    "pnpm install --frozen-lockfile",
    ...manifest.release.map((step) => step.command),
  ]);
  for (const phase of ["unit", "browser"]) {
    const collector = job(`coverage-${phase}`);
    // After the gate: CD spends no runners on the release jobs for a commit whose gate failed.
    assert.ok(collector.includes("    needs: [checks, unit]\n"));
    assert.ok(collector.includes(`    if: ${RELEASE}\n`));
    assert.ok(collector.includes(`      COVERAGE_PHASE: ${phase}\n`));
    assert.ok(collector.includes("    timeout-minutes: 20\n"));
    assert.ok(
      collector.includes(
        `          name: coverage-${phase}-raw-\${{ matrix.shard }}\n`,
      ),
    );
    assert.ok(collector.includes("          if-no-files-found: error\n"));
    // Drift between the list and the divisor would silently leave part of the files or flows out.
    const list = / {8}shard: \[([\d, ]+)\]/.exec(collector)?.[1];
    const divisor = / {6}TEST_SHARD: \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(
      collector,
    )?.[1];
    assert.ok(list && divisor, `coverage-${phase} must shard`);
    assert.deepEqual(
      list.split(",").map((item) => Number(item.trim())),
      Array.from({ length: Number(divisor) }, (_, index) => index + 1),
    );
  }
});

test("coverage cannot pass with a failed or missing collector, and reports both raw datasets", () => {
  const gate = job("coverage");
  assert.ok(gate.includes("    needs: [coverage-unit, coverage-browser]\n"));
  assert.ok(gate.includes(`    if: always() && (${RELEASE})\n`));
  assert.ok(gate.includes("      COVERAGE_PHASE: report\n"));
  assert.ok(gate.includes("    timeout-minutes: 20\n"));
  assert.ok(gate.includes("UNIT: ${{ needs.coverage-unit.result }}"));
  assert.ok(gate.includes("BROWSER: ${{ needs.coverage-browser.result }}"));
  assert.equal(
    (gate.match(/uses: actions\/download-artifact@v4/g) ?? []).length,
    2,
  );
  // Every share of each collector lands in the one directory the report and its thresholds read.
  for (const phase of ["unit", "browser"])
    assert.ok(
      gate.includes(
        `          pattern: coverage-${phase}-raw-*\n          path: coverage/tmp/\n          merge-multiple: true\n`,
      ),
    );
  const commands = runsIn(gate);
  assert.deepEqual(commands.slice(1), [
    "pnpm install --frozen-lockfile",
    "pnpm test:coverage",
  ]);
  for (const unit of ["success", "failure", "cancelled", "skipped"])
    for (const browser of ["success", "failure", "cancelled", "skipped"]) {
      const result = spawnSync("bash", ["-c", commands[0]!], {
        env: { ...process.env, UNIT: unit, BROWSER: browser },
      });
      assert.equal(
        result.status === 0,
        unit === "success" && browser === "success",
      );
    }
});

/** What each of verify's `env:` values must be read from: the script below is only as right as its inputs. */
const VERIFY_ENV: Record<string, string> = {
  GATE: "${{ needs.checks.result }} ${{ needs.unit.result }}",
  RELEASE: `\${{ ${RELEASE} }}`,
  PROOF: "${{ needs.coverage.result }} ${{ needs.e2e.result }}",
};

/** verify's script, run by bash with the values its `env:` would carry; true when it passes. */
function verifyPasses(env: Record<string, string>): boolean {
  const script = /run: \|\n((?: {10}.*\n?)+)/.exec(job("verify"))?.[1];
  assert.ok(script, "verify has one multi-line run step");
  for (const name of Object.keys(env))
    assert.ok(
      job("verify").includes(`          ${name}: ${VERIFY_ENV[name]}\n`),
      `verify's ${name} must be ${VERIFY_ENV[name]}`,
    );
  return (
    spawnSync("bash", ["-e", "-c", script.replace(/^ {10}/gm, "")], {
      env: { PATH: process.env.PATH, ...env },
      stdio: "ignore",
    }).status === 0
  );
}

test("verify passes a pull request on the gate alone, and a release run only with coverage and every smoke", () => {
  const ok = {
    GATE: "success success",
    RELEASE: "false",
    PROOF: "skipped skipped",
  };
  assert.equal(verifyPasses(ok), true, "a pull request: the gate is enough");
  // One slot per job in GATE, in order: checks, unit. A failure in either must fail the gate.
  assert.equal(verifyPasses({ ...ok, GATE: "failure success" }), false);
  assert.equal(verifyPasses({ ...ok, GATE: "success failure" }), false);
  assert.equal(verifyPasses({ ...ok, GATE: "success skipped" }), false);
  assert.equal(verifyPasses({ ...ok, GATE: "cancelled success" }), false);
  // CD, a dispatch or `full-ci`: the release jobs ran, and verify holds them to passing.
  const release = { ...ok, RELEASE: "true" };
  assert.equal(
    verifyPasses(release),
    false,
    "skipped release jobs are not a pass",
  );
  assert.equal(verifyPasses({ ...release, PROOF: "success failure" }), false);
  assert.equal(verifyPasses({ ...release, PROOF: "failure success" }), false);
  assert.equal(verifyPasses({ ...release, PROOF: "success success" }), true);
  assert.equal(
    verifyPasses({
      ...release,
      GATE: "failure success",
      PROOF: "success success",
    }),
    false,
  );
});

test("CD runs this workflow for main pushes one at a time, and the deployment waits for CD", () => {
  // Called by CD: on a push the release jobs run, and the gate runs first.
  assert.match(workflow, /^on:\n(?:.*\n)*? {2}workflow_call:$/m);
  assert.doesNotMatch(
    workflow,
    /^ {2}push:/m,
    "a main push runs through CD, not here",
  );
  assert.match(cd, /^ {2}push:\n {4}branches: \[main\]$/m);
  // One running, at most one waiting: a newer push replaces the waiting run, never the running one.
  assert.match(
    cd,
    /^concurrency:\n {2}group: cd\n {2}cancel-in-progress: false$/m,
  );
  assert.ok(cd.includes("    uses: ./.github/workflows/ci.yml\n"));
  // A called workflow gets no more than its caller grants, and the smokes report flakes to an issue.
  assert.ok(cd.includes("      issues: write\n"));
  assert.ok(job("smoke").includes("      issues: write\n"));
  // The browser matrix leaves runners for pull requests.
  assert.match(job("smoke"), /^ {6}max-parallel: \d+$/m);
  const backend = readFileSync(".github/workflows/backend.yml", "utf8");
  assert.ok(backend.includes("  workflow_run:\n    workflows: [CD]\n"));
  assert.ok(
    backend.includes("actions/workflows/cd.yml/runs?branch=main&event=push"),
  );
  assert.ok(
    readFileSync("scripts/deploy-cloud.sh", "utf8").includes(
      "actions/workflows/cd.yml/runs?branch=main&event=push&head_sha=$revision",
    ),
  );
  assert.match(
    readFileSync(".github/workflows/pages.yml", "utf8"),
    /\['cd\.yml', 'ci\.yml'\]/,
  );
});

test("a named or multi-line step in a job is seen, not only `- run:` steps", () => {
  const text = [
    "  verify:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: npm ci",
    "      - name: Not in the manifest",
    "        run: npm run not-in-manifest",
    "      - name: A block",
    "        run: |",
    "          npm run hidden",
    "      - run: npm run build",
    "        env:",
    "          CI: true",
  ].join("\n");
  assert.deepEqual(runsIn(text), [
    "npm ci",
    "npm run not-in-manifest",
    "|",
    "npm run build",
  ]);
});

test("the browser matrix is built from the manifest, one job per smoke or batch", () => {
  const plan = job("plan");
  for (const line of [
    "      ids: ${{ steps.manifest.outputs.ids }}",
    "      byId: ${{ steps.manifest.outputs.byId }}",
  ])
    assert.ok(plan.split("\n").includes(line), `plan job lost: ${line}`);
  // What plan's jq writes is what scripts/ci-run.ts --smoke runs: one entry per smokeJobs() job.
  const jq = (name: string) => {
    const line = plan
      .split("\n")
      .find((item) => item.trim().startsWith(`printf '${name}=`));
    const filter = /jq -c '(.+)' scripts\/ci-manifest\.json/.exec(
      line ?? "",
    )?.[1];
    assert.ok(filter, `plan has no jq for ${name}`);
    const result = spawnSync("jq", ["-c", filter, "scripts/ci-manifest.json"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as unknown;
  };
  const jobs = smokeJobs(manifest);
  assert.deepEqual(jq("ids"), jobs.map((item) => item.id).sort());
  assert.deepEqual(
    jq("byId"),
    Object.fromEntries(
      jobs.map((item) => [
        item.id,
        {
          name: item.smokes.map((smoke) => smoke.name).join(" + "),
          browsers: [
            ...new Set(item.smokes.flatMap((smoke) => smoke.browsers)),
          ].sort(),
          timeoutMinutes: item.smokes.reduce(
            (sum, smoke) => sum + smoke.timeoutMinutes,
            0,
          ),
        },
      ]),
    ),
  );
  // A job's timeout covers every smoke in it twice (each may retry), within GitHub's six-hour cap.
  for (const item of jobs)
    assert.ok(
      item.smokes.reduce((sum, smoke) => sum + smoke.timeoutMinutes, 0) <= 360,
      item.id,
    );
  const smoke = job("smoke");
  const entry = "fromJson(needs.plan.outputs.byId)[matrix.id]";
  for (const line of [
    "    needs: [plan, checks]",
    "      fail-fast: false",
    "        id: ${{ fromJson(needs.plan.outputs.ids) }}",
    `    timeout-minutes: \${{ ${entry}.timeoutMinutes }}`,
    `      - run: pnpm exec playwright install --with-deps \${{ join(${entry}.browsers, ' ') }}`,
    `      - name: \${{ ${entry}.name }}`,
    '        run: pnpm exec tsx scripts/ci-run.ts --smoke "${{ matrix.id }}"',
    "          name: browser-evidence-${{ matrix.id }}",
    "      SMOKE_TIMEOUT_SCALE: 3",
  ])
    assert.ok(smoke.split("\n").includes(line), `smoke job lost: ${line}`);
  // No dynamic job name: a skipped matrix job would show the unexpanded expression as a check.
  assert.doesNotMatch(smoke, /^ {4}name:/m);
  // The only commands in these jobs are the ones asserted above.
  assert.deepEqual(runsIn(plan), ["|"]);
  // The smokes serve the dist/ that `checks` built and uploaded, rather than each building it again.
  assert.match(
    job("checks"),
    /- uses: actions\/upload-artifact@v4\n {8}with:\n {10}name: dist\n {10}path: dist\/\n {10}if-no-files-found: error\n/,
  );
  assert.match(
    smoke,
    /- uses: actions\/download-artifact@v4\n {8}with:\n {10}name: dist\n {10}path: dist\/\n/,
  );
  assert.ok(
    jobSteps(manifest, "checks").some((step) => step.command === "pnpm build"),
    "the job that uploads dist/ must be the one that builds it",
  );
  assert.deepEqual(runsIn(smoke), [
    "pnpm install --frozen-lockfile",
    "|",
    `pnpm exec playwright install --with-deps \${{ join(${entry}.browsers, ' ') }}`,
    'sudo chown -R "$(id -u):$(id -g)" "$HOME/apt-archives"',
    'pnpm exec tsx scripts/ci-run.ts --smoke "${{ matrix.id }}"',
  ]);
  // Evidence is uploaded whether the smoke passed or not.
  assert.match(
    smoke,
    /- name: Save browser evidence\n {8}if: always\(\)\n {8}uses: actions\/upload-artifact@v4/,
  );
});

test("no smoke is written out in the workflow or in the local mirror", () => {
  assert.deepEqual(scriptsIn(workflow), [
    "scripts/ci-run.ts",
    "scripts/ci-manifest.json",
  ]);
  assert.deepEqual(scriptsIn(local), ["scripts/ci-run.ts"]);
  assert.match(local, /^exec pnpm exec tsx scripts\/ci-run\.ts "\$@"$/m);
  assert.doesNotMatch(withoutComments(local), /playwright|format:check/);
});

test("the matrix keeps its triggers and one stable result", () => {
  assert.match(
    workflow,
    /pull_request:\n(?: +#.*\n)* +types: \[opened, synchronize, reopened, labeled, unlabeled\]/,
  );
  // The matrix runs in CD, on a dispatch and on `full-ci`, after the gate passed.
  const gate = `github.event_name != 'pull_request' ||\n      contains(github.event.pull_request.labels.*.name, 'full-ci')`;
  assert.ok(job("plan").includes("    needs: [checks, unit]\n"));
  assert.ok(job("plan").includes(`    if: >-\n      ${gate}\n`));
  const e2e = job("e2e");
  assert.ok(
    e2e.includes(`    if: >-\n      always() &&\n      (${gate})\n`),
    "e2e must report even when a smoke failed, and only when the matrix was asked for",
  );
  assert.ok(e2e.includes("    needs: [smoke]\n"));
  assert.ok(e2e.includes('run: test "${{ needs.smoke.result }}" = success'));
});

test("every smoke names a script that exists and the engines it launches", () => {
  for (const smoke of manifest.smokes) {
    const words = smoke.command.split(" ");
    assert.deepEqual(words.slice(0, 3), ["pnpm", "exec", "tsx"], smoke.id);
    const script = words[3]!;
    assert.ok(existsSync(script), `${smoke.id}: ${script} does not exist`);
    const source = readFileSync(script, "utf8");

    // scripts/lib/browser.ts is the only way these scripts pick an engine, so its calls say what to install.
    assert.doesNotMatch(source, /\b(chromium|webkit)\.launch\(/, smoke.id);
    const launched = new Set<string>();
    if (source.includes("BOTH_ENGINES"))
      for (const kind of ["chromium", "webkit"]) launched.add(kind);
    for (const [, kind] of source.matchAll(/launchBrowser\("(\w+)"/g))
      launched.add(kind!);
    for (const [, fallback] of source.matchAll(
      /(?:launchSelected|browserKind)\("(chrome|chromium)"/g,
    ))
      launched.add(browserKind(fallback as "chrome" | "chromium", smoke.env));
    assert.deepEqual(
      [...smoke.browsers].sort(),
      [...launched].sort(),
      `${smoke.id}: browsers must list what ${script} launches`,
    );

    // A smoke that reads a served URL gets it from the runner, never from its own default port.
    const reads = ["HOME_URL", "ONLINE_URL"].filter((name) =>
      source.includes(`process.env.${name}`),
    );
    assert.deepEqual(
      reads,
      smoke.serviceUrlEnv ? [smoke.serviceUrlEnv] : [],
      `${smoke.id}: serviceUrlEnv must be the URL variable ${script} reads`,
    );
  }
});

test("README lists the step names ONLY accepts", () => {
  const readme = readFileSync("README.md", "utf8");
  const paragraph = readme
    .split("\n")
    .find((line) => line.includes("`ONLY` runs a comma-separated subset"));
  assert.ok(paragraph, "README no longer documents ONLY");
  const listed = /subset of steps \(([^;]+);/.exec(paragraph)?.[1];
  assert.deepEqual(
    listed?.split(", ").map((name) => name.replaceAll("`", "")),
    stepNames(manifest),
  );
});

test("ONLY selects verify steps, groups, single smokes and core", () => {
  const ids = (only: string) => {
    const chosen = select(manifest, only);
    return [...chosen.verify, ...chosen.release, ...chosen.smokes].map(
      (step) => step.id,
    );
  };
  // Empty is everything, which is what a main push runs: the gate, the coverage gate and every smoke.
  assert.equal(
    ids("").length,
    manifest.verify.length + manifest.release.length + manifest.smokes.length,
  );
  assert.deepEqual(
    ids("core"),
    manifest.verify.map((step) => step.id),
  );
  assert.deepEqual(
    ids("release"),
    manifest.release.map((step) => step.id),
  );
  assert.deepEqual(ids("online"), ["online-chrome", "ready-check"]);
  assert.deepEqual(ids("online-chrome, build"), ["build", "online-chrome"]);
  assert.throws(() => select(manifest, "lan"), /Unknown step 'lan'/);
});

test("a smoke's env comes from the manifest, not from the caller's shell", () => {
  const smoke = (id: string) => manifest.smokes.find((item) => item.id === id)!;
  const shell = {
    PATH: "/bin",
    BROWSER: "webkit",
    ONLINE_URL: "http://occupied.example/",
    SMOKE_TIMEOUT_SCALE: "3",
  };
  assert.deepEqual(
    smokeEnv(manifest, smoke("online-chrome"), "http://localhost:9/", shell),
    {
      PATH: "/bin",
      SMOKE_TIMEOUT_SCALE: "3",
      ROOM_RENDERER: "phaser-canvas",
      ONLINE_URL: "http://localhost:9/",
    },
  );
  assert.equal(
    smokeEnv(manifest, smoke("preview-webkit"), undefined, shell).BROWSER,
    "webkit",
  );
  assert.throws(
    () => smokeEnv(manifest, smoke("keyboard"), undefined, shell),
    /needs the room service/,
  );
});

test("a manifest the workflow or the runner would misread is rejected", () => {
  const broken = (change: (copy: CiManifest) => void) => () => {
    const copy = structuredClone(manifest);
    change(copy);
    parseManifest(copy);
  };
  assert.throws(
    broken((copy) => (copy.smokes[1]!.id = copy.smokes[0]!.id)),
    /duplicate/,
  );
  assert.throws(
    broken(
      (copy) => (copy.smokes[0]!.command = "pnpm exec tsx a.ts && rm -rf ."),
    ),
    /plain words/,
  );
  assert.throws(
    broken((copy) => (copy.smokes[0]!.name = 'Keyboard" || true')),
    /plain text/,
  );
  assert.throws(
    broken((copy) => (copy.smokes[0]!.browsers = [])),
    /browsers/,
  );
  assert.throws(
    broken((copy) => (copy.smokes[0]!.timeoutMinutes = 90)),
    /timeoutMinutes/,
  );
  assert.throws(
    broken((copy) => (copy.verify[0]!.id = "core")),
    /reserved/,
  );
  assert.throws(
    broken((copy) => delete copy.verify[0]!.job),
    /job must name a ci.yml job/,
  );
  assert.throws(
    broken((copy) => (copy.release[0]!.job = "unit")),
    /release step has no job/,
  );
  assert.throws(
    broken((copy) => (copy.smokes[0]!.group = "online-chrome")),
    /another step's id/,
  );
  // A batch named like a smoke would make `ci-run.ts --smoke` and the matrix ambiguous.
  assert.throws(
    broken((copy) => (copy.smokes[0]!.batch = "online-chrome")),
    /batch online-chrome is another step's id/,
  );
  assert.throws(
    broken((copy) => (copy.smokes[0]!.batch = "Two Words")),
    /bad batch/,
  );
});

test("the room service URL is read from the banner service/dev.ts really prints", () => {
  const at = {
    port: 8801,
    base: "http://localhost:8803",
    staticDirectory: "/repo/dist",
  };
  // Both shapes: the port asked for, and the walk past a busy one.
  assert.equal(
    roomServiceUrl(devBanner({ ...at, actual: 8803 })),
    "http://localhost:8803/",
  );
  assert.equal(
    roomServiceUrl(devBanner({ ...at, port: 8803, actual: 8803 })),
    "http://localhost:8803/",
  );
  assert.equal(
    roomServiceUrl("Play solo: http://localhost:1/?solo=1"),
    undefined,
  );
});
