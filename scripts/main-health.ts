/**
 * Is main red? The pull-request gate asks before it decides how much a pull request must prove (ci.yml,
 * `main-health`). Main is red when its latest finished CI push run did not succeed, which also withholds both
 * deployments, or when the latest real Deploy backend or Deploy Pages run failed. While main is red, `verify`
 * on every pull request requires coverage and the whole browser matrix on top of main, so only a change that
 * leaves main green can merge; a failed deployment also needs the `cd-fix` label, since pull-request CI cannot
 * show that a deployment works.
 *
 * Run with plain Node (types are stripped), so the job needs no install: no imports beyond Node's own.
 * Writes `red`, `deploy-red` and `reason` to $GITHUB_OUTPUT. Fails open: if GitHub cannot be asked, it warns
 * and reports main as green, so an API outage never blocks every pull request.
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The fields of a GitHub Actions workflow run this check reads. */
export interface WorkflowRun {
  conclusion: string | null;
  html_url: string;
  head_sha: string;
}

export interface MainHealth {
  /** Main's CI or a deployment is red: a pull request must prove itself on top of main. */
  red: boolean;
  /** A deployment failed: merging also needs the `cd-fix` label. */
  deployRed: boolean;
  reasons: string[];
}

/** A run that says nothing about main's health: superseded (cancelled) or not run because CI was red (skipped). */
const SILENT = new Set(["cancelled", "skipped", "neutral"]);

/** The newest run that reached a verdict; `runs` is newest first, as GitHub lists them. */
export const latestVerdict = (runs: readonly WorkflowRun[]) =>
  runs.find((run) => run.conclusion !== null && !SILENT.has(run.conclusion));

const describe = (name: string, run: WorkflowRun) =>
  `${name} ${run.conclusion} on ${run.head_sha.slice(0, 8)} (${run.html_url})`;

export function assess(
  ci: readonly WorkflowRun[],
  deploys: Readonly<Record<string, readonly WorkflowRun[]>>,
): MainHealth {
  const reasons: string[] = [];
  const latestCi = latestVerdict(ci);
  const ciRed = latestCi !== undefined && latestCi.conclusion !== "success";
  if (ciRed) reasons.push(describe("CI", latestCi));
  let deployRed = false;
  for (const [name, runs] of Object.entries(deploys)) {
    const latest = latestVerdict(runs);
    if (latest && latest.conclusion !== "success") {
      deployRed = true;
      reasons.push(describe(name, latest));
    }
  }
  return { red: ciRed || deployRed, deployRed, reasons };
}

const WORKFLOWS = {
  CI: "ci.yml",
  "Deploy backend": "backend.yml",
  "Deploy Pages": "pages.yml",
} as const;

async function runsOf(
  repo: string,
  token: string,
  file: string,
  query: string,
): Promise<WorkflowRun[]> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${file}/runs?branch=main&status=completed&per_page=20${query}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok)
    throw new Error(`${file}: GitHub answered ${response.status}`);
  const body = (await response.json()) as { workflow_runs?: unknown };
  if (!Array.isArray(body.workflow_runs))
    throw new Error(`${file}: no workflow_runs in the answer`);
  return body.workflow_runs.filter(
    (run): run is WorkflowRun =>
      typeof run === "object" &&
      run !== null &&
      (typeof run.conclusion === "string" || run.conclusion === null) &&
      typeof run.html_url === "string" &&
      typeof run.head_sha === "string",
  );
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY,
    token = process.env.GH_TOKEN,
    output = process.env.GITHUB_OUTPUT;
  let health: MainHealth = { red: false, deployRed: false, reasons: [] };
  try {
    if (!repo || !token)
      throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
    const [ci, backend, pages] = await Promise.all([
      runsOf(repo, token, WORKFLOWS.CI, "&event=push"),
      runsOf(repo, token, WORKFLOWS["Deploy backend"], ""),
      runsOf(repo, token, WORKFLOWS["Deploy Pages"], ""),
    ]);
    health = assess(ci, { "Deploy backend": backend, "Deploy Pages": pages });
  } catch (error) {
    console.log(
      `::warning::Could not read main's health, so this run treats main as green: ${error instanceof Error ? error.message : error}`,
    );
  }
  const reason = health.reasons.join("; ") || "main is green";
  console.log(health.red ? `Main is red: ${reason}` : reason);
  if (output)
    appendFileSync(
      output,
      `red=${health.red}\ndeploy-red=${health.deployRed}\nreason=${reason.replaceAll("\n", " ")}\n`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
