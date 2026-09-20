import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BrowserKind } from "./browser.js";

/** A step of the pull-request gate (`core` locally; the `job` below in ci.yml). */
export interface VerifyStep {
  /** The name `ONLY=` selects locally. */
  id: string;
  /** Exactly the `run:` line of the matching step in ci.yml. */
  command: string;
  /**
   * The ci.yml job that runs it. The gate is split so its steps run side by side rather than in series, and
   * `verify` is the aggregate job that turns them back into one check name. Absent on a `release` step, which
   * has a job of its own.
   */
  job?: string;
}

/** One browser smoke: one job of ci.yml's `smoke` matrix and one step of scripts/ci-local.sh. */
export interface Smoke {
  /** Unique; the matrix key, the artifact suffix and an `ONLY=` name. */
  id: string;
  /** The `ONLY=` name shared by the variants of one script (`online` selects both engines). */
  group: string;
  /** The job and step name in the GitHub UI, and the label on flaky-test reports. */
  name: string;
  /** Why this smoke exists or is shaped the way it is; a comment that survives JSON. */
  why?: string;
  /** No shell: split on spaces and executed directly. */
  command: string;
  /** Every `pnpm exec playwright install` target the command launches with this `env`. */
  browsers: BrowserKind[];
  env: Record<string, string>;
  /** Set when the smoke needs the local room service: the variable that receives its URL. */
  serviceUrlEnv?: "HOME_URL" | "ONLINE_URL";
  /** The CI job's `timeout-minutes`: setup plus the smoke, twice when it retries. */
  timeoutMinutes: number;
  /** 1: through scripts/ci-smoke.sh in CI, which retries once and reports the flake. 0: a single attempt. */
  retries: 0 | 1;
}

export interface CiManifest {
  about: string;
  verify: VerifyStep[];
  /**
   * Steps a pull request does not wait on: the coverage gate, which instruments every module and costs about
   * 60% on top of the same tests. A main push runs it before anything deploys, and so does the release suite.
   */
  release: VerifyStep[];
  smokes: Smoke[];
}

/** The ci.yml jobs the `verify` steps are split across, in manifest order. */
export function verifyJobs(manifest: CiManifest): string[] {
  return [...new Set(manifest.verify.map((step) => step.job!))];
}

/** The steps one ci.yml job runs, in the order that job runs them. */
export function jobSteps(manifest: CiManifest, job: string): VerifyStep[] {
  return manifest.verify.filter((step) => step.job === job);
}

export const MANIFEST_PATH = fileURLToPath(
  new URL("../ci-manifest.json", import.meta.url),
);
const BROWSERS: readonly string[] = ["chrome", "chromium", "webkit"];
const NAME = /^[a-z][a-z0-9-]*$/;
/** Nothing a shell would interpret: the runner splits on spaces and ci.yml interpolates `name` into a step. */
const PLAIN_COMMAND = /^[A-Za-z0-9_@:./=-]+( [A-Za-z0-9_@:./=-]+)*$/;
const PLAIN_NAME = /^[A-Za-z0-9 ,()-]+$/;

function fail(message: string): never {
  throw new Error(`scripts/ci-manifest.json: ${message}`);
}

/** TypeScript types are not runtime validation: reject a manifest the runner or the workflow would misread. */
export function parseManifest(value: unknown): CiManifest {
  const manifest = value as CiManifest;
  if (!manifest || typeof manifest !== "object") fail("not an object");
  if (
    !Array.isArray(manifest.verify) ||
    !Array.isArray(manifest.release) ||
    !Array.isArray(manifest.smokes)
  )
    fail("verify, release and smokes must be arrays");
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (typeof id !== "string" || !NAME.test(id)) fail(`bad id ${id}`);
    if (id === "core" || id === "release" || ids.has(id))
      fail(`duplicate or reserved id ${id}`);
    ids.add(id);
  };
  for (const step of [...manifest.verify, ...manifest.release]) {
    claim(step.id);
    if (typeof step.command !== "string" || !PLAIN_COMMAND.test(step.command))
      fail(`${step.id}: command must be plain words`);
  }
  // A verify step names the ci.yml job that runs it; a release step is the whole of its own job.
  for (const step of manifest.verify)
    if (typeof step.job !== "string" || !NAME.test(step.job))
      fail(`${step.id}: job must name a ci.yml job`);
  for (const step of manifest.release)
    if (step.job !== undefined) fail(`${step.id}: a release step has no job`);
  for (const smoke of manifest.smokes) {
    claim(smoke.id);
    const bad = (what: string) => fail(`${smoke.id}: ${what}`);
    if (typeof smoke.group !== "string" || !NAME.test(smoke.group))
      bad("bad group");
    if (typeof smoke.name !== "string" || !PLAIN_NAME.test(smoke.name))
      bad("name must be plain text");
    if (typeof smoke.command !== "string" || !PLAIN_COMMAND.test(smoke.command))
      bad("command must be plain words");
    if (
      !Array.isArray(smoke.browsers) ||
      smoke.browsers.length === 0 ||
      smoke.browsers.some((browser) => !BROWSERS.includes(browser))
    )
      bad("browsers must name chrome, chromium or webkit");
    if (
      !smoke.env ||
      typeof smoke.env !== "object" ||
      Object.values(smoke.env).some((item) => typeof item !== "string")
    )
      bad("env values must be strings");
    if (
      smoke.serviceUrlEnv !== undefined &&
      smoke.serviceUrlEnv !== "HOME_URL" &&
      smoke.serviceUrlEnv !== "ONLINE_URL"
    )
      bad("serviceUrlEnv must be HOME_URL or ONLINE_URL");
    if (
      !Number.isInteger(smoke.timeoutMinutes) ||
      smoke.timeoutMinutes < 1 ||
      smoke.timeoutMinutes > 40
    )
      bad("timeoutMinutes must be 1-40");
    if (smoke.retries !== 0 && smoke.retries !== 1)
      bad("retries must be 0 or 1");
  }
  // A group that is also another smoke's id would make ONLY= ambiguous.
  for (const smoke of manifest.smokes)
    if (smoke.group !== smoke.id && ids.has(smoke.group))
      fail(`${smoke.id}: group ${smoke.group} is another step's id`);
  return manifest;
}

export function loadManifest(path = MANIFEST_PATH): CiManifest {
  return parseManifest(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Every name `ONLY=` accepts, in run order: verify ids, release ids, then smoke groups. `core` is all of
 * verify (the pull-request gate) and `release` is all of release.
 */
export function stepNames(manifest: CiManifest): string[] {
  return [
    ...manifest.verify.map((step) => step.id),
    ...manifest.release.map((step) => step.id),
    ...new Set(manifest.smokes.map((smoke) => smoke.group)),
  ];
}

export interface Selection {
  verify: VerifyStep[];
  release: VerifyStep[];
  smokes: Smoke[];
}

/**
 * `only` is a comma-separated list of step ids, smoke groups, `core` or `release`; empty selects everything,
 * which is what a main push runs.
 */
export function select(manifest: CiManifest, only: string): Selection {
  const wanted = only
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (wanted.length === 0)
    return {
      verify: manifest.verify,
      release: manifest.release,
      smokes: manifest.smokes,
    };
  const known = new Set([
    "core",
    "release",
    ...stepNames(manifest),
    ...manifest.smokes.map((smoke) => smoke.id),
  ]);
  for (const item of wanted)
    if (!known.has(item))
      throw new Error(
        `Unknown step '${item}' (steps: ${stepNames(manifest).join(", ")}, core, release)`,
      );
  const has = (...names: string[]) =>
    names.some((name) => wanted.includes(name));
  return {
    verify: manifest.verify.filter((step) => has("core", step.id)),
    release: manifest.release.filter((step) => has("release", step.id)),
    smokes: manifest.smokes.filter((smoke) => has(smoke.group, smoke.id)),
  };
}

/**
 * The environment one smoke runs in. Every variable any smoke sets is first removed from the caller's shell,
 * so a stray `BROWSER=webkit` cannot turn the Chrome variant into a second WebKit run.
 */
export function smokeEnv(
  manifest: CiManifest,
  smoke: Smoke,
  serviceUrl: string | undefined,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (smoke.serviceUrlEnv && !serviceUrl)
    throw new Error(`${smoke.id} needs the room service`);
  const env = { ...base };
  for (const other of manifest.smokes) {
    for (const key of Object.keys(other.env)) delete env[key];
    if (other.serviceUrlEnv) delete env[other.serviceUrlEnv];
  }
  return {
    ...env,
    ...smoke.env,
    ...(smoke.serviceUrlEnv ? { [smoke.serviceUrlEnv]: serviceUrl } : {}),
  };
}
