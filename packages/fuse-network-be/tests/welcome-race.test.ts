import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRoomDatabase } from "../src/memory-database.js";
import {
  RoomStore,
  peerId,
  type RoomDatabase,
  type RoomRecord,
} from "../src/room-store.js";
import { RoomGateway, type GatewaySocket } from "../src/gateway.js";
import type { RoomBus } from "../src/room-bus.js";

/**
 * Two instances over one database. A commit's answer can be held back, which is what the network does to Firestore:
 * the write is in and every watcher has heard of it, but the instance that made it has not been told yet.
 */
class SlowAnswerDatabase implements RoomDatabase {
  private readonly memory = new MemoryRoomDatabase();
  /** Set to hold the next transaction's answer until `release` is called. */
  hold = false;
  private waiting: (() => void)[] = [];
  /** Resolves once a held transaction has committed. */
  committed = Promise.resolve();
  read(code: string) {
    return this.memory.read(code);
  }
  transact<T>(
    code: string,
    operation: (current: RoomRecord | undefined) => {
      room?: RoomRecord;
      result: T;
    },
  ): Promise<T> {
    const work = this.memory.transact(code, operation);
    if (!this.hold) return work;
    this.hold = false;
    this.committed = work.then(() => undefined);
    return work.then(
      (result) =>
        new Promise<T>((resolve) => this.waiting.push(() => resolve(result))),
    );
  }
  release() {
    for (const answer of this.waiting.splice(0)) answer();
  }
  watch(
    code: string,
    listener: (room: RoomRecord | undefined) => void,
    failed: (error: Error) => void,
  ) {
    return this.memory.watch(code, listener, failed);
  }
  allowance(key: string, now: number, limit: number, consume?: boolean) {
    return this.memory.allowance(key, now, limit, consume);
  }
}
class QuietBus implements RoomBus {
  async start() {}
  async publish() {}
  async stop() {}
}
class Socket implements GatewaySocket {
  bufferedAmount = 0;
  messages: Record<string, unknown>[] = [];
  closes: number[] = [];
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  close(code: number) {
    this.closes.push(code);
  }
  /** Every member this page has been told is in the room, by the welcome or by a later `peer` frame. */
  known(): string[] {
    const ids = new Set<string>();
    for (const message of this.messages) {
      if (message.type === "welcome")
        for (const peer of message.peers as { id: string }[]) ids.add(peer.id);
      if (message.type === "peer")
        if (message.online) ids.add(message.id as string);
        else ids.delete(message.id as string);
    }
    return [...ids].sort();
  }
}
const CODE = "AB42",
  token = (i: number) => (i + 10).toString(16).repeat(64),
  HOST = token(0),
  FIRST = token(1),
  SECOND = token(2);

test("a member admitted on another instance while this admission's answer was in flight is still announced", async () => {
  let serial = 0;
  const database = new SlowAnswerDatabase(),
    deps = { now: () => 1000, id: () => `id-${++serial}`, error: () => {} },
    gateways = [0, 1].map((i) => {
      const store = new RoomStore(database, deps);
      return {
        store,
        gateway: new RoomGateway(`g${i}`, store, new QuietBus(), deps),
      };
    });
  await gateways[0]!.store.create(CODE, HOST);
  const host = new Socket(),
    first = new Socket(),
    second = new Socket();
  // The creator is on instance 0, so that instance watches the room.
  await gateways[0]!.gateway.connect(CODE, HOST, host);
  // FIRST is admitted on instance 0, but the answer is slow. Meanwhile SECOND is admitted on instance 1, and instance
  // 0's watch hears of it before FIRST's own admission returns.
  database.hold = true;
  const admitted = gateways[0]!.gateway.connect(CODE, FIRST, first);
  // The admission starts behind the gateway's own queue, so wait for it to reach the database and commit. An admission
  // that fails before it gets there fails the test here, rather than leaving it waiting.
  let refused: unknown;
  admitted.catch((error: unknown) => {
    refused = error ?? new Error("admission failed");
  });
  while (database.hold) {
    if (refused) throw refused;
    await new Promise((resolve) => setImmediate(resolve));
  }
  await database.committed;
  await gateways[1]!.gateway.connect(CODE, SECOND, second);
  database.release();
  await admitted;
  assert.deepEqual(
    first.known(),
    [peerId(HOST), peerId(SECOND)].sort(),
    "the page learns of both peers, though its welcome was written before the second joined",
  );
  assert.deepEqual(second.known(), [peerId(HOST), peerId(FIRST)].sort());
  assert.deepEqual(host.known(), [peerId(FIRST), peerId(SECOND)].sort());
  for (const socket of [host, first, second])
    assert.deepEqual(socket.closes, []);
  await Promise.all(gateways.map(({ gateway }) => gateway.stop()));
});
