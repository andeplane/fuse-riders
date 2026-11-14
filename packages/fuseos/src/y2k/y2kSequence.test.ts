import {
  AFTERMATH_MS,
  clockTextAt,
  COUNTDOWN_MS,
  countdownText,
  garble,
  GLITCH_MS,
  phaseAt,
  ROLLOVER_MS,
  ROLLOVER_TEXT,
  STILL_GARBLE_TEXT,
  TOTAL_MS,
} from "./y2kSequence";

describe(phaseAt.name, () => {
  it("walks countdown, rollover, glitch and aftermath, then ends", () => {
    expect(phaseAt(-1)).toBeNull();
    expect(phaseAt(0)).toBe("countdown");
    expect(phaseAt(COUNTDOWN_MS - 1)).toBe("countdown");
    expect(phaseAt(COUNTDOWN_MS)).toBe("rollover");
    expect(phaseAt(COUNTDOWN_MS + ROLLOVER_MS)).toBe("glitch");
    expect(phaseAt(COUNTDOWN_MS + ROLLOVER_MS + GLITCH_MS)).toBe("aftermath");
    expect(phaseAt(TOTAL_MS - 1)).toBe("aftermath");
    expect(phaseAt(TOTAL_MS)).toBeNull();
    expect(TOTAL_MS).toBe(
      COUNTDOWN_MS + ROLLOVER_MS + GLITCH_MS + AFTERMATH_MS,
    );
  });
});

describe(countdownText.name, () => {
  it("counts the last ten seconds of 1999 and never passes :59", () => {
    expect(countdownText(0)).toBe("11:59:50 PM 12/31/1999");
    expect(countdownText(999)).toBe("11:59:50 PM 12/31/1999");
    expect(countdownText(4_500)).toBe("11:59:54 PM 12/31/1999");
    expect(countdownText(9_999)).toBe("11:59:59 PM 12/31/1999");
    expect(countdownText(12_000)).toBe("11:59:59 PM 12/31/1999");
  });
});

describe(garble.name, () => {
  it("replaces digits only, by the injected random sequence", () => {
    const always = garble("12:00 AM 1/1/1900", () => 0.9);
    expect(always).not.toMatch(/[0-9]/);
    expect(always).toMatch(/^..:.. AM .\/.\/....$/);
    expect(garble("12:00 AM 1/1/1900", () => 0.1)).toBe("12:00 AM 1/1/1900");
  });

  it("picks the noise character from the second draw", () => {
    const draws = [0.9, 0]; // keep deciding: replace; index 0
    let call = 0;
    const text = garble("7", () => draws[call++ % draws.length] ?? 0);
    expect(text).toBe("#");
  });
});

describe(clockTextAt.name, () => {
  const options = { random: () => 0.9, reducedMotion: false };

  it("reads the countdown, then 1900, garbled during the glitch, then nothing", () => {
    expect(clockTextAt(0, options)).toBe("11:59:50 PM 12/31/1999");
    expect(clockTextAt(COUNTDOWN_MS, options)).toBe(ROLLOVER_TEXT);
    const glitched = clockTextAt(COUNTDOWN_MS + ROLLOVER_MS, options);
    expect(glitched).not.toBe(ROLLOVER_TEXT);
    expect(glitched).toHaveLength(ROLLOVER_TEXT.length);
    expect(clockTextAt(TOTAL_MS - 1, options)).toBe(ROLLOVER_TEXT);
    expect(clockTextAt(TOTAL_MS, options)).toBeNull();
  });

  it("shows one still garbled frame under reduced motion", () => {
    expect(
      clockTextAt(COUNTDOWN_MS + ROLLOVER_MS, {
        random: () => 0.9,
        reducedMotion: true,
      }),
    ).toBe(STILL_GARBLE_TEXT);
  });
});
