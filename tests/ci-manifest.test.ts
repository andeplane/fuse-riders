import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  loadManifest,
  parseManifest,
  select,
  smokeEnv,
  stepNames,
  type CiManifest,
} from "../scripts/lib/ci-manifest.js";
import { browserKind } from "../scripts/lib/browser.js";
import { roomServiceUrl } from "../scripts/lib/server.js";

// scripts/ci-manifest.json is the only list of CI steps. These tests fail when .github/workflows/ci.yml or
// scripts/ci-local.sh stops reading it, or when the one hand-written copy (the `verify` job) differs from it.
const manifest = loadManifest();
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const local = readFileSync("scripts/ci-local.sh", "utf8");

/** The text of one job, without a YAML parser: jobs are the two-space keys after `jobs:`. */
function job(name: string): string {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);
  const blocks = jobs.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m);
  const block = blocks.find((item) => item.startsWith(`  ${name}:`));
  assert.ok(block, `ci.yml has no ${name} job`);
  return block;
}
const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
const scriptsIn = (text: string) => [
  ...new Set(withoutComments(text).match(/scripts\/[\w./-]+/g) ?? []),
];

test("the verify job runs exactly the manifest's verify steps, in order", () => {
  const runs = [...job("verify").matchAll(/^ {6}- run: (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(runs, [
    "npm ci",
    ...manifest.verify.map((step) => step.command),
  ]);
  // The pull-request gate is this job alone: it waits for nothing and is never skipped.
  assert.doesNotMatch(job("verify"), /^ {4}(needs|if):/m);
});

test("the browser matrix is built from the manifest, one job per smoke", () => {
  assert.ok(
    job("plan").includes(
      `run: printf 'smokes=%s\\n' "$(jq -c .smokes scripts/ci-manifest.json)" >> "$GITHUB_OUTPUT"`,
    ),
  );
  assert.match(
    job("plan"),
    /^ {6}smokes: \$\{\{ steps\.manifest\.outputs\.smokes \}\}$/m,
  );
  const smoke = job("smoke");
  for (const line of [
    "    needs: plan",
    "      fail-fast: false",
    "        smoke: ${{ fromJson(needs.plan.outputs.smokes) }}",
    "    timeout-minutes: ${{ matrix.smoke.timeoutMinutes }}",
    "      - run: npx playwright install --with-deps ${{ join(matrix.smoke.browsers, ' ') }}",
    "      - name: ${{ matrix.smoke.name }}",
    '        run: npx tsx scripts/ci-run.ts --smoke "${{ matrix.smoke.id }}"',
    "          name: browser-evidence-${{ matrix.smoke.id }}",
    "      SMOKE_TIMEOUT_SCALE: 3",
  ])
    assert.ok(smoke.split("\n").includes(line), `smoke job lost: ${line}`);
  // Evidence is uploaded whether the smoke passed or not.
  assert.match(
    smoke,
    /- name: Save browser evidence\n {8}if: always\(\)\n {8}uses: actions\/upload-artifact@v4/,
  );
});

test("no smoke is written out in the workflow or in the local mirror", () => {
  assert.deepEqual(scriptsIn(workflow), [
    "scripts/ci-manifest.json",
    "scripts/ci-run.ts",
  ]);
  assert.deepEqual(scriptsIn(local), ["scripts/ci-run.ts"]);
  assert.match(local, /^exec npx tsx scripts\/ci-run\.ts "\$@"$/m);
  assert.doesNotMatch(withoutComments(local), /npm run|playwright/);
});

test("the matrix keeps its triggers and one stable result", () => {
  assert.match(
    workflow,
    /pull_request:\n(?: +#.*\n)* +types: \[opened, synchronize, reopened, labeled\]/,
  );
  const gate = `github.event_name != 'pull_request' ||\n      contains(github.event.pull_request.labels.*.name, 'full-ci')`;
  assert.ok(job("plan").includes(`    if: >-\n      ${gate}\n`));
  const e2e = job("e2e");
  assert.ok(
    e2e.includes(`    if: >-\n      always() &&\n      (${gate})\n`),
    "e2e must report even when a smoke failed, and only when the matrix was asked for",
  );
  assert.ok(e2e.includes("    needs: smoke\n"));
  assert.ok(e2e.includes('run: test "${{ needs.smoke.result }}" = success'));
});

test("every smoke names a script that exists and the engines it launches", () => {
  for (const smoke of manifest.smokes) {
    const words = smoke.command.split(" ");
    assert.deepEqual(words.slice(0, 2), ["npx", "tsx"], smoke.id);
    const script = words[2]!;
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
    return [...chosen.verify, ...chosen.smokes].map((step) => step.id);
  };
  assert.equal(ids("").length, manifest.verify.length + manifest.smokes.length);
  assert.deepEqual(
    ids("core"),
    manifest.verify.map((step) => step.id),
  );
  assert.deepEqual(ids("online"), ["online-chrome", "online-webkit"]);
  assert.deepEqual(ids("online-webkit, build"), ["build", "online-webkit"]);
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
    broken((copy) => (copy.smokes[0]!.command = "npx tsx a.ts && rm -rf .")),
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
    broken((copy) => (copy.smokes[0]!.group = "online-chrome")),
    /another step's id/,
  );
});

test("the room service URL is read from the banner it prints", () => {
  assert.equal(
    roomServiceUrl(
      "\nFUSE RIDERS — online rooms, locally\n\nPort 8801 is in use; using 8803 instead.\n\nHome:      http://localhost:8803/          (create or join a room)\nPlay solo: http://localhost:8803/?solo=1\n",
    ),
    "http://localhost:8803/",
  );
  assert.equal(
    roomServiceUrl("Play solo: http://localhost:1/?solo=1"),
    undefined,
  );
});
