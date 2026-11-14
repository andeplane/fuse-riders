import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OPENAI = "fuse-openai-api-key";
const HMAC = "fuse-telemetry-rate-limit-key";
const DUMMY_KEY = "dummy-test-only-repository-key";
const RANDOM = "ab".repeat(32);
interface Version {
  name: string;
  state: string;
}
interface Scenario {
  secrets: Record<string, Version[]>;
  deny?: string;
  randomFailure?: boolean;
  randomInvalid?: boolean;
}
interface Call {
  args: string[];
  bytes: number;
  digest: string;
}
const version = (name: string, number: number, state = "ENABLED"): Version => ({
  name: `projects/andershaf-87/secrets/${name}/versions/${number}`,
  state,
});

// Both external capabilities are test executables, so no real cloud or randomness is used.
function harness(scenario: Scenario) {
  const directory = mkdtempSync(join(tmpdir(), "insights-secrets-test-"));
  const state = join(directory, "state.json");
  const calls = join(directory, "calls.jsonl");
  writeFileSync(state, JSON.stringify(scenario));
  writeFileSync(calls, "");
  writeFileSync(
    join(directory, "gcloud"),
    `#!/usr/bin/env node
const fs=require('node:fs'), crypto=require('node:crypto');
const args=process.argv.slice(2), state=JSON.parse(fs.readFileSync(process.env.FAKE_STATE,'utf8'));
const input=fs.readFileSync(0);
fs.appendFileSync(process.env.FAKE_CALLS,JSON.stringify({args,bytes:input.length,digest:crypto.createHash('sha256').update(input).digest('hex')})+'\\n');
if(state.deny && args.join(' ').includes(state.deny)){ console.error(process.env.OPENAI_API_KEY); process.exit(1); }
const option=prefix=>args.find(a=>a.startsWith(prefix))?.slice(prefix.length);
let name, result='';
if(args[1]==='list'){
  name=option('--filter=').split('/secrets/')[1].split('$')[0];
  if(state.secrets[name]) result='projects/andershaf-87/secrets/'+name;
} else if(args[1]==='create'){
  name=args[2]; if(state.secrets[name]) process.exit(1); state.secrets[name]=[];
} else if(args[1]==='add-iam-policy-binding'){
  if(!state.secrets[args[2]]) process.exit(1);
} else if(args[1]==='versions' && args[2]==='list'){
  name=args[3]; if(!state.secrets[name]) process.exit(1); result=JSON.stringify(state.secrets[name]);
} else if(args[1]==='versions' && args[2]==='describe'){
  name=option('--secret='); result=state.secrets[name]?.find(v=>v.name.endsWith('/'+args[3]))?.state;
  if(!result) process.exit(1);
} else if(args[1]==='versions' && args[2]==='add'){
  name=args[3]; if(!state.secrets[name]||!args.includes('--data-file=-')) process.exit(1);
  result='projects/andershaf-87/secrets/'+name+'/versions/'+(state.secrets[name].length+1);
  state.secrets[name].push({name:result,state:'ENABLED'});
} else process.exit(2);
fs.writeFileSync(process.env.FAKE_STATE,JSON.stringify(state)); process.stdout.write(result+'\\n');
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(directory, "openssl"),
    `#!/usr/bin/env node
const fs=require('node:fs'), state=JSON.parse(fs.readFileSync(process.env.FAKE_STATE,'utf8'));
if(process.argv.slice(2).join(' ')!=='rand -hex 32'||state.randomFailure) process.exit(1);
process.stdout.write(state.randomInvalid?'bad':${JSON.stringify(RANDOM)});
`,
    { mode: 0o700 },
  );
  const run = (env: Record<string, string> = {}) =>
    spawnSync("bash", [resolve("scripts/insights-secret-refs.sh")], {
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        TELEMETRY_ENABLED: "1",
        RUNTIME_SERVICE_ACCOUNT:
          "fuse-riders-runtime@andershaf-87.iam.gserviceaccount.com",
        FAKE_STATE: state,
        FAKE_CALLS: calls,
        ...env,
      },
      encoding: "utf8",
    });
  return {
    run,
    calls: (): Call[] =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("initial bootstrap copies repository key through stdin, generates HMAC and reuses pinned versions", () => {
  const fake = harness({ secrets: {} });
  try {
    const first = fake.run({ OPENAI_API_KEY: DUMMY_KEY });
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      OPENAI_API_KEY_SECRET: `${OPENAI}:1`,
      TELEMETRY_RATE_LIMIT_KEY_SECRET: `${HMAC}:1`,
    });
    const calls = fake.calls();
    const adds = calls.filter((call) => call.args[2] === "add");
    assert.equal(adds.length, 2);
    assert.deepEqual(
      adds.map((call) => [call.bytes, call.digest]),
      [DUMMY_KEY, RANDOM].map((key) => [
        Buffer.byteLength(key),
        createHash("sha256").update(key).digest("hex"),
      ]),
    );
    assert.equal(calls.filter((call) => call.args[1] === "create").length, 2);
    assert.equal(
      calls.filter((call) => call.args[1] === "add-iam-policy-binding").length,
      2,
    );
    assert.ok(!JSON.stringify(calls).includes(DUMMY_KEY));
    assert.ok(!(first.stdout + first.stderr).includes(DUMMY_KEY));
    assert.ok(!(first.stdout + first.stderr).includes(RANDOM));
    assert.ok(
      calls.every((call) => call.args.includes("--project=andershaf-87")),
    );
    const second = fake.run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.equal(
      fake.calls().filter((call) => call.args[2] === "add").length,
      2,
    );
  } finally {
    fake.close();
  }
});

test("existing defaults select highest enabled numeric version without rotating repository credentials", () => {
  const fake = harness({
    secrets: {
      [OPENAI]: [
        version(OPENAI, 9),
        version(OPENAI, 10),
        version(OPENAI, 11, "DISABLED"),
      ],
      [HMAC]: [version(HMAC, 3)],
    },
  });
  try {
    const result = fake.run({ OPENAI_API_KEY: "different-test-key" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      JSON.parse(result.stdout).OPENAI_API_KEY_SECRET,
      `${OPENAI}:10`,
    );
    assert.ok(!fake.calls().some((call) => call.args[2] === "add"));
  } finally {
    fake.close();
  }
});

test("explicit numeric references validate enabled state without provisioning or IAM changes", () => {
  const fake = harness({
    secrets: {
      custom: [version("custom", 7)],
      limiter: [version("limiter", 2)],
    },
  });
  try {
    const result = fake.run({
      OPENAI_API_KEY_SECRET: "custom:7",
      TELEMETRY_RATE_LIMIT_KEY_SECRET: "limiter:2",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      OPENAI_API_KEY_SECRET: "custom:7",
      TELEMETRY_RATE_LIMIT_KEY_SECRET: "limiter:2",
    });
    assert.ok(fake.calls().every((call) => call.args[2] === "describe"));
  } finally {
    fake.close();
  }
});

test("invalid configuration and mutable references fail before cloud mutation", () => {
  const fake = harness({ secrets: {} });
  try {
    for (const env of [
      { TELEMETRY_ENABLED: "0" },
      { INSIGHTS_SECRET_PROJECT_ID: "invalid;project" },
      { RUNTIME_SERVICE_ACCOUNT: "other@external.example" },
      { OPENAI_API_KEY_SECRET: "custom:latest" },
      { TELEMETRY_RATE_LIMIT_KEY_SECRET: "limiter:latest" },
    ]) {
      const result = fake.run(env);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
    }
    assert.equal(fake.calls().length, 0);
  } finally {
    fake.close();
  }
});

test("disabled pins, discovery failures, missing key and failed IAM are fail-closed and redact provider errors", () => {
  const cases: { scenario: Scenario; env?: Record<string, string> }[] = [
    {
      scenario: { secrets: { custom: [version("custom", 1, "DISABLED")] } },
      env: { OPENAI_API_KEY_SECRET: "custom:1" },
    },
    { scenario: { secrets: {}, deny: "secrets list" } },
    { scenario: { secrets: {} } },
    { scenario: { secrets: { [OPENAI]: [version(OPENAI, 1, "DISABLED")] } } },
    {
      scenario: {
        secrets: { [OPENAI]: [version(OPENAI, 1)] },
        deny: "add-iam-policy-binding",
      },
    },
  ];
  for (const { scenario, env } of cases) {
    const fake = harness(scenario);
    try {
      const result = fake.run({
        ...(scenario.secrets[OPENAI] || scenario.deny
          ? { OPENAI_API_KEY: DUMMY_KEY }
          : {}),
        ...env,
      });
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes(DUMMY_KEY));
      assert.ok(!fake.calls().some((call) => call.args[2] === "add"));
    } finally {
      fake.close();
    }
  }
});

test("failed or malformed random generation never adds an HMAC version", () => {
  for (const flag of ["randomFailure", "randomInvalid"] as const) {
    const fake = harness({
      secrets: { [OPENAI]: [version(OPENAI, 1)] },
      [flag]: true,
    });
    try {
      const result = fake.run();
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!fake.calls().some((call) => call.args[2] === "add"));
    } finally {
      fake.close();
    }
  }
});
