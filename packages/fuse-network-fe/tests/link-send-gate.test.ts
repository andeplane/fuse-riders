import test from "node:test";
import assert from "node:assert/strict";
import {
  GAMEPLAY_BUFFER_LIMIT,
  LinkSendGate,
  PROBE_BUFFER_LIMIT,
  type SendChannelFacts,
} from "../src/link-send-gate.js";
const open = (bufferedAmount = 0): SendChannelFacts => ({
  readyState: "open",
  bufferedAmount,
});

test("healthy open channel under the buffer limit is permitted for gameplay and probes", () => {
  const gate = new LinkSendGate();
  assert.equal(gate.draining, false);
  assert.equal(gate.permits(open(), GAMEPLAY_BUFFER_LIMIT), true);
  assert.equal(
    gate.permits(open(GAMEPLAY_BUFFER_LIMIT - 1), GAMEPLAY_BUFFER_LIMIT),
    true,
  );
  assert.equal(
    gate.permits(open(GAMEPLAY_BUFFER_LIMIT), GAMEPLAY_BUFFER_LIMIT),
    false,
  );
  assert.equal(
    gate.permits(open(PROBE_BUFFER_LIMIT), PROBE_BUFFER_LIMIT),
    false,
  );
  assert.equal(gate.permits(undefined, GAMEPLAY_BUFFER_LIMIT), false);
  for (const readyState of ["connecting", "closing", "closed"] as const)
    assert.equal(
      gate.permits({ readyState, bufferedAmount: 0 }, GAMEPLAY_BUFFER_LIMIT),
      false,
    );
});

test("a closing signal recorded before the DOM readyState changes blocks gameplay and probe sends", () => {
  const gate = new LinkSendGate();
  const channel = open();
  assert.equal(gate.permits(channel, PROBE_BUFFER_LIMIT), true);
  // The channel still reports "open": this is the WebKit window where the transport is already gone.
  gate.drain();
  assert.equal(gate.permits(channel, GAMEPLAY_BUFFER_LIMIT), false);
  assert.equal(gate.permits(channel, PROBE_BUFFER_LIMIT), false);
  assert.equal(gate.draining, true);
  gate.drain();
  assert.equal(gate.permits(channel, GAMEPLAY_BUFFER_LIMIT), false);
});
