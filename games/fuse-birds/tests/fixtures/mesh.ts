import {
  type Callbacks,
  type RoomTransport,
  type RuntimeDependencies,
  type TransportEvents,
} from "fuse-netcode";
import { BirdsRuntime } from "../../src/online/runtime.js";
import {
  type BirdsRoom,
  type BirdsSettings,
  type BirdsView,
} from "../../src/online/game.js";
import { type Fact } from "../../src/engine/index.js";

/** Read-only test accessors, matching the shared runtime fixture's public observation pattern. */
export class TestBirdsRuntime extends BirdsRuntime {
  roomState(): BirdsRoom | undefined {
    return this.world?.state;
  }
  hashAt(tick: number): string | undefined {
    return this.world?.hashAt(tick);
  }
}
export type FastFate =
  { drop: true } | { drop?: false; delayMs: number; duplicateMs?: number };
interface Delivery {
  at: number;
  order: number;
  run: () => void;
}
export interface Recorded {
  events: { event: Fact; matchId: string; round: number }[];
  statuses: string[];
  frames: number;
}

/**
 * An in-memory room with one injected clock: every member's loop, every delivery and every timer runs off `now`, so a
 * test is a deterministic sequence of `run(ms)` calls. Reliable messages are ordered per link; fast packets go through
 * `fast`, which may drop, delay (reorder) or duplicate them. `snapshot` may rewrite a snapshot chunk in flight.
 */
export class BirdsMesh {
  now = 0;
  /** Deterministic application-payload rate for exercising large snapshot recovery. */
  reliableBytesPerSecond = Infinity;
  private order = 0;
  private queue: Delivery[] = [];
  private readonly loops = new Map<string, () => void>();
  private readonly events = new Map<string, TransportEvents>();
  private readonly online = new Set<string>();
  private readonly lastReliable = new Map<string, number>();
  private readonly hidden = new Set<string>();
  private readonly visibility = new Map<string, () => void>();
  readonly runtimes = new Map<string, TestBirdsRuntime>();
  readonly recorded = new Map<string, Recorded>();
  fast: (from: string, to: string, sent: number) => FastFate = () => ({
    delayMs: 20,
  });
  snapshot: (chunk: { data: string; chunk: number }, to: string) => void =
    () => {};
  sentFast = 0;
  constructor(
    readonly hostId: string,
    private readonly settings: BirdsSettings = { display: false },
  ) {}
  private at(ms: number, run: () => void): void {
    this.queue.push({ at: this.now + ms, order: this.order++, run });
  }
  /** Creates a member's runtime on this mesh and starts it; it is admitted on the next pass. */
  join(id: string): TestBirdsRuntime {
    const recorded: Recorded = { events: [], statuses: [], frames: 0 };
    this.recorded.set(id, recorded);
    const callbacks: Callbacks<BirdsView, Fact, BirdsSettings> = {
      state: () => {
        recorded.frames++;
      },
      event: (event, matchId, round) =>
        recorded.events.push({ event, matchId, round }),
      status: (text) => recorded.statuses.push(text),
      ready: () => {},
    };
    const dependencies: RuntimeDependencies = {
      now: () => this.now,
      hidden: () => this.hidden.has(id),
      token: () => `token-${this.order++}`,
      generation: () => 1,
      schedule: (callback) => {
        this.loops.set(id, callback);
        return () => this.loops.delete(id);
      },
      onVisibilityChange: (callback) => {
        this.visibility.set(id, callback);
        return () => this.visibility.delete(id);
      },
    };
    const runtime = new TestBirdsRuntime("ROOM", this.settings, callbacks, {
      dependencies,
      transport: (events) => {
        this.events.set(id, events);
        return this.transport(id);
      },
    });
    this.runtimes.set(id, runtime);
    runtime.start();
    return runtime;
  }
  private transport(id: string): RoomTransport {
    const mesh = this;
    return {
      id,
      hostId: this.hostId,
      sentBytes: 0,
      connect: () => mesh.admit(id),
      close: () => mesh.leave(id),
      send: (to, data) => mesh.reliable(id, to, data),
      sendFast: (to, bytes) => mesh.sendFast(id, to, bytes),
      linked: (to) => mesh.online.has(id) && mesh.online.has(to),
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
  /** The member's page is hidden or shown again, as a tab switch would. */
  setHidden(id: string, hidden: boolean): void {
    if (hidden) this.hidden.add(id);
    else this.hidden.delete(id);
    this.visibility.get(id)?.();
  }
  /** The member's page goes away: its loop stops and every other member hears it leave. */
  leave(id: string): void {
    if (!this.online.delete(id)) return;
    this.loops.delete(id);
    for (const other of this.online)
      this.at(0, () => this.events.get(other)?.peer(id, false));
  }
  private reliable(from: string, to: string, data: unknown): boolean {
    if (!this.online.has(from) || !this.online.has(to)) return false;
    const copy = structuredClone(data) as { type?: string };
    if (copy?.type === "snapshot")
      this.snapshot(copy as { data: string; chunk: number }, to);
    const key = `${from}>${to}`,
      at =
        Math.max(this.now + 15, this.lastReliable.get(key) ?? 0) +
        (JSON.stringify(copy).length * 1000) / this.reliableBytesPerSecond;
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
    const fate = this.fast(from, to, ++this.sentFast);
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
  run(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now += 10;
      this.flush();
      for (const loop of [...this.loops.values()]) loop();
      this.flush();
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
