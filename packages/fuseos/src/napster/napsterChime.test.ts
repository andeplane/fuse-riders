import type { ChimeAudioContext, ChimeNode, ChimeParam } from "./napsterChime";
import { CHIME_NOTES, CHIME_SECONDS, createChime } from "./napsterChime";

type Call = { method: string; args: number[] };

class RecordingParam implements ChimeParam {
  constructor(private readonly calls: Call[]) {}
  setValueAtTime(value: number, time: number) {
    this.calls.push({ method: "set", args: [value, time] });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "linear", args: [value, time] });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: "exp", args: [value, time] });
  }
}

class RecordingNode implements ChimeNode {
  connect(node: ChimeNode): ChimeNode {
    return node;
  }
}

class FakeAudio implements ChimeAudioContext {
  readonly currentTime = 10;
  readonly destination = new RecordingNode();
  readonly calls: Call[] = [];
  readonly started: number[] = [];
  readonly frequencies: number[] = [];
  closed = false;
  createGain() {
    return Object.assign(new RecordingNode(), {
      gain: new RecordingParam(this.calls),
    });
  }
  createOscillator() {
    const frequencies = this.frequencies;
    const started = this.started;
    return Object.assign(new RecordingNode(), {
      type: "square" as OscillatorType,
      frequency: {
        setValueAtTime(value: number) {
          frequencies.push(value);
        },
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      start(when: number) {
        started.push(when);
      },
      stop: () => undefined,
    });
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

describe(createChime.name, () => {
  it("plays the three rising notes from now and closes the context afterwards", () => {
    const audio = new FakeAudio();
    const later: { callback: () => void; ms: number }[] = [];
    createChime(
      () => audio,
      (callback, ms) => later.push({ callback, ms }),
    )();
    expect(audio.frequencies).toEqual(
      CHIME_NOTES.map((note) => note.frequency),
    );
    expect(audio.started).toEqual(CHIME_NOTES.map((note) => 10 + note.at));
    expect(later).toHaveLength(1);
    expect(later[0]?.ms).toBe(CHIME_SECONDS * 1000 + 200);
    later[0]?.callback();
    expect(audio.closed).toBe(true);
  });

  it("stays silent without audio, or when audio throws", () => {
    const later = vi.fn();
    createChime(() => undefined, later)();
    createChime(() => {
      throw new Error("no audio for you");
    }, later)();
    expect(later).not.toHaveBeenCalled();
  });
});
