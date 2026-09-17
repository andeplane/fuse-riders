import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateType,
  sameCertificate,
  sdpFingerprint,
  sdpUfrags,
  ufragMatches,
} from "../src/ice-signal.js";
const HOST =
  "candidate:1 1 udp 2113937151 4f1c2e3a-9b8d-4c1e-a2f0-1b2c3d4e5f60.local 51234 typ host generation 0 ufrag AbCd network-cost 999";
const SRFLX =
  "candidate:842163049 1 udp 1677729535 203.0.113.9 61234 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag AbCd network-cost 999";
const RELAY =
  "candidate:3 1 udp 41885439 198.51.100.7 3478 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag AbCd";
const sdp = (ufrag: string, fingerprint: string) =>
  `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=ice-ufrag:${ufrag}\r\na=ice-pwd:secret\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;

test("candidate types are read from the candidate line without keeping addresses", () => {
  assert.equal(candidateType(HOST), "host");
  assert.equal(candidateType(SRFLX), "srflx");
  assert.equal(candidateType(RELAY), "relay");
  assert.equal(candidateType("candidate:1 1 udp 1 x 1 typ prflx"), "prflx");
  assert.equal(candidateType(""), "end");
  assert.equal(candidateType(null), "end");
  assert.equal(candidateType(undefined), "end");
  assert.equal(candidateType("candidate:1 1 udp 1 x 1 typ bogus"), "unknown");
  assert.equal(candidateType("garbage"), "unknown");
});

test("ufrag and fingerprint readers tolerate missing lines", () => {
  assert.deepEqual(sdpUfrags(sdp("AbCd", "AA:BB")), ["AbCd"]);
  assert.deepEqual(sdpUfrags(undefined), []);
  assert.deepEqual(sdpUfrags("v=0"), []);
  assert.equal(sdpFingerprint(sdp("x", "AA:BB")), "sha-256 AA:BB");
  assert.equal(sdpFingerprint("v=0"), undefined);
});

test("restart offers keep the DTLS certificate; a recreated connection does not", () => {
  assert.equal(
    sameCertificate(undefined, sdp("x", "AA")),
    true,
    "first offer on a link created by an early candidate",
  );
  assert.equal(sameCertificate(sdp("a", "AA"), sdp("b", "AA")), true);
  assert.equal(sameCertificate(sdp("a", "AA"), sdp("a", "BB")), false);
  assert.equal(
    sameCertificate("v=0", sdp("a", "AA")),
    false,
    "unknown previous certificate never matches",
  );
});

test("candidates are scoped to the ICE generation named by their ufrag", () => {
  const current = sdp("AbCd", "AA");
  assert.equal(
    ufragMatches({ candidate: SRFLX, usernameFragment: "AbCd" }, current),
    true,
  );
  assert.equal(
    ufragMatches({ candidate: SRFLX, usernameFragment: "stale" }, current),
    false,
  );
  assert.equal(
    ufragMatches({ candidate: SRFLX, usernameFragment: null }, current),
    true,
    "ufrag from the candidate line",
  );
  assert.equal(
    ufragMatches(
      { candidate: SRFLX.replace("ufrag AbCd", "ufrag old") },
      current,
    ),
    false,
  );
  assert.equal(
    ufragMatches({ candidate: "", usernameFragment: null }, current),
    true,
    "end-of-candidates has no generation",
  );
  assert.equal(
    ufragMatches({ candidate: "candidate:1 1 udp 1 x 1 typ host" }, current),
    true,
    "Safari omits ufrag on some lines",
  );
});
