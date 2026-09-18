/**
 * Release inputs that require advancing the live Cloud Run revision, so backend.yml can skip
 * a main push that touched none of them. Pages publishes that same live revision. An entry ending in `/` is a directory; any other entry is one file.
 *
 * Conservative on purpose: Dockerfile.cloud copies all of `src/` and `packages/` into the image, so
 * all of both stay here (a client-only change still redeploys) until the image copies less.
 * tests/backend-paths.test.ts fails when Dockerfile.cloud or .dockerignore lets in a path this list
 * does not cover.
 */
export const BACKEND_PATHS: readonly string[] = [
  // The image: Dockerfile.cloud, what it copies and what decides its dependencies.
  "Dockerfile.cloud",
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "src/",
  "packages/",
  // Pages publishes the live backend revision. Advance it for frontend-only release changes too,
  // otherwise a successful skipped backend run would republish the old assets forever.
  "public/",
  "index.html",
  "vite.config.ts",
  ".github/workflows/pages.yml",
  // The release: scripts/deploy-cloud.sh, the build it submits and the configuration it applies first.
  "scripts/deploy-cloud.sh",
  "scripts/cloudbuild.yaml",
  "scripts/deploy-configuration.ts",
  "scripts/configuration/",
  "deploy/",
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "tools/firebase/",
  "tsconfig.json",
  // The pipeline and this decision.
  ".github/workflows/backend.yml",
  "scripts/backend-changed.ts",
  "scripts/lib/backend-paths.ts",
];

export const affectsBackend = (file: string): boolean =>
  BACKEND_PATHS.some((entry) =>
    entry.endsWith("/") ? file.startsWith(entry) : file === entry,
  );

export interface DeployDecision {
  deploy: boolean;
  reason: string;
}

/** Runs a command and returns its stdout; throws when it fails. */
export type Run = (file: string, args: string[]) => string;

/**
 * The commit Cloud Run is actually serving, from `gcloud run services describe --format=json`, or the
 * reason it cannot be known.
 *
 * The service's `commit` label alone is not that: scripts/deploy-cloud.sh writes it in the same update
 * that creates the new revision, so a rollout that never becomes ready leaves the label naming a commit
 * nobody is served. The label is trusted only when the revision that update created is the ready one
 * and carries all of the traffic. Anything else (a failed or unfinished rollout, a traffic split, a
 * manual rollback) answers with a doubt, and a doubt deploys unless the revision that really serves is
 * provably newer than the target (`decideDeploy`).
 */
export function servedCommit(
  service: unknown,
): { commit: string } | { doubt: string } {
  const { metadata, status } = (service ?? {}) as {
    metadata?: { labels?: Record<string, unknown> };
    status?: {
      latestCreatedRevisionName?: unknown;
      latestReadyRevisionName?: unknown;
      traffic?: unknown;
    };
  };
  const commit = metadata?.labels?.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit))
    return { doubt: "the service carries no commit label" };
  const created = status?.latestCreatedRevisionName,
    ready = status?.latestReadyRevisionName;
  if (typeof created !== "string" || created === "" || created !== ready)
    return {
      doubt: `the last rollout (${String(created)}) is not the ready revision (${String(ready)})`,
    };
  const traffic = Array.isArray(status?.traffic)
    ? (status.traffic as Array<{
        revisionName?: unknown;
        percent?: unknown;
        latestRevision?: unknown;
      }>)
    : [];
  const serving = traffic.filter((target) => Number(target.percent) > 0);
  if (
    serving.length !== 1 ||
    serving[0]!.percent !== 100 ||
    (serving[0]!.revisionName !== ready && serving[0]!.latestRevision !== true)
  )
    return { doubt: `${ready} does not carry all of the traffic` };
  return { commit };
}

/**
 * The revision that carries all of the traffic in `gcloud run services describe --format=json`, or
 * undefined when traffic is split, missing or unnamed. Unlike `servedCommit` this does not require the
 * last rollout to be that revision: it names what is serving even while the label is in doubt.
 */
export function servingRevision(service: unknown): string | undefined {
  const status = (service as { status?: Record<string, unknown> } | null)
    ?.status;
  const traffic = Array.isArray(status?.traffic)
    ? (status.traffic as Array<{
        revisionName?: unknown;
        percent?: unknown;
        latestRevision?: unknown;
      }>)
    : [];
  const serving = traffic.filter((target) => Number(target.percent) > 0);
  if (serving.length !== 1 || serving[0]!.percent !== 100) return undefined;
  const name =
    typeof serving[0]!.revisionName === "string"
      ? serving[0]!.revisionName
      : serving[0]!.latestRevision === true
        ? status?.latestReadyRevisionName
        : undefined;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/**
 * The `commit` label of a ready revision, from `gcloud run revisions describe --format=json`, or
 * undefined when the revision is not ready or carries no full commit SHA. scripts/deploy-cloud.sh sets
 * the label on the revision template, so every revision it created carries the commit it was built from.
 */
export function revisionCommit(revision: unknown): string | undefined {
  const { metadata, status } = (revision ?? {}) as {
    metadata?: { labels?: Record<string, unknown> };
    status?: { conditions?: unknown };
  };
  const commit = metadata?.labels?.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit))
    return undefined;
  const ready =
    Array.isArray(status?.conditions) &&
    (status.conditions as Array<{ type?: unknown; status?: unknown }>).some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    );
  return ready ? commit : undefined;
}

/**
 * The label is in doubt (a failed or unfinished rollout, a split, a pin). Deploy, unless the revision
 * that really serves all of the traffic was built from a commit strictly newer than `head`: then this is
 * a stale automatic run (for example a local deploy of a newer commit, followed by a failed rollout of
 * another one) and deploying would roll production back. Anything unknown or unreadable deploys.
 */
function decideInDoubt(
  doubt: string,
  head: string,
  git: Run,
  serving: string | undefined,
): DeployDecision {
  if (serving !== undefined && serving !== head) {
    try {
      git("git", ["merge-base", "--is-ancestor", head, serving]);
      return {
        deploy: false,
        reason: `${doubt}, but the revision serving all traffic runs ${serving}, which is newer than ${head}`,
      };
    } catch {
      // Not provably newer: an older, unrelated or unavailable commit never suppresses a deployment.
    }
  }
  return { deploy: true, reason: doubt };
}

export interface Target {
  /** A manual dispatch: always deploys, so an intentional rollback to an older commit works. */
  force: boolean;
  project: string;
  region: string;
  service: string;
}

/**
 * The whole filter: read what Cloud Run serves, and when the label is in doubt also the commit of the
 * revision that carries all of the traffic, then `decideDeploy`. `run` executes git and gcloud; a read
 * that fails leaves the decision on the deploying side.
 */
export function decideRelease(target: Target, run: Run): DeployDecision {
  if (target.force) return { deploy: true, reason: "manual dispatch" };
  const head = run("git", ["rev-parse", "HEAD"]);
  const where = [`--project=${target.project}`, `--region=${target.region}`];
  let service: unknown;
  try {
    service = JSON.parse(
      run("gcloud", [
        "run",
        "services",
        "describe",
        target.service,
        ...where,
        "--format=json",
      ]),
    );
  } catch {
    return { deploy: true, reason: "could not read the Cloud Run service" };
  }
  const served = servedCommit(service);
  let serving: string | undefined;
  const revision = "doubt" in served ? servingRevision(service) : undefined;
  if (revision !== undefined) {
    try {
      serving = revisionCommit(
        JSON.parse(
          run("gcloud", [
            "run",
            "revisions",
            "describe",
            revision,
            ...where,
            "--format=json",
          ]),
        ),
      );
    } catch {
      // Unreadable: the doubt stands and deploys.
    }
  }
  return decideDeploy(served, head, run, serving);
}

/**
 * Deploy unless it is certain that nothing the backend is built from changed between the commit
 * Cloud Run serves (`servedCommit`) and `head`. Comparing with what is served, not with the previous
 * push, means a change whose own run failed or was superseded is still picked up by the next run.
 * A doubt deploys, unless `serving` (the commit of the revision carrying all of the traffic) is strictly
 * newer than `head`; neither path ever rolls a newer served commit back to an older queued target.
 */
export function decideDeploy(
  served: { commit: string } | { doubt: string },
  head: string,
  git: Run,
  serving?: string,
): DeployDecision {
  if ("doubt" in served) return decideInDoubt(served.doubt, head, git, serving);
  const deployed = served.commit;
  if (deployed === head)
    return { deploy: false, reason: `${head} is already served` };
  let files: string[];
  try {
    git("git", ["merge-base", "--is-ancestor", deployed, head]);
    // --no-renames: a file moved out of the backend paths must show its old path, not only its new one.
    // core.quotePath=false: a non-ASCII path is printed as it is, not quoted and escaped.
    files = git("git", [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-renames",
      "--name-only",
      deployed,
      head,
    ])
      .split("\n")
      .filter(Boolean);
  } catch {
    // A validated live revision may be newer than this queued automatic run. Never roll it back.
    try {
      git("git", ["merge-base", "--is-ancestor", head, deployed]);
      return {
        deploy: false,
        reason: `${deployed} is already serving a newer revision than ${head}`,
      };
    } catch {
      // An unrelated or unavailable history remains uncertain and must not suppress a deployment.
    }
    return {
      deploy: true,
      reason: `served commit ${deployed} is not an ancestor of ${head} in this checkout`,
    };
  }
  const changed = files.filter(affectsBackend);
  return changed.length > 0
    ? {
        deploy: true,
        reason: `${changed.length} backend file(s) changed since ${deployed}: ${changed.slice(0, 10).join(", ")}${changed.length > 10 ? ", …" : ""}`,
      }
    : {
        deploy: false,
        reason: `none of the ${files.length} file(s) changed since ${deployed} is part of the backend`,
      };
}
