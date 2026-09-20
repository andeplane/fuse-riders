import {
  type Callbacks,
  type RoomTransport,
  type RuntimeDependencies,
  type TransportEvents,
} from "fuse-netcode";
import {
  CONTROLS,
  packControls,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
  type FuseDriversView,
} from "../../src/game/index.js";
import { FuseDriversRuntime } from "../../src/app/runtime.js";
import { NEUTRAL_INPUT, type TruckInput } from "../../src/game/sim/input.js";

/**
 * The runtime the page itself drives, with the reach into it a test needs.
 *
 * It subclasses the real `FuseDriversRuntime` rather than restating it, so what this mesh proves about steering is
 * proved about the class the page ships: a lookalike here would pass while the shipped one drifted.
 */
export class TestFuseDriversRuntime extends FuseDriversRuntime {
  /**
   * Neutral plus the keys this call names, driven the way a thumb drives: only while this peer is racing, and true
   * when the change actually reached the log.
   */
  steer(input: Partial<TruckInput>): boolean {
    const room = this.roomState();
    if (!room || room.stage !== "running" || !this.player()?.connected)
      return false;
    const before = this.own().entries.size;
    this.drive({ ...NEUTRAL_INPUT, ...input });
    return this.own().entries.size > before;
  }

  /** Every controls bitmask this device has logged, in the order it logged them. */
  loggedControls(): number[] {
    return [...this.own().entries.values()]
      .filter((entry) => entry[2] === CONTROLS)
      .map((entry) => entry[3]);
  }

  /** The three hooks the netcode calls on this device's own lifecycle, which no packet can reach. */
  hidePage(): void {
    this.releaseControls();
  }
  logAbsent(): void {
    this.absentControls();
  }
  freshWorld(): void {
    this.resetControls();
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
