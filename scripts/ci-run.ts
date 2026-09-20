/**
 * Runs CI steps from scripts/ci-manifest.json. There is no second list of smokes anywhere:
 *
 *   pnpm exec tsx scripts/ci-run.ts --smoke <id>   one smoke exactly as its CI job runs it (ci.yml's `smoke` matrix)
 *   pnpm exec tsx scripts/ci-run.ts                verify steps, then every smoke (scripts/ci-local.sh)
 *   pnpm exec tsx scripts/ci-run.ts --list         the names ONLY accepts
 *
 * ONLY=core,keyboard selects steps; PORT is where the room service's port search starts (default: a free port).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  loadManifest,
  select,
  smokeEnv,
  stepNames,
  type Smoke,
} from "./lib/ci-manifest.js";
import { startRoomService, type LocalServer } from "./lib/server.js";

const { values } = parseArgs({
  options: {
    smoke: { type: "string" },
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

async function main(): Promise<number> {
  if (values.list) {
    console.log([...stepNames(manifest), "core"].join(" "));
    return 0;
  }
  if (values.smoke !== undefined) {
    const smoke = manifest.smokes.find((item) => item.id === values.smoke);
    if (!smoke)
      throw new Error(
        `Unknown smoke '${values.smoke}' (smokes: ${manifest.smokes.map((item) => item.id).join(", ")})`,
      );
    if (smoke.why) console.log(smoke.why);
    return runSmoke(smoke, true);
  }

  const selection = select(manifest, values.only ?? process.env.ONLY ?? "");
  const steps = [
    ...selection.verify.map((step) => ({
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
