import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { GoogleAuth } from "google-auth-library";
import { FIREBASE_WEB_CONFIG } from "../src/shared/firebase-config.js";
import {
  applyConfiguration,
  desiredConfiguration,
  digest,
  object,
  keyOperationUrl,
  planConfiguration,
  type Cloud,
} from "./configuration/model.js";

const { values } = parseArgs({
  options: {
    check: { type: "boolean" },
    plan: { type: "boolean" },
    apply: { type: "boolean" },
    account: { type: "string" },
    revision: { type: "string" },
  },
  allowPositionals: false,
});
if ([values.check, values.plan, values.apply].filter(Boolean).length > 1)
  throw new Error("Choose exactly one of --check, --plan or --apply");
const mode = values.apply ? "apply" : values.plan ? "plan" : "check";
const { account, revision } = values;
const run = (command: string, args: string[]) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function main() {
  const sources = await Promise.all(
    [
      "deploy/firebase-config.json",
      "firebase.json",
      "firestore.indexes.json",
      "firestore.rules",
    ].map((p) => readFile(p, "utf8")),
  );
  const desired = desiredConfiguration(
    JSON.parse(sources[0]!),
    JSON.parse(sources[1]!),
    JSON.parse(sources[2]!),
    sources[3]!,
  );
  if (
    FIREBASE_WEB_CONFIG.authDomain !== desired.config.authDomain ||
    FIREBASE_WEB_CONFIG.appId !== desired.config.webAppId ||
    FIREBASE_WEB_CONFIG.projectId !== desired.config.projectId
  )
    throw new Error(
      "Frontend Firebase settings differ from deployment configuration",
    );
  if (mode === "check") {
    console.log(
      "Firebase deployment configuration is valid (no cloud access).",
    );
    return;
  }
  if (mode === "apply") {
    if (
      !revision ||
      !/^[a-f0-9]{40}$/.test(revision) ||
      run("git", ["rev-parse", "HEAD"]) !== revision ||
      run("git", ["status", "--porcelain", "--untracked-files=no"])
    )
      throw new Error(
        "Apply requires --revision at the clean, committed checkout being deployed",
      );
    if (account)
      throw new Error(
        "Apply uses workload identity or ADC, not a personal gcloud account",
      );
  }
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = account ? undefined : await auth.getClient();
  let localToken: string | undefined;
  const request = async (
    method: "GET" | "PATCH",
    url: string,
    data?: unknown,
  ): Promise<unknown> => {
    // Never print Google's response/error objects: even configuration endpoints can contain credential material.
    try {
      if (account) {
        localToken ??= run("gcloud", [
          "auth",
          "print-access-token",
          `--account=${account}`,
        ]);
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${localToken}`,
            ...(new URL(url).hostname !== "apikeys.googleapis.com"
              ? { "x-goog-user-project": desired.config.projectId }
              : {}),
            ...(data ? { "Content-Type": "application/json" } : {}),
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw Object.assign(new Error("Cloud request failed"), {
            response: { status: response.status },
          });
        return await response.json();
      }
      return (
        await client!.request({
          method,
          url,
          data,
          timeout: 30_000,
          ...(new URL(url).hostname !== "apikeys.googleapis.com"
            ? { headers: { "x-goog-user-project": desired.config.projectId } }
            : {}),
        })
      ).data;
    } catch (error) {
      const status = (error as { response?: { status?: unknown } })?.response
        ?.status;
      throw new Error(
        `${method} ${new URL(url).hostname}${new URL(url).pathname} failed${typeof status === "number" ? ` (HTTP ${status})` : ""}; check deployment IAM and resource IDs`,
      );
    }
  };
  const cloud: Cloud = {
    get: (url) => request("GET", url),
    async patch(url, body) {
      const response = object(await request("PATCH", url, body));
      if (
        new URL(url).hostname === "apikeys.googleapis.com" &&
        typeof response.name === "string"
      ) {
        const operationUrl = keyOperationUrl(response.name);
        for (let i = 0; i < 60; i++) {
          const operation = object(await request("GET", operationUrl));
          if (operation.error)
            throw new Error("API key restriction update failed");
          if (operation.done === true) return;
          await cloud.wait();
        }
        throw new Error("API key update did not finish before deadline");
      }
    },
    async checkRedirect(clientId, authDomain) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        response_type: "code",
        scope: "openid",
        client_id: clientId,
        redirect_uri: `https://${authDomain}/__/auth/handler`,
      }).toString();
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const destination = response.headers.get("location");
      if (
        response.status !== 302 ||
        !destination ||
        !/^https:\/\/accounts\.google\.com\/.+signin/.test(destination) ||
        destination.includes("/oauth/error")
      )
        throw new Error(
          `OAuth redirect is not accepted. A team member must register https://${authDomain}/__/auth/handler on the existing Google OAuth client before deployment`,
        );
    },
    async deployFirestore() {
      console.log(
        "Deploying rules, indexes and field policies to fuse-riders only…",
      );
      await new Promise<void>((done, fail) => {
        const process = spawn(
          resolve("tools/firebase/node_modules/.bin/firebase"),
          [
            "deploy",
            "--project",
            desired.config.projectId,
            "--only",
            `firestore:${desired.config.databaseId}`,
            "--non-interactive",
          ],
          { stdio: "inherit", env: { ...globalThis.process.env, CI: "true" } },
        );
        process.on("error", () =>
          fail(
            new Error(
              "Install the pinned Firebase CLI with npm ci --prefix tools/firebase",
            ),
          ),
        );
        process.on("exit", (code) =>
          code === 0
            ? done()
            : fail(
                new Error(
                  "Firestore deploy failed; inspect the CLI's configuration/IAM diagnostic. Unlisted index deletion is not forced",
                ),
              ),
        );
      });
    },
    wait: () => new Promise((done) => setTimeout(done, 5_000)),
  };
  const plan = await planConfiguration(desired, cloud);
  const configDigest = digest(sources.join("\n"));
  const evidence = {
    revision: revision ?? run("git", ["rev-parse", "HEAD"]),
    configDigest,
    project: desired.config.projectId,
    database: desired.config.databaseId,
    recordedAt: new Date().toISOString(),
    mode,
    plan,
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (mode === "plan") return;
  // A late CI run may deploy older compatible code, but must not revert newer configuration.
  if (plan.firestore.length || plan.auth || plan.google || plan.key) {
    const latest = run("gh", [
      "api",
      "repos/andeplane/fuse-riders/commits/main",
      "--jq",
      ".sha",
    ]);
    if (latest !== revision)
      throw new Error(
        "This revision is behind main and would change configuration; let the newer revision deploy it",
      );
  }
  await applyConfiguration(desired, cloud, plan);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    `artifacts/config-release-${revision}.json`,
    JSON.stringify(
      { ...evidence, verified: true, verifiedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Configuration verified: required indexes and TTLs are ready; gateway deployment may proceed.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Configuration deployment failed",
  );
  process.exitCode = 1;
});
