import { DTMF, renderModem } from "./modem";
import {
  ansamReversals,
  digitStart,
  MODEM_DURATION,
  MODEM_NUMBER,
  MODEM_PHASES,
  MODEM_TIMELINE as T,
} from "./modemTimeline";
import { at, goertzel, peak, rms, sameSamples, seededRandom } from "./pcm";

const RATE = 16000;
const modem = renderModem(RATE);

/** Power of `freq` over a window of seconds. */
function power(freq: number, from: number, to: number): number {
  return goertzel(modem, RATE, freq, at(RATE, from), at(RATE, to)).power;
}

/** Mean power of eleven bins around `freq`; one bin of noise is far too variable to compare. */
function bandPower(freq: number, from: number, to: number): number {
  let sum = 0;
  for (let k = -5; k <= 5; k++) sum += power(freq + k * 7, from, to);
  return sum / 11;
}

describe(renderModem.name, () => {
  it("lasts 10 to 20 seconds, is normalised and deterministic", () => {
    expect(MODEM_DURATION).toBeGreaterThanOrEqual(10);
    expect(MODEM_DURATION).toBeLessThanOrEqual(20);
    expect(modem).toHaveLength(Math.ceil(MODEM_DURATION * RATE));
    expect(peak(modem)).toBeCloseTo(0.85, 2);
    expect(sameSamples(renderModem(RATE), modem)).toBe(true);
    expect(sameSamples(renderModem(RATE, seededRandom(1)), modem)).toBe(false);
  });

  it("starts with the 350 + 440 Hz dial tone", () => {
    const from = T.dialToneStart + 0.1;
    const to = T.dialToneEnd - 0.1;
    const dial = Math.min(power(350, from, to), power(440, from, to));
    expect(dial).toBeGreaterThan(power(600, from, to) * 100);
    expect(dial).toBeGreaterThan(power(1000, from, to) * 100);
  });

  it("dials 555-FUSE in DTMF, each digit as its two keypad tones", () => {
    expect(MODEM_NUMBER).toBe("5553873");
    for (let i = 0; i < MODEM_NUMBER.length; i++) {
      const digit = MODEM_NUMBER[i] ?? "";
      const pair = DTMF[digit];
      expect(pair).toBeDefined();
      if (!pair) continue;
      const from = digitStart(i) + 0.01;
      const to = digitStart(i) + T.digitOn - 0.01;
      const [low, high] = pair;
      const other = Object.values(DTMF)
        .flat()
        .filter((f) => f !== low && f !== high);
      const strongest = Math.max(...other.map((f) => power(f, from, to)));
      expect(power(low, from, to)).toBeGreaterThan(strongest * 20);
      expect(power(high, from, to)).toBeGreaterThan(strongest * 20);
    }
    // Between digits the line is quiet apart from hiss.
    const gap = digitStart(0) + T.digitOn + 0.02;
    expect(rms(modem, at(RATE, gap), at(RATE, gap + 0.03))).toBeLessThan(0.03);
  });

  it("rings back at 440 + 480 Hz, then goes quiet until the answer", () => {
    const from = T.ringbackStart + 0.2;
    const to = T.ringbackEnd - 0.2;
    expect(power(480, from, to)).toBeGreaterThan(power(350, from, to) * 100);
    expect(power(440, from, to)).toBeGreaterThan(power(1000, from, to) * 100);
    expect(
      rms(modem, at(RATE, T.ringbackEnd + 0.1), at(RATE, T.pickup - 0.1)),
    ).toBeLessThan(0.03);
  });

  it("answers with ANSam: 2100 Hz that flips phase every 450 ms", () => {
    const from = T.ansamStart + 0.05;
    expect(power(2100, from, from + 0.3)).toBeGreaterThan(
      power(1500, from, from + 0.3) * 100,
    );
    const reversals = ansamReversals();
    expect(reversals.length).toBeGreaterThanOrEqual(6);
    for (const time of reversals.slice(0, 3)) {
      const window = 0.05;
      const before = goertzel(
        modem,
        RATE,
        2100,
        at(RATE, time - window - 0.005),
        at(RATE, time - 0.005),
      ).phase;
      const after = goertzel(
        modem,
        RATE,
        2100,
        at(RATE, time + 0.005),
        at(RATE, time + window + 0.005),
      ).phase;
      const difference = Math.abs(
        ((before - after + Math.PI) % (2 * Math.PI)) - Math.PI,
      );
      expect(difference).toBeGreaterThan(2.6);
    }
    // 15 Hz amplitude modulation: the envelope of the answer tone rises and falls.
    const envelopes: number[] = [];
    for (let k = 0; k < 8; k++) {
      const start = at(RATE, T.ansamStart + 0.5 + k / 120);
      envelopes.push(peak(modem, start, start + at(RATE, 1 / 2100) * 4));
    }
    expect(Math.max(...envelopes) / Math.min(...envelopes)).toBeGreaterThan(
      1.15,
    );
  });

  it("probes the line with the 150 Hz-spaced comb, minus 900, 1200 and 1800 Hz", () => {
    const from = T.probeStart + 0.2;
    const to = T.probeEnd - 0.05;
    const present = [150, 300, 450, 1050, 2100, 3000, 3750].map((f) =>
      power(f, from, to),
    );
    const absent = [900, 1200, 1800, 1275].map((f) => power(f, from, to));
    expect(Math.min(...present)).toBeGreaterThan(Math.max(...absent) * 5);
  });

  it("trains with scrambled data: broadband noise that widens, then cuts out on CONNECT", () => {
    const narrow = (f: number) =>
      bandPower(f, T.trainStart + 0.2, T.trainWide - 0.1);
    expect(narrow(1800)).toBeGreaterThan(narrow(500) * 10);
    const wide = (f: number) =>
      bandPower(f, T.trainWide + 0.2, T.trainEnd - 0.1);
    const band = [500, 1000, 1800, 2600, 3200].map(wide);
    expect(Math.max(...band) / Math.min(...band)).toBeLessThan(10);
    expect(wide(500)).toBeGreaterThan(narrow(500) * 10);
    expect(
      rms(modem, at(RATE, T.trainWide), at(RATE, T.trainEnd - 0.1)),
    ).toBeGreaterThan(0.1);
    expect(rms(modem, at(RATE, T.connected + 0.05), modem.length)).toBeLessThan(
      0.01,
    );
  });

  it("names the Dial-Up Networking phases in order, within the sound", () => {
    expect(MODEM_PHASES.map((phase) => phase.status)).toEqual([
      "Dialing 555-FUSE...",
      "Ringing...",
      "Verifying user name and password...",
      "Negotiating connection speed...",
      "Logging on to network...",
      "Connected at 56,000 bps",
    ]);
    for (let i = 1; i < MODEM_PHASES.length; i++)
      expect(MODEM_PHASES[i]?.at).toBeGreaterThan(MODEM_PHASES[i - 1]?.at ?? 0);
    expect(MODEM_PHASES[MODEM_PHASES.length - 1]?.at).toBeLessThan(
      MODEM_DURATION,
    );
  });
});
