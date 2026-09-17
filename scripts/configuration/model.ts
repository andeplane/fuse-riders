import { createHash } from "node:crypto";

export interface Configuration {
  projectId: string;
  projectNumber: string;
  databaseId: string;
  webAppId: string;
  authDomain: string;
  googleClientId: string;
  apiKeyId: string;
  authorizedDomains: string[];
  allowedReferrers: string[];
  apiServices: string[];
}
export interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
}
export interface Index {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}
export interface Field {
  collectionGroup: string;
  fieldPath: string;
  ttl?: boolean;
  indexes: { order?: string; arrayConfig?: string; queryScope: string }[];
}
export interface Desired {
  config: Configuration;
  indexes: Index[];
  fields: Field[];
  rules: string;
}
export interface Cloud {
  get(url: string): Promise<unknown>;
  patch(url: string, body: unknown): Promise<void>;
  checkRedirect(clientId: string, authDomain: string): Promise<void>;
  deployFirestore(): Promise<void>;
  wait(): Promise<void>;
}
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid configuration response");
  return value as Record<string, unknown>;
};
const optionalObject = (value: unknown) =>
  value === undefined ? {} : object(value);
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Expected configuration array");
  return value;
};
const strings = (value: unknown): string[] => {
  const values = array(value);
  if (
    !values.every(
      (v) => typeof v === "string" && v.length > 0 && v.length < 512,
    ) ||
    new Set(values).size !== values.length
  )
    throw new Error("Invalid configuration strings");
  return values as string[];
};
const exact = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some((k) => !keys.includes(k)))
    throw new Error("Unknown configuration field");
};
export const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const ordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, ordered(v)]),
        )
      : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const stringSet = (values: string[]) => [...values].sort();

/** Only this game's existing resources may be changed; source files are validated before cloud access. */
export function desiredConfiguration(
  raw: unknown,
  firestore: unknown,
  indexes: unknown,
  rules: string,
): Desired {
  const c = object(raw);
  exact(c, [
    "projectId",
    "projectNumber",
    "databaseId",
    "webAppId",
    "authDomain",
    "googleClientId",
    "apiKeyId",
    "authorizedDomains",
    "allowedReferrers",
    "apiServices",
  ]);
  if (
    c.projectId !== "andershaf-87" ||
    c.projectNumber !== "867594018708" ||
    c.databaseId !== "fuse-riders" ||
    c.webAppId !== "1:867594018708:web:4444ada96e29685f063981" ||
    c.apiKeyId !== "06d6ec38-6348-4b7b-865d-1ea58a9b7d91"
  )
    throw new Error("Configuration is outside the Fuse Riders resource scope");
  if (
    typeof c.authDomain !== "string" ||
    !/^[a-z0-9.-]+$/.test(c.authDomain) ||
    typeof c.googleClientId !== "string" ||
    !/^867594018708-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(
      c.googleClientId,
    )
  )
    throw new Error("Invalid Auth bootstrap configuration");
  const config = {
    ...c,
    authorizedDomains: strings(c.authorizedDomains),
    allowedReferrers: strings(c.allowedReferrers),
    apiServices: strings(c.apiServices),
  } as unknown as Configuration;
  if (
    !config.authorizedDomains.includes(config.authDomain) ||
    config.authorizedDomains.some((d) => !/^[a-z0-9.-]+$/.test(d)) ||
    !config.allowedReferrers.includes(`https://${config.authDomain}/*`) ||
    config.allowedReferrers.includes("*") ||
    !same(stringSet(config.apiServices), [
      "identitytoolkit.googleapis.com",
      "securetoken.googleapis.com",
    ])
  )
    throw new Error("Auth domains and key restrictions disagree");
  const dbs = array(object(firestore).firestore);
  if (
    dbs.length !== 1 ||
    !same(dbs[0], {
      database: config.databaseId,
      rules: "firestore.rules",
      indexes: "firestore.indexes.json",
    })
  )
    throw new Error(
      "firebase.json must target only the named Fuse Riders database",
    );
  const source = object(indexes);
  exact(source, ["indexes", "fieldOverrides"]);
  const collection = (v: unknown) => {
    if (typeof v !== "string" || !/^fuse-production-[a-z-]+$/.test(v))
      throw new Error("Index outside the production namespace");
    return v;
  };
  const fieldPath = (v: unknown) => {
    if (typeof v !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(v))
      throw new Error("Invalid field path");
    return v;
  };
  const mode = (v: Record<string, unknown>) => {
    if (
      (v.order === undefined) === (v.arrayConfig === undefined) ||
      (v.order !== undefined &&
        !["ASCENDING", "DESCENDING"].includes(String(v.order))) ||
      (v.arrayConfig !== undefined && v.arrayConfig !== "CONTAINS")
    )
      throw new Error("Invalid index mode");
    return v.order === undefined
      ? { arrayConfig: "CONTAINS" }
      : { order: String(v.order) };
  };
  const parsedIndexes = array(source.indexes).map((v) => {
    const i = object(v);
    exact(i, ["collectionGroup", "queryScope", "fields"]);
    if (i.queryScope !== "COLLECTION")
      throw new Error("Unsupported index scope");
    const fields = array(i.fields).map((f) => {
      const row = object(f);
      exact(row, ["fieldPath", "order", "arrayConfig"]);
      return { fieldPath: fieldPath(row.fieldPath), ...mode(row) };
    });
    if (fields.length < 2 || fields.length > 100)
      throw new Error("Invalid composite index");
    return {
      collectionGroup: collection(i.collectionGroup),
      queryScope: "COLLECTION",
      fields,
    };
  });
  const parsedFields = array(source.fieldOverrides).map((v) => {
    const f = object(v);
    exact(f, ["collectionGroup", "fieldPath", "ttl", "indexes"]);
    if (f.ttl !== undefined && typeof f.ttl !== "boolean")
      throw new Error("Invalid TTL policy");
    const indexes = array(f.indexes).map((v) => {
      const i = object(v);
      exact(i, ["order", "arrayConfig", "queryScope"]);
      if (i.queryScope !== "COLLECTION")
        throw new Error("Unsupported field index scope");
      return { queryScope: "COLLECTION", ...mode(i) };
    });
    return {
      collectionGroup: collection(f.collectionGroup),
      fieldPath: fieldPath(f.fieldPath),
      ...(f.ttl === undefined ? {} : { ttl: f.ttl as boolean }),
      indexes,
    };
  });
  if (
    !rules.trim() ||
    rules.length > 100_000 ||
    parsedFields.length > 200 ||
    parsedIndexes.length > 200
  )
    throw new Error("Configuration exceeds limits");
  return { config, indexes: parsedIndexes, fields: parsedFields, rules };
}

export function paths(config: Configuration) {
  const project = `projects/${config.projectId}`,
    db = `${project}/databases/${config.databaseId}`;
  return {
    auth: `https://identitytoolkit.googleapis.com/admin/v2/${project}/config`,
    google: `https://identitytoolkit.googleapis.com/admin/v2/${project}/defaultSupportedIdpConfigs/google.com`,
    key: `https://apikeys.googleapis.com/v2/projects/${config.projectNumber}/locations/global/keys/${config.apiKeyId}`,
    db: `https://firestore.googleapis.com/v1/${db}`,
    release: `https://firebaserules.googleapis.com/v1/${project}/releases/cloud.firestore/${config.databaseId}`,
    app: `https://firebase.googleapis.com/v1beta1/${project}/webApps/${config.webAppId}`,
  };
}
export interface Plan {
  firestore: string[];
  auth: boolean;
  google: boolean;
  key: boolean;
}
const desiredAuth = (c: Configuration) => ({
  authorizedDomains: stringSet(c.authorizedDomains),
  signIn: {
    email: { enabled: false },
    anonymous: { enabled: false },
    phoneNumber: { enabled: false },
  },
  emailPrivacyConfig: { enableImprovedEmailPrivacy: true },
});
const desiredKey = (c: Configuration) => ({
  browserKeyRestrictions: { allowedReferrers: stringSet(c.allowedReferrers) },
  apiTargets: stringSet(c.apiServices).map((service) => ({ service })),
});
const normalizeIndex = (value: unknown) => {
  const i = object(value);
  return {
    queryScope: i.queryScope,
    fields: array(i.fields)
      .map(object)
      .filter((f) => f.fieldPath !== "__name__")
      .map((f) => ({
        fieldPath: f.fieldPath,
        ...(f.order ? { order: f.order } : { arrayConfig: f.arrayConfig }),
      })),
  };
};
const listKey = (values: unknown[]) =>
  values.map((v) => JSON.stringify(ordered(v))).sort();

/** Read only, with field masks that exclude password-hash material and OAuth secrets. */
export async function planConfiguration(
  desired: Desired,
  cloud: Cloud,
  verifyBootstrap = true,
): Promise<Plan> {
  const c = desired.config,
    p = paths(c);
  const [db, auth, google, key, app] = (
    await Promise.all([
      cloud.get(`${p.db}?fields=name,type,deleteProtectionState`),
      cloud.get(
        `${p.auth}?fields=authorizedDomains,signIn(email(enabled),anonymous(enabled),phoneNumber(enabled)),emailPrivacyConfig`,
      ),
      cloud.get(`${p.google}?fields=enabled,clientId`),
      cloud.get(`${p.key}?fields=name,restrictions`),
      cloud.get(`${p.app}?fields=appId,apiKeyId`),
    ])
  ).map(object);
  if (
    db!.type !== "FIRESTORE_NATIVE" ||
    db!.deleteProtectionState !== "DELETE_PROTECTION_ENABLED"
  )
    throw new Error(
      "Named database must be native Firestore with delete protection enabled",
    );
  if (
    app!.appId !== c.webAppId ||
    app!.apiKeyId !== c.apiKeyId ||
    google!.clientId !== c.googleClientId
  )
    throw new Error(
      "Firebase app/key or Google OAuth client differs from the reviewed bootstrap IDs",
    );
  if (verifyBootstrap)
    await cloud.checkRedirect(c.googleClientId, c.authDomain);
  const signIn = optionalObject(auth!.signIn);
  const projectedAuth = {
    authorizedDomains: stringSet(strings(auth!.authorizedDomains)),
    signIn: Object.fromEntries(
      ["email", "anonymous", "phoneNumber"].map((k) => [
        k,
        { enabled: optionalObject(signIn[k]).enabled === true },
      ]),
    ),
    emailPrivacyConfig: {
      enableImprovedEmailPrivacy:
        optionalObject(auth!.emailPrivacyConfig).enableImprovedEmailPrivacy ===
        true,
    },
  };
  const restrictions = optionalObject(key!.restrictions),
    browser = optionalObject(restrictions.browserKeyRestrictions);
  const projectedKey = {
    ...restrictions,
    browserKeyRestrictions: {
      ...browser,
      allowedReferrers: stringSet(strings(browser.allowedReferrers ?? [])),
    },
    apiTargets: array(restrictions.apiTargets ?? [])
      .map(object)
      .sort((a, b) => String(a.service).localeCompare(String(b.service))),
  };
  const plan: Plan = {
    firestore: [],
    auth: !same(projectedAuth, desiredAuth(c)),
    google: google!.enabled !== true,
    key: !same(projectedKey, desiredKey(c)),
  };
  const release = object(await cloud.get(p.release));
  if (
    typeof release.rulesetName !== "string" ||
    !release.rulesetName.startsWith(`projects/${c.projectId}/rulesets/`)
  )
    throw new Error("Unexpected rules release target");
  const ruleset = object(
    await cloud.get(
      `https://firebaserules.googleapis.com/v1/${release.rulesetName}`,
    ),
  );
  const files = array(object(ruleset.source).files).map(object);
  if (files.length !== 1 || files[0]!.content !== desired.rules)
    plan.firestore.push("rules");
  let token = "",
    indexes: unknown[] = [];
  for (let page = 0; page < 20; page++) {
    const response = object(
      await cloud.get(
        `${p.db}/collectionGroups/-/indexes${token ? `?pageToken=${encodeURIComponent(token)}` : ""}`,
      ),
    );
    indexes.push(...array(response.indexes ?? []));
    token =
      typeof response.nextPageToken === "string" ? response.nextPageToken : "";
    if (!token) break;
  }
  if (token) throw new Error("Index listing exceeds page limit");
  for (const index of desired.indexes) {
    const match = indexes.map(object).find(
      (i) =>
        typeof i.name === "string" &&
        i.name.includes(
          `/collectionGroups/${index.collectionGroup}/indexes/`,
        ) &&
        same(normalizeIndex(i), {
          queryScope: index.queryScope,
          fields: index.fields,
        }),
    );
    if (!match || match.state !== "READY")
      plan.firestore.push(`index:${index.collectionGroup}`);
  }
  for (const field of desired.fields) {
    const live = object(
      await cloud.get(
        `${p.db}/collectionGroups/${field.collectionGroup}/fields/${encodeURIComponent(field.fieldPath)}`,
      ),
    );
    const indexes = array(optionalObject(live.indexConfig).indexes ?? []).map(
      object,
    );
    const modes = indexes.map((i) => {
      const f = object(array(i.fields)[0]);
      return {
        queryScope: i.queryScope,
        ...(f.order ? { order: f.order } : { arrayConfig: f.arrayConfig }),
      };
    });
    if (
      !same(listKey(modes), listKey(field.indexes)) ||
      indexes.some((i) => i.state !== "READY")
    )
      plan.firestore.push(`field:${field.collectionGroup}/${field.fieldPath}`);
    const ttl = optionalObject(live.ttlConfig).state;
    if (
      field.ttl !== undefined &&
      (field.ttl ? ttl !== "ACTIVE" : ttl !== undefined)
    )
      plan.firestore.push(`ttl:${field.collectionGroup}/${field.fieldPath}`);
  }
  return plan;
}

/** Mutations follow a complete preflight; retries only read state and never repeatedly create rules releases. */
export async function applyConfiguration(
  desired: Desired,
  cloud: Cloud,
  plan: Plan,
  attempts = 120,
): Promise<void> {
  const p = paths(desired.config);
  if (plan.firestore.length) await cloud.deployFirestore();
  if (plan.auth)
    await cloud.patch(
      `${p.auth}?updateMask=authorizedDomains,signIn.email.enabled,signIn.anonymous.enabled,signIn.phoneNumber.enabled,emailPrivacyConfig.enableImprovedEmailPrivacy`,
      desiredAuth(desired.config),
    );
  if (plan.google)
    await cloud.patch(`${p.google}?updateMask=enabled`, { enabled: true });
  if (plan.key)
    await cloud.patch(`${p.key}?updateMask=restrictions`, {
      restrictions: desiredKey(desired.config),
    });
  for (let attempt = 0; attempt < attempts; attempt++) {
    const observed = await planConfiguration(desired, cloud, false);
    if (
      !observed.firestore.length &&
      !observed.auth &&
      !observed.google &&
      !observed.key
    )
      return;
    if (attempt + 1 < attempts) await cloud.wait();
  }
  throw new Error(
    "Configuration did not become ready before the deadline; gateway deployment is blocked",
  );
}

/** API Keys operation IDs include an akmf. prefix; reject paths and foreign URLs. */
export function keyOperationUrl(name: unknown): string {
  if (
    typeof name !== "string" ||
    !/^operations\/[a-zA-Z0-9_.-]{1,200}$/.test(name)
  )
    throw new Error("Unexpected API key operation name");
  return `https://apikeys.googleapis.com/v2/${name}`;
}
