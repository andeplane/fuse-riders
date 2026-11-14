import { TEST_SYSTEM_PROBE } from "../__mocks__/renderWithProviders";

import { browserName, formatBytes, systemInfo } from "./systemInfo";

describe(browserName.name, () => {
  it("names the common browsers with their major version", () => {
    expect(browserName(TEST_SYSTEM_PROBE.userAgent)).toBe("Chrome 131");
    expect(
      browserName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
      ),
    ).toBe("Firefox 133");
    expect(
      browserName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      ),
    ).toBe("Safari 18");
    expect(
      browserName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      ),
    ).toBe("Microsoft Edge 131");
    expect(browserName("Lynx/2.8")).toBe("Lynx/2.8");
  });
});

describe(systemInfo.name, () => {
  it("summarises the probe, saying Unknown for what the browser hides", () => {
    expect(systemInfo(TEST_SYSTEM_PROBE)).toEqual({
      browser: "Chrome 131",
      platform: "MacIntel",
      webGpu: true,
      screen: "1920 x 1080 pixels",
      language: "en-GB",
      storage: true,
      processors: "Unknown",
      memory: "Unknown",
      pointer: "Mouse",
    });
    expect(
      systemInfo({ ...TEST_SYSTEM_PROBE, platform: " ", hasWebGpu: false }),
    ).toMatchObject({ platform: "Unknown", webGpu: false });
  });

  it("reports the processors, memory, pixel ratio and touch screen when the probe knows them", () => {
    expect(
      systemInfo({
        ...TEST_SYSTEM_PROBE,
        hardwareConcurrency: 8,
        deviceMemoryGb: 8,
        pixelRatio: 2,
        coarsePointer: true,
      }),
    ).toMatchObject({
      processors: "8 processors",
      memory: "8 GB",
      screen: "1920 x 1080 pixels (2x)",
      pointer: "Touch screen",
    });
    expect(
      systemInfo({ ...TEST_SYSTEM_PROBE, hardwareConcurrency: 1 }).processors,
    ).toBe("1 processor");
    expect(
      systemInfo({ ...TEST_SYSTEM_PROBE, hardwareConcurrency: 0 }).processors,
    ).toBe("Unknown");
  });
});

describe(formatBytes.name, () => {
  it("rounds to one decimal in the largest fitting unit, like a Properties sheet", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(3 * 1024)).toBe("3 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
    expect(formatBytes(3.25 * 1024 ** 4)).toBe("3.3 TB");
    expect(formatBytes(-1)).toBe("Unknown");
    expect(formatBytes(Number.NaN)).toBe("Unknown");
  });
});
