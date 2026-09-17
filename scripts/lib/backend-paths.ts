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
 * Deploy unless it is certain that nothing the backend is built from changed between the commit
 * Cloud Run serves (the `commit` label scripts/deploy-cloud.sh sets) and `head`. Comparing with what
 * is served, not with the previous push, means a change whose own run failed or was superseded is
 * still picked up by the next run. Every doubt deploys.
 */
export function decideDeploy(
  deployed: string,
  head: string,
  git: Run,
): DeployDecision {
  if (!/^[0-9a-f]{40}$/.test(deployed))
    return {
      deploy: true,
      reason: "the served revision carries no commit label",
    };
  if (deployed === head)
    return { deploy: false, reason: `${head} is already served` };
  let files: string[];
  try {
    git("git", ["merge-base", "--is-ancestor", deployed, head]);
    files = git("git", ["diff", "--name-only", deployed, head])
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
