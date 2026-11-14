export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;
export const TiB = 1024 * GiB;

const UNITS: readonly [number, string][] = [
  [TiB, "TB"],
  [GiB, "GB"],
  [MiB, "MB"],
  [KiB, "kB"],
];

/** Sizes the way DC++ 0.401 printed them (binary multiples, pre-0.403 names): "512 B", "1.23 MB", "45.67 TB". */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  for (const [size, unit] of UNITS)
    if (value >= size) return `${(value / size).toFixed(2)} ${unit}`;
  return `${Math.round(value)} B`;
}

/** A transfer rate: "4.30 kB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds as DC++'s "0:01:23". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** Bytes as the plain number DC++ shows in "Exact size": "1,234,567 B". */
export function formatExact(bytes: number): string {
  return `${Math.round(bytes).toLocaleString("en-US")} B`;
}
