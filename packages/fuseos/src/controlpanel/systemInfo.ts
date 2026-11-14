/** What Control Panel, System reports about the machine FuseOS runs on. */
export type SystemInfo = {
  browser: string;
  platform: string;
  /** WebGPU is what the in-browser assistant model needs (Phase B, B4). */
  webGpu: boolean;
  /** Logical pixels, with the device pixel ratio when it is not 1. */
  screen: string;
  language: string;
  /** Whether the desktop's window state can be remembered between visits. */
  storage: boolean;
  /** "8 processors", or "Unknown" when the browser hides it. */
  processors: string;
  /** "8 GB" (Chromium reports it, coarsely), or "Unknown". */
  memory: string;
  /** "Touch screen" or "Mouse" — what decides whether a Fuse game opens in a window or a tab. */
  pointer: string;
};

/** How much of the origin's storage quota is in use, as `navigator.storage.estimate()` reports it. */
export type StorageEstimate = { usageBytes: number; quotaBytes: number };

/** The slice of `navigator` the report reads, so tests can hand in a fake. */
export type SystemProbe = {
  userAgent: string;
  platform?: string;
  language: string;
  hasWebGpu: boolean;
  screen: { width: number; height: number };
  storageAvailable: boolean;
  /** `navigator.hardwareConcurrency`; absent when the browser hides it. */
  hardwareConcurrency?: number;
  /** `navigator.deviceMemory` in GB; Chromium only. */
  deviceMemoryGb?: number;
  /** `(pointer: coarse)`: a touch screen rather than a mouse. */
  coarsePointer?: boolean;
  /** `window.devicePixelRatio`; absent counts as 1. */
  pixelRatio?: number;
  /** Resolves to undefined where the Storage API is missing or refuses. */
  estimateStorage?: () => Promise<StorageEstimate | undefined>;
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

/** "1.4 GB", "512 MB", "3 KB": the Windows 98 Properties sheet rounding, never more than one decimal. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  const units = ["bytes", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded.replace(/\.0$/, "")} ${units[unit]}`;
}

export function systemInfo(probe: SystemProbe): SystemInfo {
  const ratio = probe.pixelRatio ?? 1;
  const screen = `${probe.screen.width} x ${probe.screen.height} pixels`;
  return {
    browser: browserName(probe.userAgent),
    platform: probe.platform?.trim() || "Unknown",
    webGpu: probe.hasWebGpu,
    screen: ratio === 1 ? screen : `${screen} (${ratio}x)`,
    language: probe.language,
    storage: probe.storageAvailable,
    processors:
      probe.hardwareConcurrency && probe.hardwareConcurrency > 0
        ? `${probe.hardwareConcurrency} ${probe.hardwareConcurrency === 1 ? "processor" : "processors"}`
        : "Unknown",
    memory:
      probe.deviceMemoryGb && probe.deviceMemoryGb > 0
        ? `${probe.deviceMemoryGb} GB`
        : "Unknown",
    pointer: probe.coarsePointer ? "Touch screen" : "Mouse",
  };
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

/** `navigator.deviceMemory` is Chromium-only and not in the DOM typings; read it without widening `navigator`. */
function deviceMemoryGb(nav: Navigator): number | undefined {
  const value: unknown = Reflect.get(nav, "deviceMemory");
  return typeof value === "number" && value > 0 ? value : undefined;
}

async function estimateStorage(): Promise<StorageEstimate | undefined> {
  try {
    const estimate = await navigator.storage?.estimate();
    if (!estimate || estimate.quota === undefined) return undefined;
    return { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota };
  } catch {
    return undefined;
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
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: deviceMemoryGb(navigator),
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    pixelRatio: window.devicePixelRatio,
    estimateStorage,
  };
}
