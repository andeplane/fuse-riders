import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import { RoomStore, peerId } from "../src/room-store.js";
import { RoomGateway, type GatewaySocket } from "../src/gateway.js";
import type { RoomBus, RoutedMessage } from "../src/room-bus.js";

// The room-level signalling allowances were sized for a room of six (docs/design/signalling-abuse-isolation.md).
// A game may seat more, so they grow with the room's membership: these pin the base and the growth.

class Bus implements RoomBus {
  private receive?: (message: RoutedMessage) => Promise<void>;
  published = 0;
  constructor(
    private network: Map<string, Bus>,
    id: string,
  ) {
    network.set(id, this);
  }
  async start(receive: (message: RoutedMessage) => Promise<void>) {
    this.receive = receive;
  }
  async publish(message: RoutedMessage) {
    this.published++;
    await this.network
      .get(message.destination)
      ?.receive?.(structuredClone(message));
  }
  async stop() {
    this.receive = undefined;
  }
}
class Socket implements GatewaySocket {
  bufferedAmount = 0;
  signals = 0;
  closes: number[] = [];
  send(raw: string) {
    if (raw.startsWith('{"type":"signal"')) this.signals++;
  }
  close(code: number) {
    this.closes.push(code);
  }
}
const CODE = "AB42",
  token = (n: number) => n.toString(16).padStart(64, "0");

/** A room of `members` on two instances, alternating, so half of every member's links cross the bus. */
async function room(members: number) {
  let n = 0,
    now = 1000;
  const network = new Map<string, Bus>(),
    store = new RoomStore(new MemoryRoomDatabase(), {
      now: () => now,
      id: () => `id-${++n}`,
      maxGuests: members - 1,
    });
  const gateway = (id: string) => {
    const bus = new Bus(network, id);
    return {
      bus,
      gateway: new RoomGateway(id, store, bus, {
        now: () => now,
        id: () => `id-${++n}`,
        error: () => {},
        schedule: () => () => {},
      }),
    };
  };
  const a = gateway("a"),
    b = gateway("b");
  await store.create(CODE, token(0));
  const seated = [];
  for (let index = 0; index < members; index++) {
    const socket = new Socket(),
      on = index % 2 ? b : a;
    seated.push({
      id: peerId(token(index)),
      socket,
      on,
      connection: await on.gateway.connect(CODE, token(index), socket),
    });
  }
  return {
    a,
    b,
    seated,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
type Seated = Awaited<ReturnType<typeof room>>["seated"][number];
const candidate = (to: Seated, n: number) =>
  JSON.stringify({
    type: "signal",
    to: to.id,
    targetConnectionId: to.connection,
    data: { candidate: { candidate: `candidate:${n}`, sdpMid: "0" } },
  });

for (const [members, allowance] of [
  [6, 512],
  [12, 1024],
] as const)
  test(`a room of ${members} may publish ${allowance} frames to another instance at once, all of them delivered`, async () => {
    const { a, seated } = await room(members);
    const senders = seated.filter((member) => member.on === a),
      targets = seated.filter((member) => member.on !== a);
    // Every member on the first instance negotiates with every member on the second, inside its own allowances
    // (60 a link, under 400 frames a second): far more than the room may put on the bus in one instant.
    for (const sender of senders)
      await Promise.all(
        targets.flatMap((target) =>
          Array.from({ length: 60 }, (_, n) =>
            a.gateway.receive(sender.connection, candidate(target, n)),
          ),
        ),
      );
    assert.ok(senders.length * targets.length * 60 > allowance);
    assert.equal(a.bus.published, allowance);
    assert.equal(
      targets.reduce((total, target) => total + target.socket.signals, 0),
      allowance,
      "the receiving window is as wide as the allowance",
    );
    for (const member of seated) assert.deepEqual(member.socket.closes, []);
  });

for (const [members, closed] of [
  [6, true],
  [12, false],
] as const)
  test(`720 refused frames at once ${closed ? "are a flood in a room of six" : "are within the tolerance of a room of twelve"}`, async () => {
    const { a, seated, advance } = await room(members);
    const [sender, , neighbour] = seated as [Seated, Seated, Seated];
    // The tolerance refills towards what the room has grown to since this member joined it.
    advance(10_000);
    // Of 800 frames at once, the connection's window refuses the second 400 and the link's own allowance all but 80
    // of the first: 720 refusals.
    await Promise.all(
      Array.from({ length: 800 }, (_, n) =>
        a.gateway.receive(sender.connection, candidate(neighbour, n)),
      ),
    );
    if (!closed) assert.equal(neighbour.socket.signals, 80);
    assert.deepEqual(sender.socket.closes, closed ? [1008] : []);
  });
