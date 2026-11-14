import { FLOPPY_DURATION, renderFloppy, STEP_RATE } from "./floppy";
import { at, goertzel, peak, rms, sameSamples, seededRandom } from "./pcm";

const RATE = 16000;
const floppy = renderFloppy(RATE);

describe(renderFloppy.name, () => {
  it("is a few seconds long, normalised and deterministic", () => {
    expect(FLOPPY_DURATION).toBeGreaterThan(2);
    expect(FLOPPY_DURATION).toBeLessThan(5);
    expect(floppy).toHaveLength(Math.ceil(FLOPPY_DURATION * RATE));
    expect(peak(floppy)).toBeCloseTo(0.8, 2);
    expect(sameSamples(renderFloppy(RATE), floppy)).toBe(true);
    expect(sameSamples(renderFloppy(RATE, seededRandom(99)), floppy)).toBe(
      false,
    );
  });

  it("spins the motor up from silence and down to silence", () => {
    expect(Math.abs(floppy[0] ?? 1)).toBeLessThan(0.01);
    expect(rms(floppy, 0, at(RATE, 0.05))).toBeLessThan(
      rms(floppy, at(RATE, 0.3), at(RATE, 0.4)),
    );
    expect(
      rms(floppy, floppy.length - at(RATE, 0.05), floppy.length),
    ).toBeLessThan(0.02);
  });

  it("buzzes the head stepper at its step rate while recalibrating", () => {
    const from = at(RATE, 0.5);
    const to = at(RATE, 0.95);
    const stepping = goertzel(floppy, RATE, STEP_RATE * 6, from, to).power;
    const between = goertzel(floppy, RATE, STEP_RATE * 6.5, from, to).power;
    expect(stepping).toBeGreaterThan(between * 2);
    expect(rms(floppy, from, to)).toBeGreaterThan(
      rms(floppy, at(RATE, 0.1), at(RATE, 0.3)) * 1.5,
    );
  });

  it("keeps seeking, with gaps, through the middle of the sound", () => {
    const windows: number[] = [];
    for (let t = 1.2; t < 2.7; t += 0.05)
      windows.push(rms(floppy, at(RATE, t), at(RATE, t + 0.05)));
    const loudest = Math.max(...windows);
    const loud = windows.filter((level) => level > loudest * 0.5).length;
    const quiet = windows.filter((level) => level < loudest * 0.4).length;
    expect(loud).toBeGreaterThan(5);
    expect(quiet).toBeGreaterThan(5);
  });
});
