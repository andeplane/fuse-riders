import {
  formatBytes,
  formatDuration,
  formatExact,
  formatSpeed,
  GiB,
  KiB,
  MiB,
  TiB,
} from "./format";
import { createRandom, pick, randomInt } from "./rng";

describe("DC++ formatting", () => {
  it("prints sizes in 0.401 units with two decimals, bytes plain", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1.5 * KiB)).toBe("1.50 kB");
    expect(formatBytes(598.04 * MiB)).toBe("598.04 MB");
    expect(formatBytes(100 * GiB)).toBe("100.00 GB");
    expect(formatBytes(412 * TiB)).toBe("412.00 TB");
  });

  it("prints speeds, durations and exact sizes", () => {
    expect(formatSpeed(4.3 * KiB)).toBe("4.30 kB/s");
    expect(formatDuration(83)).toBe("0:01:23");
    expect(formatDuration(3 * 3600 + 5)).toBe("3:00:05");
    expect(formatDuration(-4)).toBe("0:00:00");
    expect(formatExact(1234567)).toBe("1,234,567 B");
  });
});

describe("the seeded random source", () => {
  it("replays the same sequence for the same seed and stays in [0, 1)", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const first = Array.from({ length: 50 }, a);
    expect(Array.from({ length: 50 }, b)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(Array.from({ length: 5 }, createRandom(43))).not.toEqual(
      first.slice(0, 5),
    );
  });

  it("draws integers inclusively and picks from a list", () => {
    expect(randomInt(() => 0, 3, 9)).toBe(3);
    expect(randomInt(() => 0.9999, 3, 9)).toBe(9);
    expect(pick(() => 0.5, ["a", "b", "c"])).toBe("b");
    expect(pick(() => 0.99, ["a"])).toBe("a");
  });
});
