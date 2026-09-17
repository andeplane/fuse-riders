import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyConfiguration,
  desiredConfiguration,
  paths,
  keyOperationUrl,
  planConfiguration,
  type Cloud,
} from "../scripts/configuration/model.js";

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const config = json("deploy/firebase-config.json"),
  firebase = json("firebase.json"),
  indexes = json("firestore.indexes.json"),
  rules = readFileSync("firestore.rules", "utf8");
const desired = () => desiredConfiguration(config, firebase, indexes, rules);

class FakeCloud implements Cloud {
  readonly d = desired();
  readonly p = paths(this.d.config);
  readonly reads: string[] = [];
  readonly writes: { url: string; body: unknown }[] = [];
  resources = new Map<string, unknown>();
  redirects = 0;
  deployments = 0;
  waits = 0;
  rejectReads = false;
  redirectWorks = true;
  deploymentFails = false;
  afterWait: () => void = () => {};
  constructor() {
    this.ready();
  }
  ready() {
    const c = this.d.config;
    this.resources.set(this.p.db, {
      name: `projects/${c.projectId}/databases/${c.databaseId}`,
      type: "FIRESTORE_NATIVE",
      deleteProtectionState: "DELETE_PROTECTION_ENABLED",
    });
    this.resources.set(this.p.auth, {
      authorizedDomains: c.authorizedDomains,
      signIn: {},
      emailPrivacyConfig: { enableImprovedEmailPrivacy: true },
    });
    this.resources.set(this.p.google, {
      clientId: c.googleClientId,
      enabled: true,
    });
    this.resources.set(this.p.key, {
      restrictions: {
        browserKeyRestrictions: { allowedReferrers: c.allowedReferrers },
        apiTargets: c.apiServices.map((service) => ({ service })),
      },
    });
    this.resources.set(this.p.app, { appId: c.webAppId, apiKeyId: c.apiKeyId });
    this.resources.set(this.p.release, {
      rulesetName: `projects/${c.projectId}/rulesets/reviewed`,
    });
    this.resources.set(
      `https://firebaserules.googleapis.com/v1/projects/${c.projectId}/rulesets/reviewed`,
      { source: { files: [{ name: "firestore.rules", content: rules }] } },
    );
    this.resources.set(`${this.p.db}/collectionGroups/-/indexes`, {
      indexes: this.d.indexes.map((index, number) => ({
        name: `projects/${c.projectId}/databases/${c.databaseId}/collectionGroups/${index.collectionGroup}/indexes/${number}`,
        queryScope: index.queryScope,
        state: "READY",
        fields: [
          ...index.fields,
          { fieldPath: "__name__", order: "DESCENDING" },
        ],
      })),
    });
    for (const field of this.d.fields)
      this.resources.set(
        this.fieldUrl(field.collectionGroup, field.fieldPath),
        {
          indexConfig: {
            indexes: field.indexes.map((index) => ({
              queryScope: index.queryScope,
              fields: [
                {
                  fieldPath: field.fieldPath,
                  ...(index.order
                    ? { order: index.order }
                    : { arrayConfig: index.arrayConfig }),
                },
              ],
              state: "READY",
            })),
          },
          ...(field.ttl ? { ttlConfig: { state: "ACTIVE" } } : {}),
        },
      );
  }
  fieldUrl(collection: string, field: string) {
    return `${this.p.db}/collectionGroups/${collection}/fields/${field}`;
  }
  async get(url: string) {
    this.reads.push(url);
    if (this.rejectReads) throw new Error("HTTP 403");
    const address = new URL(url);
    address.search = "";
    assert.ok(
      this.resources.has(address.href),
      `Unexpected cloud read ${address.href}`,
    );
    return structuredClone(this.resources.get(address.href));
  }
  async patch(url: string, body: unknown) {
    this.writes.push({ url, body: structuredClone(body) });
  }
  async checkRedirect() {
    this.redirects++;
    if (!this.redirectWorks) throw new Error("Register redirect in console");
  }
  async deployFirestore() {
    this.deployments++;
    if (this.deploymentFails) throw new Error("Firestore deploy refused");
  }
  async wait() {
    this.waits++;
    this.afterWait();
  }
}

test("the committed configuration describes only the isolated database and game's key", () => {
  assert.equal(desired().config.databaseId, "fuse-riders");
  const c = config as Record<string, unknown>;
  for (const change of [
    { databaseId: "(default)" },
    { projectId: "other-project" },
    { apiKeyId: "another-key" },
    { unknown: true },
    { authorizedDomains: [] },
    { allowedReferrers: ["*"] },
    { apiServices: ["storage.googleapis.com"] },
  ])
    assert.throws(() =>
      desiredConfiguration({ ...c, ...change }, firebase, indexes, rules),
    );
  assert.throws(() =>
    desiredConfiguration(
      config,
      {
        firestore: [
          {
            database: "(default)",
            rules: "firestore.rules",
            indexes: "firestore.indexes.json",
          },
        ],
      },
      indexes,
      rules,
    ),
  );
  assert.throws(() =>
    desiredConfiguration(
      config,
      firebase,
      {
        indexes: [],
        fieldOverrides: [
          {
            collectionGroup: "other-app",
            fieldPath: "expires",
            ttl: true,
            indexes: [],
          },
        ],
      },
      rules,
    ),
  );
});

test("a read-only plan accepts ready inherited field indexes and implicit document-id ordering", async () => {
  const cloud = new FakeCloud(),
    plan = await planConfiguration(cloud.d, cloud);
  assert.deepEqual(plan, {
    firestore: [],
    auth: false,
    google: false,
    key: false,
  });
  assert.equal(cloud.deployments, 0);
  assert.deepEqual(cloud.writes, []);
  assert.equal(cloud.redirects, 1);
  assert.ok(
    cloud.reads
      .find((url) => url.startsWith(cloud.p.auth))!
      .includes("fields="),
  );
  assert.ok(
    cloud.reads
      .find((url) => url.startsWith(cloud.p.google))!
      .includes("fields=enabled,clientId"),
  );
  await applyConfiguration(cloud.d, cloud, plan);
  assert.equal(cloud.deployments, 0);
  assert.equal(cloud.writes.length, 0);
  assert.equal(
    cloud.redirects,
    1,
    "readiness polls do not repeatedly request an OAuth sign-in page",
  );
});

test("plan detects drift without exposing unmanaged Auth fields or changing OAuth credentials", async () => {
  const cloud = new FakeCloud();
  cloud.resources.set(cloud.p.auth, {
    authorizedDomains: ["localhost"],
    signIn: {
      email: { enabled: true },
      hashConfig: { signerKey: "must-never-enter-plan" },
    },
    emailPrivacyConfig: { enableImprovedEmailPrivacy: false },
  });
  cloud.resources.set(cloud.p.google, {
    clientId: cloud.d.config.googleClientId,
    enabled: false,
    clientSecret: "must-never-enter-plan",
  });
  cloud.resources.set(cloud.p.key, { restrictions: {} });
  const plan = await planConfiguration(cloud.d, cloud);
  assert.deepEqual(plan, {
    firestore: [],
    auth: true,
    google: true,
    key: true,
  });
  assert.equal(JSON.stringify(plan).includes("must-never"), false);
  cloud.afterWait = () => cloud.ready();
  await applyConfiguration(cloud.d, cloud, plan, 2);
  assert.equal(cloud.writes.length, 3);
  const google = cloud.writes.find((w) => w.url.startsWith(cloud.p.google))!;
  assert.equal(new URL(google.url).searchParams.get("updateMask"), "enabled");
  assert.deepEqual(google.body, { enabled: true });
  assert.equal(JSON.stringify(cloud.writes).includes("must-never"), false);
  assert.equal(cloud.waits, 1);
});

test("an unready index or TTL blocks deployment until state becomes ready, with only one CLI invocation", async () => {
  const cloud = new FakeCloud();
  cloud.resources.set(`${cloud.p.db}/collectionGroups/-/indexes`, {
    indexes: [],
  });
  cloud.resources.set(cloud.fieldUrl("fuse-production-matches", "cleanupAt"), {
    indexConfig: { indexes: [] },
    ttlConfig: { state: "CREATING" },
  });
  const plan = await planConfiguration(cloud.d, cloud);
  assert.ok(plan.firestore.includes("index:fuse-production-matches"));
  assert.ok(plan.firestore.includes("ttl:fuse-production-matches/cleanupAt"));
  cloud.afterWait = () => cloud.ready();
  await applyConfiguration(cloud.d, cloud, plan, 2);
  assert.equal(cloud.deployments, 1);
  assert.equal(cloud.waits, 1);
  cloud.resources.set(`${cloud.p.db}/collectionGroups/-/indexes`, {
    indexes: [],
  });
  cloud.afterWait = () => {};
  await assert.rejects(
    applyConfiguration(
      cloud.d,
      cloud,
      await planConfiguration(cloud.d, cloud),
      2,
    ),
    /gateway deployment is blocked/,
  );
});

test("missing permissions, a wrong app or an unregistered redirect fail preflight before writes", async () => {
  for (const setup of [
    (c: FakeCloud) => {
      c.rejectReads = true;
    },
    (c: FakeCloud) => {
      c.redirectWorks = false;
    },
    (c: FakeCloud) => {
      c.resources.set(c.p.app, { appId: "foreign-app" });
    },
    (c: FakeCloud) => {
      c.resources.set(c.p.db, { type: "DATASTORE_MODE" });
    },
  ]) {
    const cloud = new FakeCloud();
    setup(cloud);
    await assert.rejects(planConfiguration(cloud.d, cloud));
    assert.equal(cloud.deployments, 0);
    assert.equal(cloud.writes.length, 0);
  }
});

test("a refused Firestore deploy stops before Auth/key changes", async () => {
  const cloud = new FakeCloud();
  cloud.deploymentFails = true;
  await assert.rejects(
    applyConfiguration(cloud.d, cloud, {
      firestore: ["rules"],
      auth: true,
      google: true,
      key: true,
    }),
    /refused/,
  );
  assert.equal(cloud.writes.length, 0);
});

test("API key updates accept provider operation IDs and reject foreign paths", () => {
  const name = "operations/akmf.6573437d-47c1-42c4-b817-0562f514f6ff";
  assert.equal(
    keyOperationUrl(name),
    `https://apikeys.googleapis.com/v2/${name}`,
  );
  for (const invalid of [
    "https://example.com/token",
    "operations/../keys/key",
    "operations/",
    undefined,
  ])
    assert.throws(() => keyOperationUrl(invalid));
});
