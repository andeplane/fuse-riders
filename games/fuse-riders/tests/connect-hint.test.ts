import { test } from "node:test";
import assert from "node:assert/strict";
import { connectHint } from "../src/online/connect-hint.js";

test("connect hint shows the actual stalled reason without guessing a network requirement", () => {
  assert.equal(connectHint("Connecting…", 0), "Warming up the arena…");
  assert.equal(connectHint("Connecting…", 7000), "Still reaching the host…");
  assert.match(connectHint("Connecting…", 21000), /across the internet/);
  assert.match(connectHint("Connecting…", 21000), /ROOM → LINK DIAGNOSTICS/);
  assert.doesNotMatch(
    connectHint("Connecting…", 21000),
    /different network|host.s Wi-Fi/,
  );
  assert.match(
    connectHint("ICE failed — likely symmetric NAT/CGNAT on one side", 1000),
    /ICE failed/,
  );
});

test("a connected link never shows the different-network advice", () => {
  assert.equal(
    connectHint(
      "Waiting for direct connection — direct link connected — waiting for gameplay probe acknowledgements",
      30000,
    ),
    "Connected — syncing the arena…",
  );
  assert.equal(
    connectHint("Direct peer link connected", 0),
    "Connected — syncing the arena…",
  );
  assert.equal(
    connectHint("Signalling disconnected · retrying", 0),
    "Warming up the arena…",
  );
  assert.match(
    connectHint("Waiting for room authority — try again when connected", 21000),
    /Waiting for room authority/,
  );
});

test("a status that already says what to do wins over the network guess", () => {
  for (const status of [
    "Game protocol changed — reload this page",
    "This host tab was replaced — use the newer tab",
    "Saved game is incompatible or damaged — a fresh lobby is ready",
    // Terminal: the transport has stopped retrying, so "different network" would send the player the wrong way.
    "Room full (five players, five spectators and TV)",
  ])
    assert.equal(connectHint(status, 60000), status);
});
