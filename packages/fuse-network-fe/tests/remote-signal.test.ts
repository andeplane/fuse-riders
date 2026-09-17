import test from "node:test";
import assert from "node:assert/strict";
import { RemoteSignal, type RemotePeer } from "../src/remote-signal.js";
const offer = (ufrag: string): RTCSessionDescriptionInit => ({
  type: "offer",
  sdp: `v=0\r\na=ice-ufrag:${ufrag}\r\na=fingerprint:sha-256 AA\r\n`,
});
const cand = (ufrag: string, n = 1): RTCIceCandidateInit => ({
  candidate: `candidate:${n} 1 udp 1 h.local 1 typ host ufrag ${ufrag}`,
  sdpMid: "0",
  sdpMLineIndex: 0,
  usernameFragment: ufrag,
});
/** Deferred setRemoteDescription models the browser applying an offer while trickle candidates keep arriving. */
class FakePeer implements RemotePeer {
  remoteDescription: { sdp: string } | null = null;
  added: RTCIceCandidateInit[] = [];
  reject = new Set<string>();
  release?: () => void;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    return new Promise((resolve) => {
      this.release = () => {
        this.remoteDescription = { sdp: description.sdp ?? "" };
        resolve();
      };
    });
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.reject.has(candidate.usernameFragment ?? ""))
      throw new Error("OperationError");
    this.added.push(candidate);
  }
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("candidates before the remote description are buffered, bounded at 64 and flushed in order", async () => {
  const pc = new FakePeer(),
    inbox = new RemoteSignal(pc);
  for (let n = 1; n <= 70; n++) await inbox.candidate(cand("A", n));
  assert.equal(inbox.waiting, 64);
  assert.equal(inbox.counts.dropped, 6);
  assert.equal(pc.added.length, 0);
  const describing = inbox.describe(offer("A"));
  await settle();
  assert.equal(
    pc.added.length,
    0,
    "nothing applied before the description settles",
  );
  pc.release!();
  await describing;
  assert.deepEqual(
    pc.added.map((c) => Number(/candidate:(\d+)/.exec(c.candidate!)![1])),
    Array.from({ length: 64 }, (_, i) => i + 7),
  );
  assert.equal(inbox.counts.applied, 64);
  assert.equal(inbox.waiting, 0);
});

test("candidates arriving while a description is being applied wait, then apply; later ones apply directly", async () => {
  const pc = new FakePeer(),
    inbox = new RemoteSignal(pc);
  const describing = inbox.describe(offer("A"));
  await inbox.candidate(cand("A", 1));
  assert.equal(pc.added.length, 0);
  assert.equal(inbox.waiting, 1);
  pc.release!();
  await describing;
  assert.equal(pc.added.length, 1);
  await inbox.candidate(cand("A", 2));
  assert.equal(pc.added.length, 2);
  assert.equal(inbox.counts.buffered, 1);
});

test("answer-side candidates that arrive after the local answer are applied against the remote description", async () => {
  const pc = new FakePeer(),
    inbox = new RemoteSignal(pc);
  const describing = inbox.describe(offer("A"));
  pc.release!();
  await describing;
  await inbox.candidate({
    candidate: "",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: null,
  });
  await inbox.candidate(cand("A"));
  assert.equal(pc.added.length, 2);
  assert.equal(inbox.counts.rejected, 0);
});

test("a restart offer changes the ufrag: old-generation candidates never poison it and new ones wait for it", async () => {
  const pc = new FakePeer(),
    inbox = new RemoteSignal(pc);
  let describing = inbox.describe(offer("A"));
  pc.release!();
  await describing;
  await inbox.candidate(cand("B", 1));
  assert.equal(
    pc.added.length,
    0,
    "candidate for the coming restart offer waits",
  );
  await inbox.candidate(cand("A", 2));
  assert.equal(pc.added.length, 1);
  describing = inbox.describe(offer("B"));
  pc.release!();
  await describing;
  assert.equal(pc.added.length, 2);
  assert.equal(pc.added.at(-1)?.usernameFragment, "B");
  await inbox.candidate(cand("A", 3));
  assert.equal(inbox.waiting, 1, "stale generation is parked, not applied");
  assert.equal(pc.added.length, 2);
});

test("browser rejection of a candidate is counted, not thrown into the signalling loop", async () => {
  const pc = new FakePeer(),
    inbox = new RemoteSignal(pc);
  pc.reject.add("A");
  const describing = inbox.describe(offer("A"));
  pc.release!();
  await describing;
  await inbox.candidate(cand("A"));
  assert.deepEqual(inbox.counts, {
    descriptions: 1,
    candidates: 1,
    applied: 0,
    buffered: 0,
    rejected: 1,
    dropped: 0,
  });
});
