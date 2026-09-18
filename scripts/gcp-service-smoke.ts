/** Explicit provider integration: two Node processes, real Firestore and Pub/Sub, synthetic SDP only. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Firestore } from "@google-cloud/firestore";
import { PubSub } from "@google-cloud/pubsub";
import WebSocket from "ws";
import { OAuth2Client } from "google-auth-library";

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "andershaf-87";
const databaseId = process.env.FIRESTORE_DATABASE_ID ?? "fuse-riders";
const region = process.env.GCP_REGION ?? "europe-west1";
const topic = process.env.PUBSUB_TOPIC ?? "fuse-riders-signalling";
const prefix = `fuse-smoke-${Date.now()}-${randomBytes(3).toString("hex")}`;
const activeCliAuth = process.env.GCP_SMOKE_GCLOUD_AUTH === "1";
const accessToken = activeCliAuth
  ? execFileSync(
      "gcloud",
      ["auth", "print-access-token", "--account=andershaf@gmail.com"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim()
  : undefined;
const authClient = accessToken ? new OAuth2Client() : undefined;
if (authClient && accessToken)
  authClient.setCredentials({
    access_token: accessToken,
    expiry_date: Date.now() + 45 * 60 * 1000,
  });
const firestore = new Firestore({
  projectId,
  databaseId,
  ...(authClient ? { authClient } : {}),
});
const pubsub = new PubSub({
  projectId,
  apiEndpoint: `${region}-pubsub.googleapis.com:443`,
  ...(authClient ? { authClient } : {}),
});
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const sourcePaths = [
  "src/service/index.ts",
  "packages/fuse-network-be/src/gcp/index.ts",
  "packages/fuse-network-be/src/gateway.ts",
  "packages/fuse-network-be/src/room-store.ts",
  "packages/fuse-network-be/src/room-bus.ts",
  "packages/fuse-network-be/src/gcp/pubsub-bus.ts",
  "packages/fuse-network-be/src/gcp/firestore-store.ts",
  "scripts/gcp-service-smoke.ts",
  "scripts/gcp-service-child.ts",
  "package-lock.json",
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ]),
  ),
);
const children: ChildProcess[] = [],
  peers: Peer[] = [];
const stderr: string[] = [];
interface Frame {
  type?: string;
  [key: string]: unknown;
}
interface Check {
  name: string;
  milliseconds: number;
}
const checks: Check[] = [];
let started = performance.now();
function checked(name: string) {
  console.log(`provider-smoke: ${name}`);
  const now = performance.now();
  checks.push({ name, milliseconds: Math.round(now - started) });
  started = now;
}
function deadline<T>(
  promise: Promise<T>,
  label: string,
  ms = 20_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
async function gateway(): Promise<string> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      activeCliAuth ? "scripts/gcp-service-child.ts" : "src/service/index.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GOOGLE_CLOUD_PROJECT: projectId,
        FIRESTORE_DATABASE_ID: databaseId,
        GCP_REGION: region,
        PUBSUB_TOPIC: topic,
        ROOM_COLLECTION_PREFIX: prefix,
        ALLOWED_ORIGINS: "http://localhost",
        PORT: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  if (accessToken) child.stdin?.end(accessToken);
  else child.stdin?.end();
  let buffer = "";
  return deadline(
    new Promise<string>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        reject(new Error(`Gateway exited before startup (${code})`)),
      );
      child.stderr?.on("data", (data) => {
        stderr.push(String(data).slice(0, 1000));
      });
      child.stdout?.on("data", (data) => {
        buffer += String(data);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const item: unknown = JSON.parse(line);
            if (
              item &&
              typeof item === "object" &&
              "service" in item &&
              "port" in item &&
              typeof item.port === "number"
            )
              resolve(`http://127.0.0.1:${item.port}`);
          } catch {
            // The child also prints lines that are not JSON; only the startup record matters here.
          }
        }
      });
    }),
    "gateway startup",
  );
}
class Peer {
  readonly socket: WebSocket;
  frames: Frame[] = [];
  closed?: number;
  private listeners = new Set<() => void>();
  constructor(url: string) {
    this.socket = new WebSocket(url, { origin: "http://localhost" });
    this.socket.on("message", (raw) => {
      this.frames.push(JSON.parse(raw.toString()));
      this.notify();
    });
    this.socket.on("close", (code) => {
      this.closed = code;
      this.notify();
    });
    this.socket.on("error", () => {});
    peers.push(this);
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  async frame(
    type: string,
    predicate: (frame: Frame) => boolean = () => true,
  ): Promise<Frame> {
    return deadline(
      new Promise<Frame>((resolve, reject) => {
        const check = () => {
          const found = this.frames.find(
            (frame) => frame.type === type && predicate(frame),
          );
          if (found) {
            this.listeners.delete(check);
            resolve(found);
          } else if (this.closed !== undefined) {
            this.listeners.delete(check);
            reject(new Error(`Peer closed (${this.closed}) before ${type}`));
          }
        };
        this.listeners.add(check);
        check();
      }),
      `frame ${type}`,
    );
  }
  async closeCode(): Promise<number> {
    return deadline(
      new Promise<number>((resolve) => {
        const check = () => {
          if (this.closed !== undefined) {
            this.listeners.delete(check);
            resolve(this.closed);
          }
        };
        this.listeners.add(check);
        check();
      }),
      "peer close",
    );
  }
  send(frame: unknown) {
    this.socket.send(JSON.stringify(frame));
  }
}
const open = (origin: string, code: string, token: string) =>
  new Peer(
    `${origin.replace("http:", "ws:")}/api/rooms/${code}/ws?token=${token}`,
  );
let passed = false;
let failure: string | undefined;
try {
  const [a, b] = await Promise.all([gateway(), gateway()]);
  assert.notEqual(a, b);
  checked("two separate Node gateway processes started");
  const denied = await fetch(`${a}/api/rooms`, {
    method: "POST",
    headers: { Origin: "https://invalid.example" },
  });
  assert.equal(denied.status, 403);
  const response = await fetch(`${a}/api/rooms`, {
    method: "POST",
    headers: { Origin: "http://localhost" },
  });
  assert.equal(response.status, 201);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "http://localhost",
  );
  const room = (await response.json()) as { code: string; token: string };
  assert.match(room.code, /^[A-Z]{2}[0-9]{2}$/);
  checked("real Firestore room create and Origin boundary");
  const host = open(a, room.code, room.token),
    hostWelcome = await host.frame("welcome");
  assert.equal(hostWelcome.protocol, 2);
  const guestToken = randomBytes(32).toString("hex"),
    guest = open(b, room.code, guestToken),
    guestWelcome = await guest.frame("welcome");
  await host.frame(
    "peer",
    (frame) => frame.connectionId === guestWelcome.connectionId,
  );
  checked("cross-process membership watcher and v2 welcome");
  const offer = {
    description: { type: "offer", sdp: "v=0\r\ns=fuse-provider-smoke\r\n" },
  };
  host.send({
    type: "signal",
    to: guestWelcome.id,
    targetConnectionId: guestWelcome.connectionId,
    data: offer,
  });
  const remoteSignal = await guest.frame("signal");
  assert.equal(remoteSignal.connectionId, hostWelcome.connectionId);
  assert.deepEqual(remoteSignal.data, offer);
  checked("real PubSub addressed SDP delivery between processes");
  guest.send({
    type: "signal",
    to: hostWelcome.id,
    targetConnectionId: hostWelcome.connectionId,
    data: {
      description: { type: "answer", sdp: "v=0\r\ns=fuse-provider-answer\r\n" },
    },
  });
  await host.frame("signal");
  checked("reverse ordered signalling edge");
  host.send({
    type: "relay",
    to: guestWelcome.id,
    targetConnectionId: guestWelcome.connectionId,
    data: { type: "world", secretSentinel: "must-not-route" },
  });
  const rejected = await host.frame("error");
  assert.match(String(rejected.error), /WebRTC/);
  assert.equal(
    guest.frames.some((frame) => frame.type === "relay"),
    false,
  );
  checked("gameplay relay explicitly rejected");
  const grant = hostWelcome.grant as {
    incarnation: string;
    epoch: number;
    holder: string;
    grantId: string;
    expiresAt: number;
  };
  host.send({
    type: "time",
    id: 1,
    sentAt: 1,
    renew: {
      incarnation: grant.incarnation,
      epoch: grant.epoch,
      holder: grant.holder,
      grantId: grant.grantId,
    },
  });
  await host.frame("time");
  checked("identity-only lease renewal against real transaction");
  const replacement = open(b, room.code, room.token),
    replacementWelcome = await replacement.frame("welcome");
  const next = replacementWelcome.grant as {
    epoch: number;
    holder: string;
    validFrom: number;
  };
  assert.equal(next.epoch, grant.epoch + 1);
  assert.equal(next.holder, replacementWelcome.connectionId);
  assert.ok(next.validFrom >= grant.expiresAt + 250);
  assert.equal(await host.closeCode(), 4001);
  checked("creator replacement fenced across gateways");
  const replacementGuest = open(a, room.code, guestToken),
    newGuestWelcome = await replacementGuest.frame("welcome");
  assert.notEqual(newGuestWelcome.connectionId, guestWelcome.connectionId);
  assert.equal(await guest.closeCode(), 4001);
  await replacement.frame(
    "peer",
    (frame) => frame.connectionId === newGuestWelcome.connectionId,
  );
  checked("guest connection replacement and old-close compare-and-set");
  const stored = (
    await firestore.collection(`${prefix}-rooms`).doc(room.code).get()
  ).data();
  assert.equal(
    stored?.members[String(guestWelcome.id)].connectionId,
    newGuestWelcome.connectionId,
  );
  assert.equal(stored?.grant.holder, replacementWelcome.connectionId);
  passed = true;
} catch (error) {
  failure =
    error instanceof Error ? error.message : "Unknown integration failure";
} finally {
  for (const peer of peers) peer.socket.close();
  await Promise.allSettled(
    peers
      .filter((peer) => peer.closed === undefined)
      .map((peer) => peer.closeCode()),
  );
  for (const child of children) child.kill("SIGTERM");
  await Promise.allSettled(
    children.map((child) =>
      deadline(
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once("exit", () => resolve());
        }),
        "gateway shutdown",
        15_000,
      ).catch(() => {
        child.kill("SIGKILL");
      }),
    ),
  );
  // Only this run's random collection prefix and subscriptions are deleted.
  const cleanupErrors: string[] = [];
  try {
    const [subscriptions] = await deadline(
      pubsub
        .topic(topic)
        .getSubscriptions({ gaxOpts: { timeout: 10000, retry: null } }),
      "list test subscriptions",
      12000,
    );
    await Promise.all(
      subscriptions
        .filter((s) => s.name.includes(`/subscriptions/${prefix}-`))
        .map((s) => s.delete({ timeout: 5000, retry: null })),
    );
  } catch {
    cleanupErrors.push("PubSub test subscription cleanup failed");
  }
  for (const collection of [`${prefix}-rooms`, `${prefix}-creation-limits`])
    try {
      const docs = await deadline(
        firestore.collection(collection).get(),
        "test document listing",
        10000,
      );
      await deadline(
        Promise.all(docs.docs.map((doc) => doc.ref.delete())),
        "test document deletion",
        10000,
      );
    } catch {
      cleanupErrors.push("Firestore test document cleanup failed");
    }
  if (cleanupErrors.length) {
    passed = false;
    failure = [failure, ...cleanupErrors].filter(Boolean).join("; ");
  } else checked("test-only documents/subscriptions cleaned");
  await deadline(
    Promise.allSettled([firestore.terminate(), pubsub.close()]),
    "SDK shutdown",
    10000,
  ).catch(() => {
    passed = false;
    failure ??= "SDK shutdown exceeded 10 seconds";
  });
  await mkdir("artifacts", { recursive: true });
  const report = {
    date: new Date().toISOString(),
    revision,
    sourceSha256,
    testPrefix: prefix,
    auth: activeCliAuth
      ? "active gcloud user short-lived token in memory"
      : "existing ADC",
    workingTreeChanged:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0,
    project: projectId,
    database: databaseId,
    region,
    topic,
    passed,
    checks,
    failure,
    limits:
      "Real Firestore/PubSub and two local Node processes. Synthetic SDP and WSS clients; does not prove WebRTC negotiation, physical phones, Cloud Run revision routing or runtime-service-account IAM.",
    diagnostics: stderr.filter((line) => line.trim().startsWith("{")),
  };
  await writeFile(
    "artifacts/gcp-service-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
if (!passed) process.exitCode = 1;
