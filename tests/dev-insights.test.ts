import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insightsOrigin,
  nodeInsightsCapabilities,
  parseInsightsCommand,
  runInsightsCommand,
  type InsightsCapabilities,
} from "../scripts/dev-insights.js";

const env = {
  FUSE_DEV_API_ORIGIN: "https://insights.example",
  FUSE_DEV_AGENT_TOKEN: "fa1.test.secret",
};
const action = {
  id: "action_1",
  gameId: "fuse-riders",
  status: "claimed",
  lease: { expiresAt: 123456 },
};
class FakeInsights implements InsightsCapabilities {
  saved = new Map<string, string>();
  requests: { url: string; body?: string; headers: Record<string, string> }[] =
    [];
  response = {
    status: 200,
    value: { action, token: "private-lease" } as unknown,
  };
  files = {
    read: async (id: string) => {
      const value = this.saved.get(id);
      if (!value) throw new Error("missing");
      return value;
    },
    save: async (id: string, contents: string) => {
      this.saved.set(id, contents);
    },
    remove: async (id: string) => {
      this.saved.delete(id);
    },
  };
  async request(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) {
    this.requests.push({ url, ...init });
    return this.response;
  }
}
test("CLI parses bounded filters and rejects unknown flags, secrets and unsafe ids", () => {
  assert.deepEqual(
    parseInsightsCommand([
      "list",
      "--gameId",
      "fuse-riders",
      "--since",
      "123",
      "--status",
      "proposed",
    ]),
    {
      operation: "list",
      filters: { gameId: "fuse-riders", since: "123", status: "proposed" },
    },
  );
  for (const args of [
    ["claim", "../secret"],
    ["renew", "id", "--token", "secret"],
    ["list", "--status", "invalid"],
    ["list", "--since", "1.5"],
    ["list", "--since", "9007199254740992"],
    ["list", "--cursor"],
    ["list", "--gameId", "a", "--gameId", "b"],
    ["complete", "id"],
  ])
    assert.throws(() => parseInsightsCommand(args));
});
test("origins reject credentials, insecure remote origins and paths", () => {
  for (const origin of [
    undefined,
    "invalid",
    "http://remote.example",
    "https://user:secret@insights.example",
    "https://insights.example/path",
    "https://insights.example/?token=x",
    "https://insights.example/#x",
  ])
    assert.throws(() => insightsOrigin(origin));
  for (const origin of [
    "https://insights.example/",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "http://[::1]:8787",
  ])
    assert.equal(insightsOrigin(origin), new URL(origin).origin);
});
test("claim stores lease privately; renew uses and replaces it; completion cleans up", async () => {
  const api = new FakeInsights();
  const claimed = await runInsightsCommand(
    parseInsightsCommand(["claim", action.id, "--agent", "test-agent"]),
    env,
    api,
  );
  assert.equal(JSON.stringify(claimed).includes("private-lease"), false);
  assert.equal(
    JSON.stringify(claimed).includes(env.FUSE_DEV_AGENT_TOKEN),
    false,
  );
  assert.deepEqual(JSON.parse(api.requests[0]!.body!), {
    agentName: "test-agent",
  });
  assert.equal(
    JSON.parse(api.saved.get(action.id)!).apiOrigin,
    env.FUSE_DEV_API_ORIGIN,
  );
  api.response.value = { action, token: "renewed-private-lease" };
  await runInsightsCommand(
    parseInsightsCommand(["renew", action.id]),
    env,
    api,
  );
  assert.deepEqual(JSON.parse(api.requests[1]!.body!), {
    token: "private-lease",
  });
  assert.equal(
    JSON.parse(api.saved.get(action.id)!).token,
    "renewed-private-lease",
  );
  api.response.value = { ...action, status: "done", lease: null };
  await runInsightsCommand(
    parseInsightsCommand([
      "complete",
      action.id,
      "--note",
      "Verified focused regression; PR #123",
    ]),
    env,
    api,
  );
  assert.equal(
    JSON.parse(api.requests[2]!.body!).token,
    "renewed-private-lease",
  );
  assert.equal(api.saved.size, 0);
});
test("origin mismatch and missing credentials never send lease secrets", async () => {
  const api = new FakeInsights();
  await runInsightsCommand(
    parseInsightsCommand(["claim", action.id]),
    env,
    api,
  );
  await assert.rejects(
    runInsightsCommand(
      parseInsightsCommand(["renew", action.id]),
      { ...env, FUSE_DEV_API_ORIGIN: "https://other.example" },
      api,
    ),
    /different API origin/,
  );
  await assert.rejects(
    runInsightsCommand(
      parseInsightsCommand(["list"]),
      { ...env, FUSE_DEV_AGENT_TOKEN: undefined },
      api,
    ),
    /FUSE_DEV_AGENT_TOKEN/,
  );
  assert.equal(api.requests.length, 1);
});
test("failed mutations preserve claim and never print arbitrary server error bodies", async () => {
  const api = new FakeInsights();
  await runInsightsCommand(
    parseInsightsCommand(["claim", action.id]),
    env,
    api,
  );
  api.response = {
    status: 409,
    value: { token: "private-lease", message: env.FUSE_DEV_AGENT_TOKEN },
  };
  await assert.rejects(
    runInsightsCommand(parseInsightsCommand(["release", action.id]), env, api),
    /^Error: Developer API returned HTTP 409; claim state preserved$/,
  );
  assert.equal(api.saved.size, 1);
  api.response = {
    status: 200,
    value: { ...action, status: "proposed" },
  };
  await runInsightsCommand(
    parseInsightsCommand(["release", action.id]),
    env,
    api,
  );
  assert.equal(api.saved.size, 0);
});
test("listing retains continuation even for an empty bounded scan and excludes envelope secrets", async () => {
  const api = new FakeInsights();
  api.response.value = {
    actions: [],
    nextCursor: "opaque+cursor",
    scannedRecordings: 20,
    token: "private-lease",
  };
  const result = await runInsightsCommand(
    parseInsightsCommand([
      "list",
      "--cursor",
      "opaque+cursor",
      "--recordingId",
      "recording_1",
    ]),
    env,
    api,
  );
  assert.deepEqual(result, {
    actions: [],
    nextCursor: "opaque+cursor",
    scannedRecordings: 20,
  });
  assert.equal(
    new URL(api.requests[0]!.url).searchParams.get("cursor"),
    "opaque+cursor",
  );
});
test("production file adapter writes mode600 and replaces atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fuse-claims-test-"));
  try {
    const files = nodeInsightsCapabilities(directory).files;
    await files.save("action_1", "first");
    await files.save("action_1", "second");
    assert.equal(
      (await stat(join(directory, "action_1.json"))).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal(
      await readFile(join(directory, "action_1.json"), "utf8"),
      "second",
    );
    assert.equal(await files.read("action_1"), "second");
    await files.remove("action_1");
    await assert.rejects(files.read("action_1"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
