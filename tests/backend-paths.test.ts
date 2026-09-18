import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import {
  affectsBackend,
  decideDeploy,
  decideRelease,
  revisionCommit,
  servedCommit,
  servingRevision,
  type Run,
} from "../scripts/lib/backend-paths.js";

const SERVED = "a".repeat(40),
  HEAD = "b".repeat(40);
/** A typed fake for git: `changed` is what `git diff --name-only` prints. */
const git =
  (changed: string[], ancestor = true, ahead = false): Run =>
  (_file, args) => {
    if (args[0] === "merge-base") {
      if (!(args[2] === SERVED ? ancestor : ahead)) throw new Error("exit 1");
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
  assert.ok(copied.includes("service") && copied.includes("packages"));
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
    "service/index.ts",
    "games/fuse-riders/src/shared/game.ts",
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
    "tests/ci-manifest.test.ts",
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

test("a validated newer served revision prevents an automatic rollback", () => {
  assert.equal(decideDeploy(served, HEAD, git([], false, true)).deploy, false);
});

test("a failed rollout label matching the target still retries deployment", () => {
  const failed = servedCommit(
    service({ commit: HEAD, created: "gateway-failed", ready: "gateway-old" }),
  );
  assert.equal(decideDeploy(failed, HEAD, git([])).deploy, true);
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
  // `git mv service/x.ts docs/x.ts` with --no-renames prints both names; with rename detection only the new one.
  const decision = decideDeploy(
    served,
    HEAD,
    git(["docs/x.ts", "service/x.ts"]),
  );
  assert.equal(decision.deploy, true);
  assert.match(decision.reason, /1 backend file\(s\) changed.*service\/x\.ts/);
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
  assert.ok(
    !workflow.includes("metadata.labels.commit"),
    "readiness validation must not be bypassed by a label-only gate",
  );
  assert.ok(workflow.includes("          fetch-depth: 0\n"));
  assert.ok(
    workflow.includes(
      "        id: changes\n        run: npx tsx scripts/backend-changed.ts\n        env:\n          FORCE_DEPLOY: ${{ github.event_name == 'workflow_dispatch' }}\n",
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

/** The commit whose rollout failed after it had written the service label. */
const LABELLED = "c".repeat(40);
const TARGET = {
  force: false,
  project: "andershaf-87",
  region: "europe-west1",
  service: "fuse-riders-gateway",
};
/** A service whose label names LABELLED, while all traffic stays on gateway-00042-abc. */
const failedRollout = () =>
  service({
    commit: LABELLED,
    created: "gateway-00043-new",
    ready: "gateway-00042-abc",
    traffic: [{ revisionName: "gateway-00042-abc", percent: 100 }],
  });
const readyRevision = (commit = SERVED) => ({
  metadata: { labels: { application: "fuse-riders", commit } },
  status: { conditions: [{ type: "Ready", status: "True" }] },
});
/**
 * A typed fake for git and gcloud as decideRelease calls them. HEAD is the queued target and the
 * serving revision gateway-00042-abc runs SERVED; `headIsOlder` answers whether HEAD is an ancestor of it.
 */
const cloud = (
  change: {
    service?: unknown;
    revision?: unknown;
    headIsOlder?: boolean;
  },
  calls: string[][] = [],
): Run => {
  return (file, args) => {
    calls.push([file, ...args]);
    if (file === "git" && args[0] === "rev-parse") return HEAD;
    if (file === "git" && args[0] === "merge-base") {
      // As real git: every commit is its own ancestor, so only a strict comparison can tell "newer".
      if (args[2] === args[3]) return "";
      if (args[2] === HEAD && args[3] === SERVED && change.headIsOlder)
        return "";
      throw new Error("exit 1");
    }
    const where = ["--project=andershaf-87", "--region=europe-west1"];
    if (file === "gcloud" && args[1] === "services") {
      assert.deepEqual(args, [
        "run",
        "services",
        "describe",
        "fuse-riders-gateway",
        ...where,
        "--format=json",
      ]);
      return JSON.stringify(change.service ?? failedRollout());
    }
    if (file === "gcloud" && args[1] === "revisions") {
      assert.deepEqual(args, [
        "run",
        "revisions",
        "describe",
        "gateway-00042-abc",
        ...where,
        "--format=json",
      ]);
      if (change.revision instanceof Error) throw change.revision;
      return JSON.stringify(change.revision ?? readyRevision());
    }
    throw new Error(`unexpected ${file} ${args.join(" ")}`);
  };
};

test("a doubted label does not roll back a serving revision newer than the queued target", () => {
  // A local deploy of SERVED succeeded, then a rollout of LABELLED failed; a stale run now targets HEAD,
  // an ancestor of SERVED. Deploying HEAD would move production backwards.
  const decision = decideRelease(TARGET, cloud({ headIsOlder: true }));
  assert.equal(decision.deploy, false, decision.reason);
  assert.match(decision.reason, /not the ready revision.*newer than b{40}/);
  // The same holds when the doubt is a deliberate pin of all traffic to that newer revision.
  const pinned = service({
    traffic: [{ revisionName: "gateway-00042-abc", percent: 100 }],
    ready: "gateway-00043-new",
    created: "gateway-00043-new",
  });
  assert.equal(
    decideRelease(TARGET, cloud({ service: pinned, headIsOlder: true })).deploy,
    false,
  );
});

test("a doubted label deploys a target newer than the serving revision", () => {
  const calls: string[][] = [];
  const decision = decideRelease(TARGET, cloud({ headIsOlder: false }, calls));
  assert.equal(decision.deploy, true);
  assert.match(decision.reason, /not the ready revision/);
  // It did look: the serving revision was read and compared, and was not newer.
  assert.ok(calls.some((call) => call[2] === "revisions"));
  assert.ok(calls.some((call) => call[1] === "merge-base"));
});

test("a doubted label deploys when the serving revision cannot be read or trusted", () => {
  for (const revision of [
    new Error("PERMISSION_DENIED"),
    readyRevision("not-a-sha"),
    { metadata: readyRevision().metadata, status: { conditions: [] } },
    {
      metadata: readyRevision().metadata,
      status: { conditions: [{ type: "Ready", status: "False" }] },
    },
  ])
    assert.equal(
      decideRelease(TARGET, cloud({ revision, headIsOlder: true })).deploy,
      true,
      String(revision instanceof Error ? revision : JSON.stringify(revision)),
    );
  // A split names no serving revision at all.
  const split = service({
    created: "gateway-00043-new",
    traffic: [
      { revisionName: "gateway-00042-abc", percent: 50 },
      { revisionName: "gateway-00043-new", percent: 50 },
    ],
  });
  assert.equal(
    decideRelease(TARGET, cloud({ service: split, headIsOlder: true })).deploy,
    true,
  );
  // The serving revision runs the target itself: not strictly newer, so the doubt still deploys.
  assert.equal(
    decideRelease(TARGET, cloud({ revision: readyRevision(HEAD) })).deploy,
    true,
  );
  // An unreadable service deploys too.
  assert.equal(
    decideRelease(TARGET, (file, args) => {
      if (file === "git") return HEAD;
      throw new Error(`gcloud ${args.join(" ")} failed`);
    }).deploy,
    true,
  );
});

test("a manual dispatch deploys an older target without asking Cloud Run", () => {
  // The situation of the skip test above, dispatched on purpose: an intentional rollback must work.
  const calls: string[][] = [];
  const decision = decideRelease(
    { ...TARGET, force: true },
    cloud({ headIsOlder: true }, calls),
  );
  assert.deepEqual(decision, { deploy: true, reason: "manual dispatch" });
  assert.deepEqual(calls, []);
});

test("the serving revision is the one with all of the traffic, and its commit needs a ready label", () => {
  assert.equal(servingRevision(failedRollout()), "gateway-00042-abc");
  assert.equal(servingRevision(service()), "gateway-00042-abc");
  assert.equal(
    servingRevision(
      service({ traffic: [{ latestRevision: true, percent: 100 }] }),
    ),
    "gateway-00042-abc",
  );
  assert.equal(
    servingRevision(
      service({
        traffic: [
          { revisionName: "gateway-00042-abc", percent: 90 },
          { revisionName: "gateway-00041-old", percent: 10 },
        ],
      }),
    ),
    undefined,
  );
  assert.equal(servingRevision(service({ traffic: [] })), undefined);
  assert.equal(servingRevision(null), undefined);
  assert.equal(revisionCommit(readyRevision()), SERVED);
  assert.equal(revisionCommit({ status: readyRevision().status }), undefined);
  assert.equal(revisionCommit(null), undefined);
});
