import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGameServer } from "../src/server/index.js";
import { eliminatePlayer } from "../src/shared/game.js";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/protocol.js";
class Peer {
  private queued: ServerMessage[] = [];
  private notify?: () => void;
  constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      this.queued.push(JSON.parse(String(raw)) as ServerMessage);
      this.notify?.();
    });
  }
  send(message: ClientMessage) {
    this.socket.send(JSON.stringify(message));
  }
  async take<T extends ServerMessage["type"]>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () =>
      true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    while (true) {
      const index = this.queued.findIndex(
        (message) =>
          message.type === type &&
          predicate(message as Extract<ServerMessage, { type: T }>),
      );
      if (index >= 0)
        return this.queued.splice(index, 1)[0] as Extract<
          ServerMessage,
          { type: T }
        >;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Missing ${type}`)),
          2000,
        );
        this.notify = () => {
          clearTimeout(timer);
          this.notify = undefined;
          resolve();
        };
      });
    }
  }
}
async function fixture() {
  let nonce = 0;
  const app = await createGameServer({
      port: 0,
      hostname: "127.0.0.1",
      manualTicks: true,
      dependencies: {
        token: () => `${++nonce}`.padStart(48, "0"),
        botRandom: () => 0.25,
      },
    }),
    peers: Peer[] = [];
  const connect = async () => {
    const peer = new Peer(
      new WebSocket(`ws://127.0.0.1:${app.port}/ws`, {
        origin: `http://127.0.0.1:${app.port}`,
      }),
    );
    peers.push(peer);
    await once(peer.socket, "open");
    await peer.take("snapshot");
    return peer;
  };
  return {
    app,
    connect,
    close: async () => {
      peers.forEach((peer) => peer.socket.terminate());
      await app.close();
    },
  };
}
test("LAN AI management is authorized, shares seats, follows normal rounds and can be removed", async () => {
  const f = await fixture();
  try {
    const host = await f.connect(),
      human = await f.connect();
    human.send({ type: "hostBot", action: "add" });
    assert.equal((await human.take("error")).code, "unauthorized");
    host.send({ type: "hostAuth", token: f.app.hostToken });
    await host.take("hostAuthenticated");
    host.send({ type: "hostBot", action: "add" });
    await host.take("snapshot", (m) => m.state.players.length === 1);
    human.send({ type: "join", name: "Solo human" });
    const joined = await human.take("joined");
    assert.equal(joined.slot, 1);
    host.send({ type: "hostAction", action: "start" });
    await host.take("snapshot", (m) => m.state.phase === "countdown");
    host.send({ type: "hostBot", action: "remove", id: "bot:1" });
    assert.equal((await host.take("error")).code, "invalid_phase");
    f.app.advance(60);
    const before = f.app.game.players.get("bot:1")!.x;
    f.app.advance(1);
    assert.notEqual(f.app.game.players.get("bot:1")!.x, before);
    host.send({ type: "hostBot", action: "add" });
    await host.take("snapshot", (m) => m.state.players.length === 3);
    assert.equal(f.app.game.players.get("bot:2")!.alive, false);
    host.send({ type: "hostAction", action: "lobby" });
    await host.take(
      "snapshot",
      (m) => m.state.phase === "lobby" && m.state.players.length === 3,
    );
    host.send({ type: "hostBot", action: "remove", id: "bot:1" });
    await host.take(
      "snapshot",
      (m) =>
        m.state.phase === "lobby" &&
        m.state.players.length === 2 &&
        !m.state.players.some((p) => p.id === "bot:1"),
    );
    assert.equal(f.app.game.players.has("bot:1"), false);
    host.send({ type: "hostBot", action: "remove", id: "bot:999" });
    assert.equal((await host.take("error")).code, "invalid_message");
    for (let i = 0; i < 3; i++) {
      host.send({ type: "hostBot", action: "add" });
      await host.take("snapshot", (m) => m.state.players.length === 3 + i);
    }
    host.send({ type: "hostBot", action: "add" });
    assert.equal((await host.take("error")).code, "full");
  } finally {
    await f.close();
  }
});
test("LAN loop runs three ticks per 50 ms once only AI riders survive, and drops back when the round ends", async () => {
  let now = 0;
  const tasks = new Map<number, () => void>();
  const app = await createGameServer({
    port: 0,
    hostname: "127.0.0.1",
    dependencies: {
      now: () => now,
      botRandom: () => 0.25,
      schedule: (callback, interval) => {
        tasks.set(interval, callback);
        return () => {
          tasks.delete(interval);
        };
      },
    },
  });
  const peers: Peer[] = [];
  try {
    const connect = async () => {
      const peer = new Peer(
        new WebSocket(`ws://127.0.0.1:${app.port}/ws`, {
          origin: `http://127.0.0.1:${app.port}`,
        }),
      );
      peers.push(peer);
      await once(peer.socket, "open");
      await peer.take("snapshot");
      return peer;
    };
    const host = await connect(),
      human = await connect();
    host.send({ type: "hostAuth", token: app.hostToken });
    await host.take("hostAuthenticated");
    for (let i = 0; i < 2; i++) {
      host.send({ type: "hostBot", action: "add" });
      await host.take("snapshot", (m) => m.state.players.length === 1 + i);
    }
    human.send({ type: "join", name: "Human" });
    const joined = await human.take("joined");
    host.send({ type: "hostAction", action: "start" });
    await host.take("snapshot", (m) => m.state.phase === "countdown");
    const run = tasks.get(10)!,
      pass = (ms: number) => {
        now += ms;
        run();
      };
    while (app.game.phase !== "playing") pass(50);
    let tick = app.game.tick;
    pass(50);
    assert.equal(app.game.tick, tick + 1, "normal pace while the human rides");
    eliminatePlayer(app.game, joined.playerId);
    tick = app.game.tick;
    pass(50);
    assert.equal(app.game.tick, tick + 3);
    for (const id of ["bot:1", "bot:2"]) eliminatePlayer(app.game, id);
    pass(50);
    assert.notEqual(app.game.phase, "playing");
    tick = app.game.tick;
    pass(50);
    assert.equal(app.game.tick, tick + 1, "round over runs at normal pace");
  } finally {
    peers.forEach((peer) => peer.socket.terminate());
    await app.close();
  }
});
test("LAN bot protocol rejects missing IDs, human IDs and unexpected action data", () => {
  assert.deepEqual(parseClientMessage('{"type":"hostBot","action":"add"}'), {
    type: "hostBot",
    action: "add",
  });
  assert.deepEqual(
    parseClientMessage('{"type":"hostBot","action":"remove","id":"bot:1"}'),
    { type: "hostBot", action: "remove", id: "bot:1" },
  );
  for (const data of [
    { action: "remove" },
    { action: "remove", id: "human" },
    { action: "add", id: "bot:1" },
    { action: "add", admin: true },
    { action: "other" },
  ])
    assert.equal(
      parseClientMessage(JSON.stringify({ type: "hostBot", ...data })),
      null,
    );
});
