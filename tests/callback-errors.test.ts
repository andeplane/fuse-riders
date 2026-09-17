import test from "node:test";
import assert from "node:assert/strict";
import {
  SocketClient,
  type WebSocketLike,
} from "../src/client/socket-client.js";
import { RoomRuntime, type Callbacks } from "../src/online/room-runtime.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import { FakeNetwork, FakeTransport } from "./fixtures/fake-room.js";

/** Synchronous delivery exposes what a browser event boundary reports as an uncaught error. */
class Socket implements WebSocketLike {
  readyState = 0;
  message?: (event: MessageEvent) => void;
  send(): void {}
  close(): void {}
  addEventListener(type: "open", listener: (event: Event) => void): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  addEventListener(type: "close", listener: (event: CloseEvent) => void): void;
  addEventListener(type: "error", listener: (event: Event) => void): void;
  addEventListener(
    type: string,
    listener:
      | ((event: Event) => void)
      | ((event: MessageEvent) => void)
      | ((event: CloseEvent) => void),
  ): void {
    if (type === "message")
      this.message = listener as (event: MessageEvent) => void;
  }
  receive(data: string): void {
    this.message?.(new MessageEvent("message", { data }));
  }
}

test("LAN ignores malformed JSON but exposes UI and RTT errors; later frames still deliver", () => {
  const socket = new Socket();
  const failure = new Error("UI failed"),
    rttFailure = new Error("RTT failed");
  let calls = 0;
  const client = new SocketClient(
    () => undefined,
    () => {
      if (++calls === 1) throw failure;
    },
    () => {},
    () => {
      throw rttFailure;
    },
    () => socket,
  );
  client.connect();
  try {
    assert.doesNotThrow(() => socket.receive("{"));
    assert.throws(
      () => socket.receive('{"type":"status"}'),
      (error) => error === failure,
    );
    assert.throws(
      () => socket.receive('{"type":"pong","sentAt":0}'),
      (error) => error === rttFailure,
    );
    assert.doesNotThrow(() => socket.receive('{"type":"status"}'));
    assert.equal(calls, 2);
  } finally {
    client.close();
  }
});

function solo(callbacks: Callbacks) {
  const net = new FakeNetwork("solo", {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  const errors: { kind: keyof Callbacks; error: unknown }[] = [];
  const runtime = new RoomRuntime("SOLO", defaultRoomSettings(), callbacks, {
    dependencies: net.dependencies("solo"),
    callbackError: (kind, error) => errors.push({ kind, error }),
  });
  return { net, runtime, errors };
}
const quiet: Callbacks = {
  state: () => {},
  ready: () => {},
  status: () => {},
  event: () => {},
};

test("a failed state callback retries the same frame and does not stop scheduled ticks", () => {
  const failure = new Error("frame failed");
  const ticks: number[] = [];
  const f = solo({
    ...quiet,
    state: (frame) => {
      ticks.push(frame.tick);
      if (ticks.length === 1) throw failure;
    },
  });
  try {
    assert.doesNotThrow(() => f.runtime.start());
    f.net.step(10);
    assert.equal(ticks.length, 2);
    assert.equal(ticks[1], ticks[0], "failed frame was not marked delivered");
    f.net.step(500);
    assert.ok(f.runtime.tick > ticks[0]!);
    assert.deepEqual(f.errors, [{ kind: "state", error: failure }]);
  } finally {
    f.runtime.stop();
  }
});

test("ready, status and event failures are reported independently while simulation keeps running", () => {
  const failure = new Error("consumer failed");
  let events = 0;
  const f = solo({
    ...quiet,
    ready: () => {
      throw failure;
    },
    status: () => {
      throw failure;
    },
    event: () => {
      events++;
      throw failure;
    },
  });
  try {
    assert.doesNotThrow(() => f.runtime.start());
    assert.doesNotThrow(() => f.net.step(10_000));
    assert.ok(f.runtime.tick > 150);
    assert.ok(
      events > 1,
      "later events continue after a failed event callback",
    );
    assert.ok(f.errors.some((error) => error.kind === "ready"));
    assert.ok(f.errors.some((error) => error.kind === "status"));
    assert.equal(
      f.errors.filter((error) => error.kind === "event").length,
      events,
    );
  } finally {
    f.runtime.stop();
  }
});

test("ended callback failure is reported after scheduling has been cancelled", () => {
  const net = new FakeNetwork("host", {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  const failure = new Error("ended failed");
  const errors: unknown[] = [];
  const runtime = new RoomRuntime(
    "AB42",
    defaultRoomSettings(),
    {
      ...quiet,
      ended: () => {
        throw failure;
      },
    },
    {
      dependencies: net.dependencies("host"),
      transport: (events) => new FakeTransport(net, "host", events),
      callbackError: (_kind, error) => errors.push(error),
    },
  );
  runtime.start();
  assert.doesNotThrow(() => net.transports.get("host")!.events.ended());
  assert.equal(net.ticks.size, 0);
  assert.deepEqual(errors, [failure]);
  runtime.stop();
});

test("online consumer exceptions do not interrupt peer input delivery or convergence", () => {
  const net = new FakeNetwork("host", {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  const errors: (keyof Callbacks)[] = [];
  const settings = defaultRoomSettings();
  const host = new RoomRuntime(
    "AB42",
    settings,
    {
      ...quiet,
      state: () => {
        throw new Error("renderer unavailable");
      },
      event: () => {
        throw new Error("audio unavailable");
      },
    },
    {
      dependencies: net.dependencies("host"),
      transport: (events) => new FakeTransport(net, "host", events),
      callbackError: (kind) => errors.push(kind),
    },
  );
  const guest = net.add("guest", settings);
  try {
    host.start();
    host.command({ type: "join", name: "Host" });
    net.step(200);
    guest.start();
    guest.command({ type: "join", name: "Guest" });
    net.step(1000);
    host.command({ type: "bot", action: "add" });
    host.command({ type: "action", action: "start" });
    assert.doesNotThrow(() => net.step(10_000));
    assert.ok(errors.includes("state"));
    assert.ok(errors.includes("event"));
    assert.ok(guest.tick > 150);
    assert.equal(guest.metrics().mismatches, 0);
    assert.equal(guest.metrics().streams.host!.gap, false);
    assert.deepEqual(
      host.view(),
      guest.view(),
      "replicas converge despite every host presentation callback failing",
    );
  } finally {
    host.stop();
    guest.stop();
  }
});
