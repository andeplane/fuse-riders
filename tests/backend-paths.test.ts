import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  affectsBackend,
  decideDeploy,
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
    assert.deepEqual(args, ["diff", "--name-only", SERVED, HEAD]);
    return changed.join("\n");
  };

test("everything the image is built from is a backend path", () => {
  const copied = [
    ...readFileSync("Dockerfile.cloud", "utf8").matchAll(
      /^COPY (?:--\S+ )*(.+) \S+$/gm,
    ),
  ].flatMap((match) => match[1]!.split(" "));
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
    ".github/workflows/pages.yml",
    "public/music/track.mp3",
    "index.html",
    "srcs/not-src.ts",
  ])
    assert.ok(!affectsBackend(file), file);
});

test("a push that changed no backend path since the served commit is skipped", () => {
  const decision = decideDeploy(
    SERVED,
    HEAD,
    git(["README.md", "docs/verification.md", "scripts/keyboard-smoke.ts"]),
  );
  assert.equal(decision.deploy, false);
  assert.match(decision.reason, /none of the 3 file/);
  assert.equal(decideDeploy(HEAD, HEAD, git([])).deploy, false);
});

test("a backend change anywhere since the served commit deploys", () => {
  const decision = decideDeploy(
    SERVED,
    HEAD,
    git(["README.md", "packages/fuse-network-be/src/gateway.ts"]),
  );
  assert.equal(decision.deploy, true);
  assert.match(decision.reason, /packages\/fuse-network-be\/src\/gateway\.ts/);
});

test("every doubt about what is served deploys", () => {
  assert.equal(decideDeploy("", HEAD, git([])).deploy, true);
  assert.equal(decideDeploy("not-a-sha", HEAD, git([])).deploy, true);
  // A served commit that is not behind this one (force-push, shallow checkout): the diff means nothing.
  assert.equal(
    decideDeploy(SERVED, HEAD, git(["README.md"], false)).deploy,
    true,
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
