import { TEST_SYSTEM_PROBE } from "../__mocks__/renderWithProviders";

import { browserName, systemInfo } from "./systemInfo";

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
  it("summarises the probe", () => {
    expect(systemInfo(TEST_SYSTEM_PROBE)).toEqual({
      browser: "Chrome 131",
      platform: "MacIntel",
      webGpu: true,
      screen: "1920 x 1080 pixels",
      language: "en-GB",
      storage: true,
    });
    expect(
      systemInfo({ ...TEST_SYSTEM_PROBE, platform: " ", hasWebGpu: false }),
    ).toMatchObject({ platform: "Unknown", webGpu: false });
  });
});
