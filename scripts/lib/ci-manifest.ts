import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BrowserKind } from "./browser.js";

/** A step of the pull-request gate (`verify` in ci.yml, `core` locally). */
export interface VerifyStep {
  /** The name `ONLY=` selects locally. */
  id: string;
  /** Exactly the `run:` line of the matching step in ci.yml's `verify` job. */
  command: string;
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
  /** Every `npx playwright install` target the command launches with this `env`. */
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
  smokes: Smoke[];
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
  if (!Array.isArray(manifest.verify) || !Array.isArray(manifest.smokes))
    fail("verify and smokes must be arrays");
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (typeof id !== "string" || !NAME.test(id)) fail(`bad id ${id}`);
    if (id === "core" || ids.has(id)) fail(`duplicate or reserved id ${id}`);
    ids.add(id);
  };
  for (const step of manifest.verify) {
    claim(step.id);
    if (typeof step.command !== "string" || !PLAIN_COMMAND.test(step.command))
      fail(`${step.id}: command must be plain words`);
  }
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

/** Every name `ONLY=` accepts, in run order: verify ids, then smoke groups. `core` is all of verify. */
export function stepNames(manifest: CiManifest): string[] {
  return [
    ...manifest.verify.map((step) => step.id),
    ...new Set(manifest.smokes.map((smoke) => smoke.group)),
  ];
}

export interface Selection {
  verify: VerifyStep[];
  smokes: Smoke[];
}

/** `only` is a comma-separated list of verify ids, smoke groups, smoke ids or `core`; empty selects everything. */
export function select(manifest: CiManifest, only: string): Selection {
  const wanted = only
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (wanted.length === 0)
    return { verify: manifest.verify, smokes: manifest.smokes };
  const known = new Set([
    "core",
    ...stepNames(manifest),
    ...manifest.smokes.map((smoke) => smoke.id),
  ]);
  for (const item of wanted)
    if (!known.has(item))
      throw new Error(
        `Unknown step '${item}' (steps: ${stepNames(manifest).join(", ")}, core)`,
      );
  const has = (...names: string[]) =>
    names.some((name) => wanted.includes(name));
  return {
    verify: manifest.verify.filter((step) => has("core", step.id)),
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
