import test from "node:test";
import assert from "node:assert/strict";
import { readLinkReport } from "../src/link-report.js";
const link = {
  peerId: "b".repeat(24),
  connectionId: "connection-1",
  offerer: false,
  healthy: false,
  ageMs: 1000,
  attempts: 0,
  ice: "checking",
  connection: "connecting",
  gathering: "complete",
  signaling: "stable",
  channel: "connecting/connecting",
  local: { host: 1, srflx: 1 },
  remote: { host: 1 },
  signalling: { offersIn: 1 },
};
const report = (links: unknown = [link]) => ({
  type: "link-report",
  version: 1,
  hidden: false,
  links,
});
test("diagnostic parser reconstructs safe fields and strips secrets at every depth", () => {
  const parsed = readLinkReport({
    ...report([
      {
        ...link,
        token: "secret",
        sdp: "secret",
        local: { ...link.local, address: "secret" },
      },
    ]),
    url: "secret",
  });
  assert.deepEqual(parsed, report());
  assert.equal(JSON.stringify(parsed).includes("secret"), false);
  assert.deepEqual(readLinkReport(report([])), report([]));
});
test("malformed, oversized and freeform operational records are refused", () => {
  for (const value of [
    null,
    [],
    {},
    { ...report(), version: 2 },
    { ...report(), hidden: "false" },
    report(null),
    report(Array.from({ length: 11 }, () => link)),
    report([null]),
    report([{ ...link, peerId: "name" }]),
    report([{ ...link, connectionId: "https://invite?token=secret" }]),
    report([{ ...link, offerer: 1 }]),
    report([{ ...link, healthy: "true" }]),
    report([{ ...link, ageMs: -1 }]),
    report([{ ...link, attempts: 5 }]),
    report([{ ...link, ice: "secret" }]),
    report([{ ...link, channel: "secret" }]),
    report([{ ...link, local: null }]),
    report([{ ...link, remote: { host: -1 } }]),
    report([{ ...link, signalling: { offersIn: Infinity } }]),
  ])
    assert.equal(readLinkReport(value), undefined);
});
