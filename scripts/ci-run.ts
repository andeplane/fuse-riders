/**
 * Runs CI steps from scripts/ci-manifest.json. There is no second list of smokes anywhere:
 *
 *   pnpm exec tsx scripts/ci-run.ts --smoke <id>   one smoke exactly as its CI job runs it (ci.yml's `smoke` matrix)
 *   pnpm exec tsx scripts/ci-run.ts --job <job>    one gate job's verify steps side by side, as ci.yml runs `checks`
 *   pnpm exec tsx scripts/ci-run.ts                everything a main push runs: verify, release, then every smoke
 *   pnpm exec tsx scripts/ci-run.ts --list         the names ONLY accepts
 *
 * ONLY=core selects the pull-request gate alone, ONLY=core,keyboard adds a smoke, ONLY=release the coverage
 * gate; PORT is where the room service's port search starts (default: a free port).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  jobSteps,
  loadManifest,
  select,
  smokeEnv,
  smokeJobs,
  stepNames,
  verifyJobs,
  type Smoke,
} from "./lib/ci-manifest.js";
import { startRoomService, type LocalServer } from "./lib/server.js";

const { values } = parseArgs({
  options: {
    smoke: { type: "string" },
    job: { type: "string" },
    only: { type: "string" },
    list: { type: "boolean" },
  },
});
// Commands, scripts/ci-smoke.sh and artifacts/ are all relative to the repository root.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const manifest = loadManifest();

/** The step that is running now, so a signal to this process reaches it. */
let current: ChildProcess | undefined;
function run(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const [file, ...args] = command;
    // Its own process group: scripts/ci-smoke.sh, npx, tsx and the browsers are a tree, and a signal has to
    // reach all of it. A detached child gets no Ctrl-C from the terminal, so the handler below forwards it.
    const child = spawn(file!, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env,
      detached: true,
    });
    current = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (current === child) current = undefined;
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}
/** Signal the running step's whole group, wait for it, and kill it if it will not go. */
async function stopStep(signal: NodeJS.Signals): Promise<void> {
  const child = current;
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const group = -child.pid;
  const send = (name: NodeJS.Signals) => {
    try {
      process.kill(group, name);
    } catch {
      /* already gone */
    }
  };
  const gone = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  send(signal);
  const timer = setTimeout(() => send("SIGKILL"), 5000);
  await gone;
  clearTimeout(timer);
}

let service: LocalServer | undefined;
async function serviceUrl(): Promise<string> {
  if (!service) {
    const port = process.env.PORT ? Number(process.env.PORT) : undefined;
    if (port !== undefined && !(Number.isInteger(port) && port > 0))
      throw new Error(`PORT must be a port number, not '${process.env.PORT}'`);
    service = await startRoomService({ port });
    console.log(
      `=== room service on ${service.url} (log: artifacts/room-service.log)`,
    );
  }
  return service.url;
}
async function stopService(): Promise<void> {
  const running = service;
  service = undefined;
  await running?.stop();
}
// The smoke first, then the service it talks to: neither may outlive the runner.
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void stopStep(signal)
      .then(stopService)
      .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });

/** `retry`: through scripts/ci-smoke.sh, which reruns a failure once and reports the flake to GitHub. */
async function runSmoke(smoke: Smoke, retry: boolean): Promise<number> {
  const env = smokeEnv(
    manifest,
    smoke,
    smoke.serviceUrlEnv ? await serviceUrl() : undefined,
  );
  const command = smoke.command.split(" ");
  return run(
    retry && smoke.retries > 0
      ? ["scripts/ci-smoke.sh", smoke.name, ...command]
      : command,
    env,
  );
}

/**
 * One ci.yml gate job: its manifest steps side by side rather than in series (format, lint, the type check and
 * the bundle are each mostly one core, and a runner has four). Each step's output is held and printed whole when
 * it ends, so the log reads as if they ran one after another; every step runs to the end and any failure fails
 * the job.
 */
async function runJob(name: string): Promise<number> {
  const steps = jobSteps(manifest, name);
  if (steps.length === 0)
    throw new Error(
      `No verify steps for job '${name}' (jobs: ${verifyJobs(manifest).join(", ")})`,
    );
  const started = Date.now();
  const results = await Promise.all(
    steps.map(
      (step) =>
        new Promise<number>((resolve) => {
          const [file, ...args] = step.command.split(" ");
          const output: Buffer[] = [];
          const child = spawn(file!, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
          });
          child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
          child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
          const finish = (code: number) => {
            const seconds = Math.round((Date.now() - started) / 1000);
            const verdict = code === 0 ? "PASS" : "FAIL";
            console.log(
              `::group::${verdict} ${step.id}: ${step.command} (${seconds}s)`,
            );
            process.stdout.write(Buffer.concat(output));
            console.log("::endgroup::");
            if (code !== 0)
              console.log(`::error::${step.id} failed: ${step.command}`);
            resolve(code);
          };
          child.once("error", (error) => {
            output.push(Buffer.from(`${error.message}\n`));
            finish(1);
          });
          child.once("close", (code, signal) =>
            finish(code ?? (signal ? 1 : 0)),
          );
        }),
    ),
  );
  const failed = steps.filter((_, index) => results[index] !== 0);
  console.log(
    `=== ${name}: ${steps.length - failed.length}/${steps.length} passed in ${Math.round((Date.now() - started) / 1000)}s${failed.length ? ` (failed: ${failed.map((step) => step.id).join(", ")})` : ""}`,
  );
  return failed.length ? 1 : 0;
}

/**
 * A batch: every smoke in turn, each with its own retry (scripts/ci-smoke.sh), its own log group and, when it
 * fails, an error annotation naming it, so a red batch says which smoke broke. A failure does not stop the rest.
 */
async function runBatch(smokes: Smoke[]): Promise<number> {
  const failed: Smoke[] = [];
  for (const smoke of smokes) {
    const begin = Date.now();
    console.log(`::group::${smoke.name} (${smoke.id})`);
    if (smoke.why) console.log(smoke.why);
    const code = await runSmoke(smoke, true);
    console.log("::endgroup::");
    const seconds = Math.round((Date.now() - begin) / 1000);
    console.log(`${code === 0 ? "PASS" : "FAIL"} ${smoke.id} (${seconds}s)`);
    if (code !== 0) {
      failed.push(smoke);
      console.log(
        `::error title=${smoke.name}::smoke ${smoke.id} failed (exit ${code}); its output is in the group above`,
      );
    }
  }
  console.log(
    `=== batch: ${smokes.length - failed.length}/${smokes.length} passed${failed.length ? ` (failed: ${failed.map((smoke) => smoke.id).join(", ")})` : ""}`,
  );
  return failed.length ? 1 : 0;
}

async function main(): Promise<number> {
  if (values.list) {
    console.log([...stepNames(manifest), "core", "release"].join(" "));
    return 0;
  }
  if (values.job !== undefined) return runJob(values.job);
  if (values.smoke !== undefined) {
    const job = smokeJobs(manifest).find((item) => item.id === values.smoke);
    if (!job)
      throw new Error(
        `Unknown smoke or batch '${values.smoke}' (${smokeJobs(manifest)
          .map((item) => item.id)
          .join(", ")})`,
      );
    if (job.smokes.length === 1 && job.smokes[0]!.id === job.id) {
      const smoke = job.smokes[0]!;
      if (smoke.why) console.log(smoke.why);
      return runSmoke(smoke, true);
    }
    return runBatch(job.smokes);
  }

  const selection = select(manifest, values.only ?? process.env.ONLY ?? "");
  const steps = [
    ...[...selection.verify, ...selection.release].map((step) => ({
      label: step.id,
      text: step.command,
      start: () => run(step.command.split(" "), process.env),
    })),
    ...selection.smokes.map((smoke) => ({
      label: smoke.id,
      text: `${smoke.name}: ${smoke.command}`,
      start: () => runSmoke(smoke, false),
    })),
  ];
  if (steps.length === 0) throw new Error("No steps ran");
  const started = Date.now();
  const seconds = (since: number) => Math.round((Date.now() - since) / 1000);
  let code = 0;
  for (const step of steps) {
    const begin = Date.now();
    console.log(`=== ${step.label}: ${step.text}`);
    code = await step.start();
    console.log(
      `${code === 0 ? "PASS" : "FAIL"} ${step.label} (${seconds(begin)}s)`,
    );
    if (code !== 0) break;
  }
  await stopService();
  console.log(`=== total ${seconds(started)}s, exit ${code}`);
  return code;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
} finally {
  await stopService();
}
process.exit(exitCode);
