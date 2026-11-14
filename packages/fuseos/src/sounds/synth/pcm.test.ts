import {
  applyEnvelope,
  at,
  biquad,
  goertzel,
  normalize,
  PcmTrack,
  peak,
  renderBandNoise,
  renderNoise,
  renderTone,
  rms,
  sameSamples,
  scale,
  seededRandom,
} from "./pcm";

const RATE = 8000;

describe(seededRandom.name, () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });
});

describe(renderTone.name, () => {
  it("renders the asked frequency at the asked amplitude", () => {
    const tone = renderTone(RATE, {
      freq: 440,
      start: 0,
      duration: 0.5,
      amp: 0.5,
    });
    expect(tone).toHaveLength(4000);
    expect(peak(tone)).toBeCloseTo(0.5, 2);
    const hit = goertzel(tone, RATE, 440, 400, 3600).power;
    const miss = goertzel(tone, RATE, 1000, 400, 3600).power;
    expect(hit).toBeGreaterThan(miss * 1000);
  });

  it("fades in and out so it cannot click, and decays when asked", () => {
    const tone = renderTone(RATE, {
      freq: 100,
      start: 0,
      duration: 0.2,
      amp: 1,
      attack: 0.05,
      release: 0.05,
    });
    expect(Math.abs(tone[0] ?? 1)).toBe(0);
    expect(Math.abs(tone[tone.length - 1] ?? 1)).toBe(0);
    const struck = renderTone(RATE, {
      freq: 100,
      start: 0,
      duration: 1,
      amp: 1,
      decay: 0.1,
    });
    expect(peak(struck, 0, at(RATE, 0.1))).toBeGreaterThan(
      peak(struck, at(RATE, 0.8), struck.length) * 20,
    );
  });
});

describe(PcmTrack.name, () => {
  it("mixes signals at a time and clips to its own length", () => {
    const track = new PcmTrack(RATE, 0.5);
    track.add(0.4, new Float32Array(2000).fill(0.25));
    track.add(-0.1, new Float32Array(1600).fill(0.5), 2);
    expect(track.samples).toHaveLength(4000);
    expect(track.samples[0]).toBe(1);
    expect(track.samples[799]).toBe(1);
    expect(track.samples[800]).toBe(0);
    expect(track.samples[3200]).toBe(0.25);
    expect(track.samples[3999]).toBe(0.25);
  });

  it("ramps gain between two moments", () => {
    const track = new PcmTrack(RATE, 1);
    track.samples.fill(1);
    track.ramp(0, 0.5, 0, 1);
    expect(track.samples[0]).toBe(0);
    expect(track.samples[2000] ?? 0).toBeCloseTo(0.5, 2);
    expect(track.samples[4000]).toBe(1);
    expect(track.samples[7999]).toBe(1);
  });
});

describe(applyEnvelope.name, () => {
  it("never fades more than the whole buffer", () => {
    const samples = new Float32Array(10).fill(1);
    applyEnvelope(samples, RATE, 10, 10);
    expect(samples[0]).toBe(0);
    expect(samples[9]).toBe(0);
    expect(samples[5] ?? 0).toBeGreaterThan(0);
  });
});

describe(biquad.name, () => {
  it("low-pass keeps the bass and drops the treble", () => {
    const lp = biquad("lowpass", 500, 0.707, RATE);
    const low = lp(
      renderTone(RATE, { freq: 100, start: 0, duration: 1, amp: 1 }),
    );
    const high = lp(
      renderTone(RATE, { freq: 3000, start: 0, duration: 1, amp: 1 }),
    );
    expect(rms(low, 1000)).toBeGreaterThan(0.6);
    expect(rms(high, 1000)).toBeLessThan(0.05);
  });

  it("high-pass and band-pass do the opposite and the middle", () => {
    const hp = biquad("highpass", 1000, 0.707, RATE);
    expect(
      rms(
        hp(renderTone(RATE, { freq: 100, start: 0, duration: 1, amp: 1 })),
        1000,
      ),
    ).toBeLessThan(0.05);
    expect(
      rms(
        hp(renderTone(RATE, { freq: 3000, start: 0, duration: 1, amp: 1 })),
        1000,
      ),
    ).toBeGreaterThan(0.6);
    const bp = biquad("bandpass", 1000, 2, RATE);
    const centre = rms(
      bp(renderTone(RATE, { freq: 1000, start: 0, duration: 1, amp: 1 })),
      1000,
    );
    const edge = rms(
      bp(renderTone(RATE, { freq: 200, start: 0, duration: 1, amp: 1 })),
      1000,
    );
    expect(centre).toBeGreaterThan(edge * 5);
  });
});

describe(renderBandNoise.name, () => {
  it("confines noise to the band and peaks at the asked amplitude", () => {
    const noise = renderBandNoise(RATE, 8000, seededRandom(1), 800, 1600, 0.4);
    expect(peak(noise)).toBeCloseTo(0.4, 3);
    const inside = goertzel(noise, RATE, 1200, 0, 8000).power;
    const below = goertzel(noise, RATE, 100, 0, 8000).power;
    const above = goertzel(noise, RATE, 3500, 0, 8000).power;
    expect(inside).toBeGreaterThan(below * 10);
    expect(inside).toBeGreaterThan(above * 10);
  });
});

describe("levels", () => {
  it("normalizes to the target peak and clips overshoot", () => {
    const out = normalize(new Float32Array([0.1, -0.2, 0.05]), 0.8);
    expect(out[1]).toBeCloseTo(-0.8, 5);
    expect(out[0]).toBeCloseTo(0.4, 5);
    expect(normalize(new Float32Array(3))).toEqual(new Float32Array(3));
    expect(scale(new Float32Array([1]), 3)[0]).toBe(3);
    expect(
      renderNoise(100, seededRandom(2), 0.5).every((v) => Math.abs(v) <= 0.5),
    ).toBe(true);
    expect(
      sameSamples(new Float32Array([1, 2]), new Float32Array([1, 2])),
    ).toBe(true);
    expect(
      sameSamples(new Float32Array([1, 2]), new Float32Array([1, 3])),
    ).toBe(false);
    expect(sameSamples(new Float32Array([1]), new Float32Array([1, 1]))).toBe(
      false,
    );
    expect(rms(new Float32Array([3, 4]))).toBeCloseTo(Math.sqrt(12.5), 5);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe(goertzel.name, () => {
  it("reports a phase that flips when the signal does", () => {
    const tone = renderTone(RATE, {
      freq: 1000,
      start: 0,
      duration: 1,
      amp: 1,
      attack: 0,
      release: 0,
    });
    const flipped = scale(tone, -1);
    const a = goertzel(tone, RATE, 1000, 0, 800).phase;
    const b = goertzel(flipped, RATE, 1000, 0, 800).phase;
    const difference = Math.abs(((a - b + Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(difference).toBeCloseTo(Math.PI, 3);
  });
});
