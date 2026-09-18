import test from "node:test";
import assert from "node:assert/strict";
import {
  RoomStore,
  ROOM_TTL_MS,
  peerId,
} from "../../../packages/fuse-network-be/src/room-store.js";
import {
  MemoryRoomDatabase,
  LocalRoomBus,
} from "../../../packages/fuse-network-be/src/memory-database.js";
import {
  RoomGateway,
  type GatewaySocket,
} from "../../../packages/fuse-network-be/src/gateway.js";
import { FakeNetwork } from "./fixtures/fake-room.js";
import { defaultRoomSettings } from "../src/engine/room-settings.js";

const HOST = "a".repeat(64),
  GUEST = "b".repeat(64),
  CODE = "AB42";
class Socket implements GatewaySocket {
  bufferedAmount = 0;
  messages: Record<string, unknown>[] = [];
  closes: number[] = [];
  send(raw: string): void {
    this.messages.push(JSON.parse(raw));
  }
  close(code: number): void {
    this.closes.push(code);
  }
}

test("guest keeps signalling and world alive beyond creator grace; returning creator recovers peer world", async () => {
  const hostId = peerId(HOST),
    guestId = peerId(GUEST);
  const net = new FakeNetwork(hostId, {
    loss: 0,
    baseMs: 20,
    jitterMs: 0,
    reliableMs: 30,
  });
  let serial = 0;
  const deps = {
    now: () => net.now,
    id: () => `connection-${++serial}`,
    error: () => {},
  };
  const store = new RoomStore(new MemoryRoomDatabase(), deps);
  const gateway = new RoomGateway("local", store, new LocalRoomBus(), deps);
  const hostSocket = new Socket(),
    guestSocket = new Socket();
  const settings = defaultRoomSettings();
  await store.create(CODE, HOST);
  const hostConnection = await gateway.connect(CODE, HOST, hostSocket);
  const guestConnection = await gateway.connect(CODE, GUEST, guestSocket);
  const join = (id: string, name: string) => {
    const runtime = net.add(id, settings);
    runtime.start();
    runtime.command({ type: "join", name });
    return runtime;
  };
  try {
    const host = join(hostId, "Host");
    net.step(200);
    const guest = join(guestId, "Guest");
    net.step(1200);
    host.command({ type: "bot", action: "add" });
    host.command({ type: "action", action: "start" });
    net.step(1000);
    const matchId = net.frame(guestId)!.matchId;
    const initialTick = guest.tick;
    host.stop();
    await gateway.disconnect(hostConnection);
    const departedAt = net.now;
    for (let i = 0; i < 7; i++) {
      net.step(20_000);
      await gateway.receive(
        guestConnection,
        JSON.stringify({ type: "time", id: i, sentAt: net.now }),
      );
      assert.deepEqual(
        guestSocket.closes,
        [],
        "live guest socket must survive the old room expiry",
      );
    }
    assert.ok(net.now - departedAt > ROOM_TTL_MS);
    assert.ok(
      guest.tick > initialTick + ROOM_TTL_MS / 50,
      "world ticks keep advancing past the creator grace",
    );
    assert.equal(net.frame(guestId)!.matchId, matchId);
    const returningSocket = new Socket();
    const returningConnection = await gateway.connect(
      CODE,
      HOST,
      returningSocket,
    );
    assert.ok(returningConnection);
    await gateway.receive(
      guestConnection,
      JSON.stringify({
        type: "signal",
        to: hostId,
        targetConnectionId: returningConnection,
        data: { description: { type: "offer", sdp: "v=0" } },
      }),
    );
    assert.ok(
      returningSocket.messages.some((message) => message.type === "signal"),
      "service still routes signalling after original expiry",
    );
    const returned = net.reload(hostId, settings);
    returned.command({ type: "join", name: "Host" });
    net.step(3000);
    assert.equal(
      net.frame(hostId)!.matchId,
      matchId,
      "creator installs retained peer match instead of new lobby",
    );
    assert.ok(returned.tick > initialTick + ROOM_TTL_MS / 50);
    assert.equal(
      net.frame(hostId)!.players.find((player) => player.id === hostId)
        ?.connected,
      true,
    );
    assert.ok(
      net.reliableLog.some(
        (message) =>
          message.from === guestId &&
          message.to === hostId &&
          message.type === "snapshot",
      ),
    );
  } finally {
    for (const runtime of net.runtimes.values()) runtime.stop();
    await gateway.stop();
  }
});
