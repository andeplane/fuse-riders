import {
  RoomRuntime,
  type Callbacks,
  type RoomTransport,
  type RuntimeDependencies,
  type TransportEvents,
} from "fuse-netcode";
import {
  CONTROLS,
  fuseDriversGame,
  packControls,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
  type FuseDriversView,
} from "../../src/game/index.js";
import { NEUTRAL_INPUT, type TruckInput } from "../../src/game/sim/input.js";

/** The racing runtime as a test drives it: a driver logs a change of controls and nothing while they hold. */
export class TestFuseDriversRuntime extends RoomRuntime<
  FuseDriversRoom,
  FuseDriversEntry,
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
> {
  private held = -1;
  drive(input: Partial<TruckInput>): boolean {
    const room = this.world?.state;
    if (!room || room.stage !== "running" || !this.player()?.connected)
      return false;
    const bits = packControls({ ...NEUTRAL_INPUT, ...input });
    if (bits === this.held) return false;
    this.held = bits;
    this.append(CONTROLS, bits);
    return true;
  }
  roomState(): FuseDriversRoom | undefined {
    return this.world?.state;
  }
  hashAt(tick: number): string | undefined {
    return this.world?.hashAt(tick);
  }
}

/** What happens to one fast packet: delivered after `delayMs` (and again after `duplicateMs`), or dropped. */
export type FastFate =
  { drop: true } | { drop?: false; delayMs: number; duplicateMs?: number };
interface Delivery {
  at: number;
  order: number;
  run: () => void;
}

/**
 * An in-memory room on one injected clock, after fuse-netcode's own test mesh: every loop, delivery and timer runs off
 * `now`, so a test is a deterministic sequence of `run(ms)` calls. Reliable messages keep their order per link; fast
 * packets go through `fast`, which may drop, delay (reorder) or duplicate them.
 */
export class FuseDriversMesh {
  now = 0;
  private order = 0;
  private queue: Delivery[] = [];
  private readonly loops = new Map<string, () => void>();
  private readonly events = new Map<string, TransportEvents>();
  private readonly online = new Set<string>();
  private readonly lastReliable = new Map<string, number>();
  readonly runtimes = new Map<string, TestFuseDriversRuntime>();
  readonly emitted = new Map<string, FuseDriversEvent[]>();
  fast: (from: string, to: string) => FastFate = () => ({ delayMs: 20 });
  constructor(
    readonly hostId: string,
    private readonly settings: FuseDriversSettings,
  ) {}
  private at(ms: number, run: () => void): void {
    this.queue.push({ at: this.now + ms, order: this.order++, run });
  }
  join(id: string): TestFuseDriversRuntime {
    const emitted: FuseDriversEvent[] = [];
    this.emitted.set(id, emitted);
    const callbacks: Callbacks<
      FuseDriversView,
      FuseDriversEvent,
      FuseDriversSettings
    > = {
      state: () => {},
      event: (event) => emitted.push(event),
      status: () => {},
      ready: () => {},
    };
    const dependencies: RuntimeDependencies = {
      now: () => this.now,
      hidden: () => false,
      token: () => `token-${this.order++}`,
      generation: () => 1,
      schedule: (callback) => {
        this.loops.set(id, callback);
        return () => this.loops.delete(id);
      },
      onVisibilityChange: () => () => {},
    };
    const runtime = new TestFuseDriversRuntime(
      fuseDriversGame,
      "ROOM",
      this.settings,
      callbacks,
      {
        dependencies,
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
      hostId: this.hostId,
      sentBytes: 0,
      connect: () => this.admit(id),
      close: () => this.leave(id),
      send: (to, data) => this.reliable(id, to, data),
      sendFast: (to, bytes) => this.sendFast(id, to, bytes),
      linked: (to) => this.online.has(id) && this.online.has(to),
      explain: () => "fake link",
      stats: async () => ({ direct: 0, relayed: 0, buffered: 0 }),
    };
  }
  private admit(id: string): void {
    this.online.add(id);
    this.at(0, () => {
      this.events.get(id)!.welcome(id, this.hostId);
      for (const other of this.online) {
        if (other === id) continue;
        this.events.get(id)!.peer(other, true);
        this.events.get(other)!.peer(id, true);
        this.events.get(id)!.link(other, true);
        this.events.get(other)!.link(id, true);
      }
    });
  }
  leave(id: string): void {
    if (!this.online.delete(id)) return;
    this.loops.delete(id);
    for (const other of this.online)
      this.at(0, () => this.events.get(other)?.peer(id, false));
  }
  private reliable(from: string, to: string, data: unknown): boolean {
    if (!this.online.has(from) || !this.online.has(to)) return false;
    const copy: unknown = structuredClone(data);
    const key = `${from}>${to}`,
      at = Math.max(this.now + 15, this.lastReliable.get(key) ?? 0);
    this.lastReliable.set(key, at);
    this.queue.push({
      at,
      order: this.order++,
      run: () => {
        if (this.online.has(to)) this.events.get(to)!.message(from, copy);
      },
    });
    return true;
  }
  private sendFast(from: string, to: string, bytes: Uint8Array): boolean {
    if (!this.online.has(from) || !this.online.has(to)) return false;
    const fate = this.fast(from, to);
    if (fate.drop) return true;
    const copy = bytes.slice();
    const deliver = () => {
      if (this.online.has(to)) this.events.get(to)!.fast(from, copy);
    };
    this.at(fate.delayMs, deliver);
    if (fate.duplicateMs !== undefined) this.at(fate.duplicateMs, deliver);
    return true;
  }
  /** Advances the shared clock in 10 ms steps: deliveries due, then every member's loop. */
  run(ms: number, each?: () => void): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 10;
      this.flush();
      for (const loop of [...this.loops.values()]) loop();
      this.flush();
      each?.();
    }
  }
  private flush(): void {
    for (;;) {
      const due = this.queue
        .filter((delivery) => delivery.at <= this.now)
        .sort((a, b) => a.at - b.at || a.order - b.order)[0];
      if (!due) return;
      this.queue.splice(this.queue.indexOf(due), 1);
      due.run();
    }
  }
}
