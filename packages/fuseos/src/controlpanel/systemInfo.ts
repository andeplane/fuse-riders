/** What Control Panel, System reports about the machine FuseOS runs on. */
export type SystemInfo = {
  browser: string;
  platform: string;
  /** WebGPU is what the in-browser assistant model needs (Phase B, B4). */
  webGpu: boolean;
  /** Logical pixels. */
  screen: string;
  language: string;
  /** Whether the desktop's window state can be remembered between visits. */
  storage: boolean;
};

/** The slice of `navigator` the report reads, so tests can hand in a fake. */
export type SystemProbe = {
  userAgent: string;
  platform?: string;
  language: string;
  hasWebGpu: boolean;
  screen: { width: number; height: number };
  storageAvailable: boolean;
};

const BROWSERS: readonly { token: string; name: string }[] = [
  { token: "Edg", name: "Microsoft Edge" },
  { token: "OPR", name: "Opera" },
  { token: "Firefox", name: "Firefox" },
  { token: "Chrome", name: "Chrome" },
  { token: "Safari", name: "Safari" },
];

/** A readable browser name out of a user agent string; the raw string when no known browser matches. */
export function browserName(userAgent: string): string {
  // Chrome's user agent also says Safari, and Edge's says Chrome: the most specific token wins.
  for (const { token, name } of BROWSERS) {
    const match = new RegExp(`${token}/(\\d+)`).exec(userAgent);
    if (!match) continue;
    const version =
      token === "Safari"
        ? (/Version\/(\d+)/.exec(userAgent)?.[1] ?? match[1])
        : match[1];
    return `${name} ${version}`;
  }
  return userAgent;
}

export function systemInfo(probe: SystemProbe): SystemInfo {
  return {
    browser: browserName(probe.userAgent),
    platform: probe.platform?.trim() || "Unknown",
    webGpu: probe.hasWebGpu,
    screen: `${probe.screen.width} x ${probe.screen.height} pixels`,
    language: probe.language,
    storage: probe.storageAvailable,
  };
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

/** The real browser. */
export function probeBrowser(): SystemProbe {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    hasWebGpu: "gpu" in navigator,
    screen: { width: window.screen.width, height: window.screen.height },
    storageAvailable: storageAvailable(),
  };
}
