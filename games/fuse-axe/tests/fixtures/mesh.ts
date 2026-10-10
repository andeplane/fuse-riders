import type {
  Callbacks,
  RoomTransport,
  RuntimeDependencies,
  TransportEvents,
} from "fuse-netcode";
import type { Settings, View } from "../../src/online/game.js";
import { AxeRuntime } from "../../src/online/runtime.js";

/** The Fuse Axe runtime as a test drives it: `resync` is what the netcode does to controls when it resets the log. */
export class TestRuntime extends AxeRuntime {
  resync(): void {
    this.resetControls();
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
 * An in-memory room on one injected clock, after the Pig template's mesh: every loop, delivery and timer runs off
 * `now`, so a test is a deterministic sequence of `run(ms)` calls. Reliable messages keep their order per link; fast
 * packets go through `fast`, which may drop, delay (reorder) or duplicate them.
 */
export class Mesh {
  now = 0;
  private order = 0;
  private queue: Delivery[] = [];
  private readonly loops = new Map<string, () => void>();
  private readonly events = new Map<string, TransportEvents>();
  private readonly online = new Set<string>();
  private readonly lastReliable = new Map<string, number>();
  private readonly hidden = new Set<string>();
  private readonly visibility = new Map<string, () => void>();
  private readonly scripted = new Map<
    string,
    (from: string, data: unknown) => void
  >();
  readonly runtimes = new Map<string, TestRuntime>();
  readonly frames = new Map<string, View[]>();
  fast: (from: string, to: string) => FastFate = () => ({ delayMs: 20 });
  constructor(
    readonly hostId: string,
    private readonly settings: Settings,
  ) {}
  private at(ms: number, run: () => void): void {
    this.queue.push({ at: this.now + ms, order: this.order++, run });
  }
  join(id: string): TestRuntime {
    const frames: View[] = [];
    this.frames.set(id, frames);
    const callbacks: Callbacks<View, never, Settings> = {
      state: (frame) => {
        frames.push(frame);
        if (frames.length > 50) frames.shift();
        runtime.flush();
      },
      event: () => {},
      status: () => {},
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
    const runtime = new TestRuntime("ROOM", this.settings, callbacks, {
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
  /**
   * A member with no runtime, which the test speaks for: it hears the reliable messages sent to it through `hear` and
   * answers with `say`. Its fast packets go nowhere.
   */
  script(id: string, hear: (from: string, data: unknown) => void): void {
    this.scripted.set(id, hear);
    this.admit(id);
  }
  say(from: string, to: string, data: unknown): void {
    this.reliable(from, to, data);
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
      this.events.get(id)?.welcome(id, this.hostId);
      for (const other of this.online) {
        if (other === id) continue;
        this.events.get(id)?.peer(other, true);
        this.events.get(other)?.peer(id, true);
        this.events.get(id)?.link(other, true);
        this.events.get(other)?.link(id, true);
      }
    });
  }
  /** Hides or shows a member's page, as the browser's visibility change would. */
  hide(id: string, hidden: boolean): void {
    if (hidden) this.hidden.add(id);
    else this.hidden.delete(id);
    this.visibility.get(id)?.();
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
        if (!this.online.has(to)) return;
        const hear = this.scripted.get(to);
        if (hear) hear(from, copy);
        else this.events.get(to)!.message(from, copy);
      },
    });
    return true;
  }
  private sendFast(from: string, to: string, bytes: Uint8Array): boolean {
    if (!this.online.has(from) || !this.online.has(to)) return false;
    if (this.scripted.has(to)) return true;
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
