/**
 * What a Cloud Run deployment is built from, so .github/workflows/backend.yml can skip a main push
 * that touched none of it. An entry ending in `/` is a directory; any other entry is one file.
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
 * manual rollback) answers with a doubt, and every doubt deploys, as every push did before this filter.
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
 * Deploy unless it is certain that nothing the backend is built from changed between the commit
 * Cloud Run serves (`servedCommit`) and `head`. Comparing with what is served, not with the previous
 * push, means a change whose own run failed or was superseded is still picked up by the next run.
 * Every doubt deploys.
 */
export function decideDeploy(
  served: { commit: string } | { doubt: string },
  head: string,
  git: Run,
): DeployDecision {
  if ("doubt" in served) return { deploy: true, reason: served.doubt };
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
