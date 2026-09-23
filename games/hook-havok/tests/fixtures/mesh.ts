import type { RoomTransport, TransportEvents } from "fuse-netcode";
import { HookRuntime } from "../../src/online/runtime.js";
import { DEFAULT_TUNING } from "../../src/engine/world.js";

export class TestRuntime extends HookRuntime {
  state() {
    return this.world?.state;
  }
  hashAt(tick: number) {
    return this.world?.hashAt(tick);
  }
}
/** Injected clock/transport, ordered reliable messages, configurable loss/reorder/duplicates. */
export class Mesh {
  now = 0;
  private order = 0;
  private queue: { at: number; order: number; run(): void }[] = [];
  private loops = new Map<string, () => void>();
  private events = new Map<string, TransportEvents>();
  private online = new Set<string>();
  private generations = new Map<string, number>();
  private reliableAt = new Map<string, number>();
  fast: (
    from: string,
    to: string,
  ) => { drop?: boolean; delay?: number; duplicate?: number } = () => ({
    delay: 20,
  });
  readonly runtimes = new Map<string, TestRuntime>();
  constructor(readonly creator = "a") {}
  private at(delay: number, run: () => void) {
    this.queue.push({ at: this.now + delay, order: this.order++, run });
  }
  join(id: string): TestRuntime {
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    const runtime = new TestRuntime(
      "HOOK",
      DEFAULT_TUNING,
      { ready() {}, state() {}, event() {}, status() {} },
      {
        dependencies: {
          now: () => this.now,
          hidden: () => false,
          token: () => `token-${this.order++}`,
          generation: () => generation,
          schedule: (loop) => {
            this.loops.set(id, loop);
            return () => this.loops.delete(id);
          },
          onVisibilityChange: () => () => {},
        },
        transport: (events) => {
          this.events.set(id, events);
          return this.transport(id);
        },
      },
    );
    this.runtimes.set(id, runtime);
    runtime.start();
    return runtime;
  }
  private transport(id: string): RoomTransport {
    return {
      id,
      hostId: this.creator,
      sentBytes: 0,
      connect: () => {
        this.online.add(id);
        this.at(0, () => {
          this.events.get(id)!.welcome(id, this.creator);
          for (const peer of this.online)
            if (peer !== id) {
              this.events.get(id)!.peer(peer, true);
              this.events.get(peer)!.peer(id, true);
              this.events.get(id)!.link(peer, true);
              this.events.get(peer)!.link(id, true);
            }
        });
      },
      close: () => {
        this.online.delete(id);
        this.loops.delete(id);
        for (const peer of this.online)
          this.at(0, () => this.events.get(peer)?.peer(id, false));
      },
      linked: (to) => this.online.has(id) && this.online.has(to),
      explain: () => "test link",
      stats: async () => ({ direct: 0, relayed: 0, buffered: 0 }),
      send: (to, data) => {
        if (!this.online.has(to) || !this.online.has(id)) return false;
        const key = `${id}>${to}`,
          at = Math.max(this.now + 15, this.reliableAt.get(key) ?? 0),
          targetGeneration = this.generations.get(to),
          copy: unknown = structuredClone(data);
        this.reliableAt.set(key, at);
        this.at(at - this.now, () => {
          if (
            this.online.has(to) &&
            this.generations.get(to) === targetGeneration
          )
            this.events.get(to)!.message(id, copy);
        });
        return true;
      },
      sendFast: (to, data) => {
        if (!this.online.has(to) || !this.online.has(id)) return false;
        const fate = this.fast(id, to),
          targetGeneration = this.generations.get(to),
          copy = data.slice();
        if (fate.drop) return true;
        const deliver = () => {
          if (
            this.online.has(to) &&
            this.generations.get(to) === targetGeneration
          )
            this.events.get(to)!.fast(id, copy);
        };
        this.at(fate.delay ?? 20, deliver);
        if (fate.duplicate !== undefined) this.at(fate.duplicate, deliver);
        return true;
      },
    };
  }
  run(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 10;
      this.flush();
      for (const loop of [...this.loops.values()]) loop();
      this.flush();
    }
  }
  private flush() {
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
      if (!this.queue[0] || this.queue[0].at > this.now) return;
      this.queue.shift()!.run();
    }
  }
}
