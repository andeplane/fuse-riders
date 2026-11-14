import type {
  SeekAudioContext,
  SeekBuffer,
  SeekNode,
  SeekParam,
} from "./floppySound";
import { createFloppySeek, FLOPPY_SEEK_MS } from "./floppySound";

/** Records the graph the seek builds instead of making sound. */
class FakeParam implements SeekParam {
  value = 0;
  readonly events: string[] = [];
  setValueAtTime(value: number, time: number): void {
    this.events.push(`set ${value}@${time}`);
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push(`ramp ${value}@${time}`);
  }
}

class FakeNode implements SeekNode {
  readonly connections: SeekNode[] = [];
  readonly started: number[] = [];
  readonly stopped: number[] = [];
  connect(node: SeekNode): SeekNode {
    this.connections.push(node);
    return node;
  }
  start(when: number): void {
    this.started.push(when);
  }
  stop(when: number): void {
    this.stopped.push(when);
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam();
}

class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeBufferSource extends FakeNode {
  buffer: SeekBuffer | null = null;
}

class FakeBuffer implements SeekBuffer {
  readonly data: Float32Array;
  constructor(length: number) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeAudioContext implements SeekAudioContext {
  readonly currentTime = 10;
  readonly sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly nodes: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  closed = false;

  createGain(): FakeGain {
    return this.track(new FakeGain());
  }
  createOscillator(): FakeOscillator {
    return this.track(new FakeOscillator());
  }
  createBiquadFilter(): FakeFilter {
    return this.track(new FakeFilter());
  }
  createBufferSource(): FakeBufferSource {
    return this.track(new FakeBufferSource());
  }
  createBuffer(_channels: number, length: number): FakeBuffer {
    const buffer = new FakeBuffer(length);
    this.buffers.push(buffer);
    return buffer;
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  private track<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

/** A context whose oscillator breaks half way through building the graph. */
class BrokenAudioContext extends FakeAudioContext {
  override createOscillator(): FakeOscillator {
    throw new Error("mid-way");
  }
}

describe(createFloppySeek.name, () => {
  it("builds a hum, nine head steps and waits the seek time, then closes the context", async () => {
    const context = new FakeAudioContext();
    const waits: number[] = [];
    const seek = createFloppySeek(
      () => context,
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    await seek();
    expect(waits).toEqual([FLOPPY_SEEK_MS]);
    const oscillators = context.nodes.filter(
      (node) => node instanceof FakeOscillator,
    );
    const sources = context.nodes.filter(
      (node) => node instanceof FakeBufferSource,
    );
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.started).toEqual([10]);
    expect(oscillators[0]?.stopped).toEqual([11.4]);
    expect(sources).toHaveLength(9);
    expect(sources.every((source) => source.started.length === 1)).toBe(true);
    expect(sources.every((source) => source.buffer !== null)).toBe(true);
    expect(context.buffers).toHaveLength(1);
    // The noise is deterministic and spans the full range.
    const data = context.buffers[0]?.data ?? new Float32Array();
    expect(data.length).toBe(Math.ceil(8000 * 0.06));
    expect(Math.max(...data)).toBeGreaterThan(0.5);
    expect(Math.min(...data)).toBeLessThan(-0.5);
    expect(context.closed).toBe(true);
  });

  it("still waits when there is no audio, or the context cannot be made or played", async () => {
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await createFloppySeek(() => undefined, wait)();
    await createFloppySeek(() => {
      throw new Error("no audio");
    }, wait)();
    const broken = new BrokenAudioContext();
    await createFloppySeek(() => broken, wait)();
    expect(waits).toEqual([FLOPPY_SEEK_MS, FLOPPY_SEEK_MS, FLOPPY_SEEK_MS]);
    expect(broken.closed).toBe(true);
  });
});
