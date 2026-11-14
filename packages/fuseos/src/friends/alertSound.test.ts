import { createUhOhSound, defaultAudioContextFactory } from "./alertSound";

type Scheduled = { frequency: number; start: number; stop: number };

/** Just enough of the Web Audio API to see what the alert schedules. */
function fakeAudioContext(state: AudioContextState = "running") {
  const scheduled: Scheduled[] = [];
  const resume = vi.fn(async () => undefined);
  const destination = {} as AudioDestinationNode;
  const context = {
    state,
    currentTime: 10,
    destination,
    resume,
    createGain: () => {
      const node = {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: (target: unknown) => target,
      };
      return node as unknown as GainNode;
    },
    createOscillator: () => {
      const entry: Scheduled = { frequency: 0, start: 0, stop: 0 };
      scheduled.push(entry);
      const node = {
        type: "sine",
        frequency: {
          set value(v: number) {
            entry.frequency = v;
          },
        },
        connect: (target: unknown) => target,
        start: (at: number) => {
          entry.start = at;
        },
        stop: (at: number) => {
          entry.stop = at;
        },
      };
      return node as unknown as OscillatorNode;
    },
  };
  return { context: context as unknown as AudioContext, scheduled, resume };
}

describe(createUhOhSound.name, () => {
  it("plays two descending square tones on one shared context, resuming a suspended one", () => {
    const fake = fakeAudioContext("suspended");
    const factory = vi.fn(() => fake.context);
    const play = createUhOhSound(factory);
    play();
    play();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.resume).toHaveBeenCalledTimes(2);
    expect(fake.scheduled.map((s) => s.frequency)).toEqual([
      660, 440, 660, 440,
    ]);
    const [high, low] = fake.scheduled;
    expect(high!.start).toBe(10);
    expect(low!.start).toBeGreaterThan(high!.start);
    expect(low!.stop).toBeGreaterThan(low!.start);
  });

  it("stays silent without an audio context or when the context throws", () => {
    expect(() => createUhOhSound(() => undefined)()).not.toThrow();
    expect(() =>
      createUhOhSound(() => {
        throw new Error("no audio");
      })(),
    ).not.toThrow();
  });

  it("has a default factory that yields nothing where AudioContext is missing", () => {
    expect(typeof defaultAudioContextFactory).toBe("function");
    const result = defaultAudioContextFactory();
    expect(result === undefined || typeof result === "object").toBe(true);
  });
});
