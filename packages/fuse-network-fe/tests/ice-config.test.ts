import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ICE_SERVERS,
  IceConfig,
  parseIceServers,
} from "../src/ice-config.js";

test("defaults carry two STUN providers and no TURN", () => {
  assert.deepEqual(
    DEFAULT_ICE_SERVERS.map((s) => s.urls),
    ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"],
  );
  assert.ok(DEFAULT_ICE_SERVERS.every((s) => !("credential" in s)));
});

test("service ICE lists are validated at the client boundary and fall back to defaults", () => {
  assert.deepEqual(
    parseIceServers({
      iceServers: [
        { urls: "stun:a.example:3478" },
        { urls: ["turn:b.example"], username: "u", credential: "c" },
      ],
    }),
    [{ urls: ["stun:a.example:3478"] }],
    "TURN entries are rejected: ADR035 provisions no relay",
  );
  for (const raw of [
    undefined,
    null,
    "x",
    {},
    { iceServers: "stun:a" },
    { iceServers: [] },
    { iceServers: [{ urls: "http://evil" }] },
    { iceServers: [{ urls: ["stun:ok", "javascript:x"] }] },
    { iceServers: [{ urls: "" }] },
    { iceServers: [5, null] },
  ])
    assert.equal(parseIceServers(raw), undefined, JSON.stringify(raw));
  assert.deepEqual(
    parseIceServers({
      iceServers: [{ urls: "stun:a", username: "u", credential: "c" }],
    }),
    [{ urls: ["stun:a"] }],
    "STUN needs no credentials, so none are passed through",
  );
});

test("peer connections wait for the ICE fetch instead of negotiating with the initial list (issue #27)", async () => {
  const ice = new IceConfig();
  assert.deepEqual(await ice.iceServers(), [...DEFAULT_ICE_SERVERS]);
  let resolveFetch!: (raw: unknown) => void;
  const loading = ice.load(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );
  let settled = false;
  const pending = ice.iceServers().then((servers) => {
    settled = true;
    return servers;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    settled,
    false,
    "link creation must not proceed before the fetch resolves",
  );
  resolveFetch({ iceServers: [{ urls: "stun:service.example:3478" }] });
  await loading;
  assert.deepEqual(await pending, [{ urls: ["stun:service.example:3478"] }]);
  assert.equal(ice.source, "service");
});

test("a failed ICE fetch yields the STUN defaults, never an empty list", async () => {
  const ice = new IceConfig();
  await ice.load(() => Promise.reject(new Error("offline")));
  assert.deepEqual(await ice.iceServers(), [...DEFAULT_ICE_SERVERS]);
  assert.match(ice.source, /failed/);
  await ice.load(() => Promise.resolve({ iceServers: [] }));
  assert.equal((await ice.iceServers()).length, 2);
  assert.equal(
    ice.source,
    "default (service list invalid)",
    "defaults substituted for an unusable service list are not reported as service",
  );
});

test("a hung ICE fetch falls back to the STUN defaults when the abort bound fires, even if the fetch ignores the signal", async () => {
  const ice = new IceConfig();
  const controller = new AbortController();
  let settled = false;
  const loading = ice
    .load(() => new Promise(() => {}), controller.signal)
    .then(() => {
      settled = true;
    });
  const waiting = ice.iceServers();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  controller.abort(new Error("ice fetch timeout"));
  await loading;
  assert.deepEqual(await waiting, [...DEFAULT_ICE_SERVERS]);
  assert.equal(ice.source, "default (ice fetch failed)");
  const late = new IceConfig();
  await late.load(
    () => Promise.resolve({ iceServers: [{ urls: "stun:late.example" }] }),
    AbortSignal.abort(new Error("already out of time")),
  );
  assert.deepEqual(
    await late.iceServers(),
    [...DEFAULT_ICE_SERVERS],
    "an already-aborted signal never waits for the fetch",
  );
});
