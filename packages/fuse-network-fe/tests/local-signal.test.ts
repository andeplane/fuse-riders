import test from "node:test";
import assert from "node:assert/strict";
import {
  LocalSignal,
  type LocalPeer,
  type LocalSignalFrame,
} from "../src/local-signal.js";
import { RemoteSignal, type RemotePeer } from "../src/remote-signal.js";
const description: RTCSessionDescriptionInit = {
  type: "offer",
  sdp: "v=0\r\na=ice-ufrag:new\r\na=fingerprint:sha-256 NEW\r\n",
};
const candidate: RTCIceCandidateInit = {
  candidate: "candidate:1 1 udp 1 redacted 1 typ srflx ufrag new",
  usernameFragment: "new",
};
class Peer implements LocalPeer {
  localDescription: RTCSessionDescriptionInit | null = null;
  release?: () => void;
  reject?: () => void;
  setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    return new Promise((resolve, reject) => {
      this.release = () => {
        this.localDescription = d;
        resolve();
      };
      this.reject = () => reject(new Error("OperationError"));
    });
  }
}
class ReceivingPeer implements RemotePeer {
  remoteDescription: { sdp: string } | null = null;
  constructor(private readonly added: RTCIceCandidateInit[]) {}
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteDescription = { sdp: d.sdp ?? "" };
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.added.push(c);
  }
}
test("replacement offers deliver their description before early trickle, so the replacement receives its candidates", async () => {
  const local = new Peer();
  let remote: RemotePeer = {
    remoteDescription: {
      sdp: "v=0\r\na=ice-ufrag:old\r\na=fingerprint:sha-256 OLD\r\n",
    },
    async setRemoteDescription() {},
    async addIceCandidate() {
      assert.fail("candidate applied to retired connection");
    },
  };
  let inbox = new RemoteSignal(remote);
  const frames: LocalSignalFrame[] = [],
    added: RTCIceCandidateInit[] = [];
  let delivered = Promise.resolve();
  const outbound = new LocalSignal(local, (frame) => {
    frames.push(frame);
    delivered = delivered.then(async () => {
      if ("description" in frame) {
        remote = new ReceivingPeer(added);
        inbox = new RemoteSignal(remote);
        await inbox.describe(frame.description);
      } else await inbox.candidate(frame.candidate);
    });
    return true;
  });
  const publishing = outbound.describe(description);
  outbound.candidate(candidate);
  assert.equal(frames.length, 0);
  local.release!();
  await publishing;
  await delivered;
  assert.deepEqual(frames, [{ description }, { candidate }]);
  assert.deepEqual(added, [candidate]);
  outbound.candidate(candidate);
  await delivered;
  assert.equal(
    added.length,
    2,
    "later trickle also reaches the current connection",
  );
});
test("a rejected or retired description never leaks its queued candidates", async () => {
  for (const rejects of [true, false]) {
    const pc = new Peer(),
      frames: LocalSignalFrame[] = [];
    const out = new LocalSignal(pc, (frame) => {
      frames.push(frame);
      return false;
    });
    const pending = out.describe(description);
    out.candidate(candidate);
    if (rejects) {
      pc.reject!();
      await assert.rejects(pending, /OperationError/);
    } else {
      pc.release!();
      await pending;
    }
    out.candidate(candidate);
    assert.equal(frames.filter((frame) => "candidate" in frame).length, 0);
    const retry = out.describe(description);
    pc.release!();
    await retry;
  }
});
test("early trickle is bounded and concurrent descriptions cannot share its buffer", async () => {
  const pc = new Peer(),
    frames: LocalSignalFrame[] = [];
  const out = new LocalSignal(pc, (frame) => {
    frames.push(frame);
    return true;
  });
  const pending = out.describe(description);
  for (let i = 0; i < 100; i++) out.candidate(candidate);
  await assert.rejects(out.describe(description), /already in progress/);
  pc.release!();
  await pending;
  assert.equal(frames.length, 65);
});

test("a restart superseded during setLocalDescription cannot publish its description or candidates", async () => {
  const pc = new Peer(),
    frames: LocalSignalFrame[] = [];
  let current = true;
  const out = new LocalSignal(pc, (frame) => {
    frames.push(frame);
    return true;
  });
  const pending = out.describe(description, () => current);
  out.candidate(candidate);
  current = false;
  pc.release!();
  await pending;
  out.candidate(candidate);
  assert.deepEqual(frames, []);
});
