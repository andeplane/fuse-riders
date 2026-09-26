import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Explicit smoke only: the wall-clock child startup deadline is load-sensitive
// under the parallel coverage suite. Track restoring CI coverage in issue #250.

test("actual service exposes Cloud Run safe health aliases without requiring provider operations", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "service/index.ts"],
    {
      env: {
        ...process.env,
        PORT: "0",
        GOOGLE_CLOUD_PROJECT: "fuse-health-local",
        GCP_REGION: "europe-west1",
        PUBSUB_TOPIC: "fuse-local-health",
        ROOM_COLLECTION_PREFIX: "fuse-local-health",
        ALLOWED_ORIGINS: "https://andeplane.github.io",
        BUILD_REVISION: "0123456789abcdef0123456789abcdef01234567",
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let buffer = "";
      const timeout = setTimeout(
        () => reject(new Error("Local gateway startup timed out")),
        20_000,
      );
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Local gateway exited before startup (code ${code}, signal ${signal})`,
          ),
        );
      });
      child.stdout.on("data", (data) => {
        buffer += String(data);
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          try {
            const record = JSON.parse(line) as {
              port?: number;
              service?: string;
            };
            if (record.service === "fuse-riders-gateway" && record.port) {
              clearTimeout(timeout);
              resolve(record.port);
            }
          } catch {
            // The service also prints lines that are not JSON; the timeout fails the test if no record arrives.
          }
        }
      });
    });
    for (const path of ["/api/health", "/api/ready", "/healthz", "/readyz"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { Origin: "https://andeplane.github.io" },
        signal: AbortSignal.timeout(1000),
      });
      assert.equal(response.status, 200, path);
      const body = (await response.json()) as {
        ok: boolean;
        state?: string;
        revision?: string;
      };
      assert.equal(body.ok, true);
      // The Pages release reads this to publish only the revision the backend is serving.
      if (path === "/api/health" || path === "/healthz")
        assert.equal(body.revision, "0123456789abcdef0123456789abcdef01234567");
      if (path.endsWith("ready") || path === "/readyz")
        assert.equal(body.state, "idle");
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
});
