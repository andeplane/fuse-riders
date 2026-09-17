/**
 * The path filter of .github/workflows/backend.yml. A `workflow_run` trigger cannot use `paths:`, and
 * the previous push is the wrong thing to compare with anyway, so this asks Cloud Run which commit it
 * really serves (label, ready revision and traffic) and looks at everything since (scripts/lib/backend-paths.ts).
 *
 * Writes `deploy=true|false` to $GITHUB_OUTPUT. FORCE_DEPLOY=true (a manual dispatch) always deploys.
 * Needs a full-history checkout and an authenticated gcloud; without either it answers "deploy".
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  decideDeploy,
  servedCommit,
  type DeployDecision,
  type Run,
} from "./lib/backend-paths.js";

const run: Run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

function decide(): DeployDecision {
  if (process.env.FORCE_DEPLOY === "true")
    return { deploy: true, reason: "manual dispatch" };
  const head = run("git", ["rev-parse", "HEAD"]);
  let service: unknown;
  try {
    service = JSON.parse(
      run("gcloud", [
        "run",
        "services",
        "describe",
        process.env.CLOUD_RUN_SERVICE ?? "fuse-riders-gateway",
        "--project=andershaf-87",
        `--region=${process.env.GCP_REGION ?? "europe-west1"}`,
        "--format=json",
      ]),
    );
  } catch {
    return { deploy: true, reason: "could not read the Cloud Run service" };
  }
  return decideDeploy(servedCommit(service), head, run);
}

let decision: DeployDecision;
try {
  decision = decide();
} catch (error) {
  // A filter that cannot decide must never be the reason a backend change stays undeployed.
  decision = {
    deploy: true,
    reason: `the path filter failed (${error instanceof Error ? error.message : error})`,
  };
}
const line = `${decision.deploy ? "Deploying" : "Skipping the backend deployment"}: ${decision.reason}`;
console.log(line);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${decision.deploy}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
