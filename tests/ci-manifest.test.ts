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
import { devBanner } from "../service/dev.js";

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

test("the verify job runs exactly the manifest's verify steps, in order", () => {
  const runs = runsIn(job("verify"));
  assert.deepEqual(runs, [
    "pnpm install --frozen-lockfile",
    ...manifest.verify.map((step) => step.command),
  ]);
  // The pull-request gate is this job alone: it waits for nothing and is never skipped.
  assert.doesNotMatch(job("verify"), /^ {4}(needs|if):/m);
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

test("the browser matrix is built from the manifest, one job per smoke", () => {
  const plan = job("plan");
  for (const line of [
    "      ids: ${{ steps.manifest.outputs.ids }}",
    "      byId: ${{ steps.manifest.outputs.byId }}",
    `          printf 'ids=%s\\n' "$(jq -c '[.smokes[].id]' scripts/ci-manifest.json)" >> "$GITHUB_OUTPUT"`,
    `          printf 'byId=%s\\n' "$(jq -c '.smokes | map({key: .id, value: .}) | from_entries' scripts/ci-manifest.json)" >> "$GITHUB_OUTPUT"`,
  ])
    assert.ok(plan.split("\n").includes(line), `plan job lost: ${line}`);
  const smoke = job("smoke");
  const entry = "fromJson(needs.plan.outputs.byId)[matrix.id]";
  for (const line of [
    "    needs: plan",
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
  assert.deepEqual(runsIn(smoke), [
    "pnpm install --frozen-lockfile",
    "pnpm build",
    `pnpm exec playwright install --with-deps \${{ join(${entry}.browsers, ' ') }}`,
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
    "scripts/ci-manifest.json",
    "scripts/ci-run.ts",
  ]);
  assert.deepEqual(scriptsIn(local), ["scripts/ci-run.ts"]);
  assert.match(local, /^exec pnpm exec tsx scripts\/ci-run\.ts "\$@"$/m);
  assert.doesNotMatch(withoutComments(local), /playwright|format:check/);
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
    return [...chosen.verify, ...chosen.smokes].map((step) => step.id);
  };
  assert.equal(ids("").length, manifest.verify.length + manifest.smokes.length);
  assert.deepEqual(
    ids("core"),
    manifest.verify.map((step) => step.id),
  );
  assert.deepEqual(ids("online"), [
    "online-chrome",
    "online-webkit",
    "ready-check",
  ]);
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
    broken((copy) => (copy.smokes[0]!.group = "online-chrome")),
    /another step's id/,
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
