export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;
export const TiB = 1024 * GiB;

const UNITS: readonly [number, string][] = [
  [TiB, "TiB"],
  [GiB, "GiB"],
  [MiB, "MiB"],
  [KiB, "KiB"],
];

/** Sizes the way DC++ 0.4xx printed them: "0 B", "512 B", "1.23 MiB", "45.67 TiB". */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  for (const [size, unit] of UNITS)
    if (value >= size) return `${(value / size).toFixed(2)} ${unit}`;
  return `${Math.round(value)} B`;
}

/** A transfer rate: "4.30 KiB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds as DC++'s "00:01:23". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** The chat timestamp: "[21:07]". */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `[${pad(date.getHours())}:${pad(date.getMinutes())}]`;
}

/** Bytes as the plain number DC++ shows in "Exact size": "1,234,567 B". */
export function formatExact(bytes: number): string {
  return `${Math.round(bytes).toLocaleString("en-US")} B`;
}
