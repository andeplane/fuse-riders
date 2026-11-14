import {
  DING_DURATION,
  ERROR_DURATION,
  RECYCLE_DURATION,
  renderDing,
  renderError,
  renderRecycle,
  renderShutdown,
  renderStartup,
  SHUTDOWN_DURATION,
  STARTUP_DURATION,
} from "./chimes";
import { at, goertzel, peak, rms, sameSamples, seededRandom } from "./pcm";

const RATE = 16000;

function power(samples: Float32Array, freq: number, from: number, to: number) {
  return goertzel(samples, RATE, freq, at(RATE, from), at(RATE, to)).power;
}

describe("chimes", () => {
  it("render to their stated lengths, normalised below full scale", () => {
    const cases: [Float32Array, number][] = [
      [renderStartup(RATE), STARTUP_DURATION],
      [renderShutdown(RATE), SHUTDOWN_DURATION],
      [renderDing(RATE), DING_DURATION],
      [renderError(RATE), ERROR_DURATION],
      [renderRecycle(RATE), RECYCLE_DURATION],
    ];
    for (const [samples, duration] of cases) {
      expect(samples).toHaveLength(Math.ceil(duration * RATE));
      expect(peak(samples)).toBeGreaterThan(0.5);
      expect(peak(samples)).toBeLessThanOrEqual(0.9);
      expect(rms(samples)).toBeGreaterThan(0.01);
    }
  });

  it("start-up swells in slowly and sparkles late; shut-down steps down", () => {
    const startup = renderStartup(RATE);
    expect(rms(startup, 0, at(RATE, 0.1))).toBeLessThan(
      rms(startup, at(RATE, 1), at(RATE, 1.5)) / 3,
    );
    expect(power(startup, 880, 1.35, 1.6)).toBeGreaterThan(
      power(startup, 880, 0.4, 0.65) * 5,
    );
    const shutdown = renderShutdown(RATE);
    expect(power(shutdown, 587.33, 0.02, 0.3)).toBeGreaterThan(
      power(shutdown, 293.66, 0.02, 0.3) * 3,
    );
    expect(power(shutdown, 293.66, 1.0, 1.3)).toBeGreaterThan(
      power(shutdown, 587.33, 1.0, 1.3),
    );
  });

  it("the ding is a struck A5 bell that decays", () => {
    const ding = renderDing(RATE);
    expect(power(ding, 880, 0.01, 0.2)).toBeGreaterThan(
      power(ding, 600, 0.01, 0.2) * 100,
    );
    expect(peak(ding, 0, at(RATE, 0.1))).toBeGreaterThan(
      peak(ding, at(RATE, 0.6), ding.length) * 5,
    );
  });

  it("the error chord holds its three notes", () => {
    const chord = renderError(RATE);
    for (const freq of [261.63, 311.13, 369.99])
      expect(power(chord, freq, 0.02, 0.4)).toBeGreaterThan(
        power(chord, 440, 0.02, 0.4) * 10,
      );
  });

  it("the recycle crumple is broadband and deterministic per seed", () => {
    const crumple = renderRecycle(RATE);
    expect(power(crumple, 3000, 0.1, 0.6)).toBeGreaterThan(
      power(crumple, 200, 0.1, 0.6) * 10,
    );
    expect(sameSamples(renderRecycle(RATE), crumple)).toBe(true);
    expect(sameSamples(renderRecycle(RATE, seededRandom(5)), crumple)).toBe(
      false,
    );
  });
});
