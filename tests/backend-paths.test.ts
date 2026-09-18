import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import {
  affectsBackend,
  decideDeploy,
  servedCommit,
  type Run,
} from "../scripts/lib/backend-paths.js";

const SERVED = "a".repeat(40),
  HEAD = "b".repeat(40);
/** A typed fake for git: `changed` is what `git diff --name-only` prints. */
const git =
  (changed: string[], ancestor = true): Run =>
  (_file, args) => {
    if (args[0] === "merge-base") {
      if (!ancestor) throw new Error("exit 1");
      return "";
    }
    assert.deepEqual(args, [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-renames",
      "--name-only",
      SERVED,
      HEAD,
    ]);
    return changed.join("\n");
  };
const served = { commit: SERVED };
/** `gcloud run services describe --format=json`, reduced to what the filter reads. */
const service = (
  change: {
    commit?: string;
    created?: string;
    ready?: string;
    traffic?: unknown;
  } = {},
) => ({
  metadata: {
    labels: { application: "fuse-riders", commit: change.commit ?? SERVED },
  },
  status: {
    latestCreatedRevisionName: change.created ?? "gateway-00042-abc",
    latestReadyRevisionName: change.ready ?? "gateway-00042-abc",
    traffic: change.traffic ?? [
      { revisionName: "gateway-00042-abc", percent: 100, latestRevision: true },
    ],
  },
});

/**
 * Every source of every COPY and ADD: continuation lines joined, flags dropped, JSON form parsed. A
 * `--from=<stage>` copy reads another stage, not the repository, and is left out.
 */
function dockerSources(dockerfile: string): string[] {
  return dockerfile
    .replace(/\\\r?\n/g, " ")
    .split("\n")
    .map((line) => /^\s*(?:COPY|ADD)\s+(.*)$/i.exec(line)?.[1]?.trim())
    .filter((rest): rest is string => rest !== undefined)
    .flatMap((rest) => {
      const flags = rest.match(/^(?:--\S+\s+)*/)?.[0] ?? "";
      if (/--from=/.test(flags)) return [];
      const operands = rest.slice(flags.length).trim();
      const words = operands.startsWith("[")
        ? (JSON.parse(operands) as string[])
        : operands.split(/\s+/);
      return words.slice(0, -1);
    });
}

test("everything the image is built from is a backend path", () => {
  const copied = dockerSources(readFileSync("Dockerfile.cloud", "utf8"));
  assert.ok(copied.includes("src") && copied.includes("packages"));
  for (const source of copied)
    assert.ok(
      affectsBackend(source) || affectsBackend(`${source}/any/file.ts`),
      `Dockerfile.cloud copies ${source}, which scripts/lib/backend-paths.ts does not cover`,
    );
  // The build context is an allowlist; whatever it lets in can reach the image.
  const allowed = readFileSync(".dockerignore", "utf8")
    .split("\n")
    .filter((line) => line.startsWith("!"))
    .map((line) => line.slice(1).replaceAll("*", "x"));
  assert.ok(allowed.length > 0);
  for (const path of allowed)
    assert.ok(
      affectsBackend(path) || affectsBackend(`${path}file`),
      `.dockerignore admits ${path}, which scripts/lib/backend-paths.ts does not cover`,
    );
});

test("the release inputs are backend paths and documentation or browser tooling is not", () => {
  for (const file of [
    "src/service/index.ts",
    "src/shared/game.ts",
    "packages/fuse-network-be/src/gateway.ts",
    "packages/fuse-network-protocol/package.json",
    "package-lock.json",
    "Dockerfile.cloud",
    "scripts/deploy-cloud.sh",
    "scripts/cloudbuild.yaml",
    "scripts/configuration/model.ts",
    "deploy/firebase-config.json",
    "firestore.rules",
    "firestore.indexes.json",
    "firebase.json",
    "tools/firebase/package-lock.json",
    ".github/workflows/backend.yml",
    "scripts/lib/backend-paths.ts",
  ])
    assert.ok(affectsBackend(file), file);
  for (const file of [
    "README.md",
    "AGENTS.md",
    "docs/architecture.md",
    "tests/game.test.ts",
    "scripts/online-smoke.ts",
    "scripts/ci-manifest.json",
    ".github/workflows/ci.yml",
    "srcs/not-src.ts",
  ])
    assert.ok(!affectsBackend(file), file);
});

test("a push that changed no backend path since the served commit is skipped", () => {
  const decision = decideDeploy(
    served,
    HEAD,
    git(["README.md", "docs/verification.md", "scripts/keyboard-smoke.ts"]),
  );
  assert.equal(decision.deploy, false);
  assert.match(decision.reason, /none of the 3 file/);
  assert.equal(decideDeploy({ commit: HEAD }, HEAD, git([])).deploy, false);
});

test("frontend-only releases advance the backend revision used by Pages", () => {
  for (const file of [
    "public/music/track.mp3",
    "index.html",
    "vite.config.ts",
    ".github/workflows/pages.yml",
  ]) {
    assert.equal(decideDeploy(served, HEAD, git([file])).deploy, true, file);
  }
});

test("a backend change anywhere since the served commit deploys", () => {
  const decision = decideDeploy(
    served,
    HEAD,
    git(["README.md", "packages/fuse-network-be/src/gateway.ts"]),
  );
  assert.equal(decision.deploy, true);
  assert.match(decision.reason, /packages\/fuse-network-be\/src\/gateway\.ts/);
});

test("a file moved out of the backend paths still counts: the diff lists its old path", () => {
  // `git mv src/x.ts docs/x.ts` with --no-renames prints both names; with rename detection only the new one.
  const decision = decideDeploy(served, HEAD, git(["docs/x.ts", "src/x.ts"]));
  assert.equal(decision.deploy, true);
  assert.match(decision.reason, /1 backend file\(s\) changed.*src\/x\.ts/);
});

test("the Dockerfile reader sees ADD, continuation lines, flags and the JSON form", () => {
  assert.deepEqual(
    dockerSources(
      [
        "FROM node:22",
        "COPY package.json package-lock.json ./",
        "COPY --chown=node:node src \\",
        "  packages ./app/",
        'ADD ["tools/firebase", "deploy", "/opt/"]',
        "COPY --from=build /out ./out",
        "RUN echo COPY not-a-copy .",
      ].join("\n"),
    ),
    [
      "package.json",
      "package-lock.json",
      "src",
      "packages",
      "tools/firebase",
      "deploy",
    ],
  );
});

test("the label counts as served only when its rollout is ready and carries all of the traffic", () => {
  assert.deepEqual(servedCommit(service()), { commit: SERVED });
  assert.deepEqual(
    servedCommit(
      service({
        traffic: [{ revisionName: "gateway-00042-abc", percent: 100 }],
      }),
    ),
    { commit: SERVED },
  );
  const doubt = (value: unknown) => {
    const answer = servedCommit(value);
    assert.ok("doubt" in answer, JSON.stringify(answer));
    assert.equal(decideDeploy(answer, HEAD, git([])).deploy, true);
    return answer.doubt;
  };
  // The rollout that wrote the label never became ready: traffic is still on the revision before it.
  assert.match(
    doubt(
      service({
        created: "gateway-00043-new",
        ready: "gateway-00042-abc",
        traffic: [{ revisionName: "gateway-00042-abc", percent: 100 }],
      }),
    ),
    /gateway-00043-new.*not the ready revision/,
  );
  // Ready, but a manual rollback or a split keeps traffic elsewhere.
  assert.match(
    doubt(
      service({
        traffic: [{ revisionName: "gateway-00041-old", percent: 100 }],
      }),
    ),
    /does not carry all of the traffic/,
  );
  assert.match(
    doubt(
      service({
        traffic: [
          { revisionName: "gateway-00042-abc", percent: 50 },
          { revisionName: "gateway-00041-old", percent: 50 },
        ],
      }),
    ),
    /does not carry all of the traffic/,
  );
  assert.match(doubt(service({ traffic: [] })), /traffic/);
  assert.match(doubt(service({ commit: "not-a-sha" })), /no commit label/);
  assert.match(doubt({}), /no commit label/);
  assert.match(doubt(null), /no commit label/);
});

test("a failed rollout is retried by the next push even when that push is documentation only", () => {
  // Backend commit X rolled out and failed; README-only commit Y follows. X..Y has no backend file,
  // so only the rollout state can say that X is not served yet.
  const afterFailedRollout = service({
    created: "gateway-00043-new",
    ready: "gateway-00042-abc",
    traffic: [{ revisionName: "gateway-00042-abc", percent: 100 }],
  });
  assert.equal(
    decideDeploy(servedCommit(afterFailedRollout), HEAD, git(["README.md"]))
      .deploy,
    true,
  );
});

test("a served commit that is not behind this one deploys", () => {
  // Force-push or shallow checkout: the diff means nothing.
  assert.equal(
    decideDeploy(served, HEAD, git(["README.md"], false)).deploy,
    true,
  );
});

test("everything the configuration step reads or imports is a backend path", () => {
  // scripts/deploy-cloud.sh applies configuration through this script before it builds.
  const script = "scripts/deploy-configuration.ts";
  const source = readFileSync(script, "utf8");
  const literals = [...source.matchAll(/"([^"\n]+)"/g)].map(
    (match) => match[1]!,
  );
  const files = literals.filter(
    (text) =>
      !text.startsWith(".") &&
      !/^artifacts(\/|$)/.test(text) && // its output, not an input
      !text.includes(":") &&
      /^[\w.-]+(\/[\w.-]+)*$/.test(text) &&
      // A file here, a configuration file by its extension (so a new one counts before it exists), or a
      // path under a directory of this repository; "application/json" is none of these.
      (existsSync(text) ||
        /\.(json|rules|ya?ml)$/.test(text) ||
        (text.includes("/") && existsSync(text.split("/")[0]!))),
  );
  for (const expected of [
    "deploy/firebase-config.json",
    "firebase.json",
    "firestore.indexes.json",
    "firestore.rules",
    "tools/firebase/node_modules/.bin/firebase",
  ])
    assert.ok(
      files.includes(expected),
      `the reader no longer finds ${expected}`,
    );
  const imports = literals
    .filter((text) => text.startsWith("./") || text.startsWith("../"))
    .map((text) =>
      normalize(join(dirname(script), text)).replace(/\.js$/, ".ts"),
    );
  assert.ok(imports.includes("scripts/configuration/model.ts"));
  for (const file of [script, ...files, ...imports])
    assert.ok(
      // A bare directory name ("deploy") stands for what is under it.
      affectsBackend(file) || affectsBackend(`${file}/`),
      `${script} depends on ${file}, which scripts/lib/backend-paths.ts does not cover`,
    );
});

test("backend.yml asks the filter before it installs or deploys, and a dispatch still deploys", () => {
  const workflow = readFileSync(".github/workflows/backend.yml", "utf8");
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.ok(workflow.includes("          fetch-depth: 0\n"));
  assert.ok(
    workflow.includes(
      "        id: changes\n        if: steps.live.outputs.action != 'skip'\n        run: npx tsx scripts/backend-changed.ts\n        env:\n          FORCE_DEPLOY: ${{ github.event_name == 'workflow_dispatch' }}\n",
    ),
  );
  assert.ok(
    workflow.includes(
      "      - if: steps.changes.outputs.deploy == 'true'\n        run: ./scripts/deploy-cloud.sh\n",
    ),
  );
  assert.ok(
    workflow.indexOf("id: changes") <
      workflow.indexOf("run: ./scripts/deploy-cloud.sh"),
  );
});
