/**
 * The Transfer tab's downloads and uploads as plain data and pure steps. A download's fate is decided the moment
 * it starts (seeded), and `advanceTransfer` walks it through the states the 2000 client showed: "Getting info...",
 * then "Remotely Queued" for ever, a "Transfer Error!" early or late (the infamous 99%), or a completed file that
 * is either a Fuse soundtrack track under someone else's name or the Metallica decoy. No bytes move anywhere.
 */
import { FUSE_TRACKS } from "../winamp/fuseTracks";

import type { Random, SearchResult } from "./fakeNetwork";
import { formatCount, pick, speedClass } from "./fakeNetwork";
import type { LineSpeed } from "./napsterCatalog";

/** What the finished file turns out to be. */
export type Delivery = { kind: "fuse"; trackId: string } | { kind: "decoy" };

/** Decided at the start; the transfer's states follow from it. */
export type TransferFate =
  | { kind: "error"; atFraction: number }
  | { kind: "queued" }
  | { kind: "complete"; delivery: Delivery };

export type TransferPhase =
  "info" | "queued" | "downloading" | "error" | "complete" | "cancelled";

export type Transfer = {
  id: string;
  filename: string;
  user: string;
  lineSpeed: LineSpeed;
  filesize: number;
  bitrate: number;
  frequency: number;
  /** Seconds of audio. */
  length: number;
  /** Bytes so far. */
  received: number;
  /** Bytes per second as the Rate column shows it (the real 2000 numbers; the clock runs faster, see TIME_WARP). */
  rate: number;
  phase: TransferPhase;
  /** Milliseconds spent in the current phase. */
  phaseElapsed: number;
  /** How long "Getting info..." lasts for this one. */
  infoMs: number;
  /** Where in the queue the remote user put you; only shown while queued. */
  queuePosition: number;
  fate: TransferFate;
};

/** Downloads run this many times faster than the Rate column says, so a 4 MB song does not take 15 minutes. */
export const TIME_WARP = 12;

/** Realistic sustained rates in bytes per second, by the remote user's line. */
function baseRate(speed: LineSpeed, random: Random): number {
  switch (speedClass(speed)) {
    case "fast":
      return 28_000 + random() * 70_000;
    case "medium":
      return 3_200 + random() * 2_600;
    case "slow":
      return 1_400 + random() * 1_800;
  }
}

/**
 * The odds, roughly as people remember them: most downloads never finished. A Fuse file someone shares
 * usually arrives; the decoy always does (that was the point of it).
 */
export function decideFate(result: SearchResult, random: Random): TransferFate {
  const source = result.source;
  if (source.kind === "decoy")
    return { kind: "complete", delivery: { kind: "decoy" } };
  if (source.kind === "fuse")
    return random() < 0.85
      ? {
          kind: "complete",
          delivery: { kind: "fuse", trackId: source.trackId },
        }
      : { kind: "error", atFraction: 0.1 + random() * 0.6 };
  const roll = random();
  if (roll < 0.2) return { kind: "error", atFraction: 0 };
  if (roll < 0.4) return { kind: "queued" };
  if (roll < 0.55) return { kind: "error", atFraction: 0.99 };
  if (roll < 0.68) return { kind: "error", atFraction: 0.15 + random() * 0.55 };
  return {
    kind: "complete",
    delivery: { kind: "fuse", trackId: pick(FUSE_TRACKS, random).id },
  };
}

export function startTransfer(
  id: string,
  result: SearchResult,
  random: Random,
): Transfer {
  return {
    id,
    filename: result.filename,
    user: result.user,
    lineSpeed: result.lineSpeed,
    filesize: result.filesize,
    bitrate: result.bitrate,
    frequency: result.frequency,
    length: result.length,
    received: 0,
    rate: 0,
    phase: "info",
    phaseElapsed: 0,
    infoMs: 1200 + Math.floor(random() * 2600),
    queuePosition: 2 + Math.floor(random() * 40),
    fate: decideFate(result, random),
  };
}

/** Whether the transfer has stopped moving (finished, failed or cancelled); the "Clear Finished" button removes these. */
export function isFinished(transfer: Transfer): boolean {
  return (
    transfer.phase === "complete" ||
    transfer.phase === "error" ||
    transfer.phase === "cancelled"
  );
}

/** Moves a transfer `elapsedMs` of wall time along its fate. */
export function advanceTransfer(
  transfer: Transfer,
  elapsedMs: number,
  random: Random,
): Transfer {
  const phaseElapsed = transfer.phaseElapsed + elapsedMs;
  const fate = transfer.fate;
  switch (transfer.phase) {
    case "error":
    case "complete":
    case "cancelled":
      return transfer;
    case "info": {
      if (phaseElapsed < transfer.infoMs) return { ...transfer, phaseElapsed };
      if (fate.kind === "queued")
        return { ...transfer, phase: "queued", phaseElapsed: 0 };
      if (fate.kind === "error" && fate.atFraction === 0)
        return { ...transfer, phase: "error", phaseElapsed: 0 };
      return {
        ...transfer,
        phase: "downloading",
        phaseElapsed: 0,
        rate: baseRate(transfer.lineSpeed, random),
      };
    }
    case "queued": {
      // The queue position wanders but the download never starts: that was the joke of "Remotely Queued".
      const drift = random() < 0.3 ? (random() < 0.6 ? -1 : 1) : 0;
      return {
        ...transfer,
        phaseElapsed,
        queuePosition: Math.max(1, transfer.queuePosition + drift),
      };
    }
    case "downloading": {
      const rate = Math.max(600, transfer.rate * (0.85 + random() * 0.3));
      const received = Math.min(
        transfer.filesize,
        transfer.received + (rate * TIME_WARP * elapsedMs) / 1000,
      );
      if (fate.kind === "error") {
        const stop = Math.ceil(transfer.filesize * fate.atFraction);
        if (received >= stop)
          return {
            ...transfer,
            received: stop,
            rate: 0,
            phase: "error",
            phaseElapsed: 0,
          };
      }
      if (received >= transfer.filesize)
        return {
          ...transfer,
          received,
          rate: 0,
          phase: "complete",
          phaseElapsed: 0,
        };
      return { ...transfer, received, rate, phaseElapsed };
    }
  }
}

export function cancelTransfer(transfer: Transfer): Transfer {
  return isFinished(transfer)
    ? transfer
    : { ...transfer, phase: "cancelled", rate: 0, phaseElapsed: 0 };
}

/** The Status column, in the client's own words. Uploads say "Uploading..." where downloads say "Downloading...". */
export function transferStatus(
  transfer: Transfer,
  direction: "down" | "up" = "down",
): string {
  switch (transfer.phase) {
    case "info":
      return direction === "up" ? "Waiting..." : "Getting Info...";
    case "queued":
      return `Remotely Queued (${transfer.queuePosition})`;
    case "downloading":
      return direction === "up" ? "Uploading..." : "Downloading...";
    case "error":
      return "Transfer Error!";
    case "complete":
      return "File Complete!";
    case "cancelled":
      return "Cancelled";
  }
}

/** Progress as a whole percentage, floored so a 99% failure never shows 100. */
export function transferPercent(transfer: Transfer): number {
  if (transfer.filesize <= 0) return 0;
  return Math.floor((transfer.received / transfer.filesize) * 100);
}

/** "5.06 k/s", or blank when nothing is moving. */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "";
  return `${(bytesPerSecond / 1024).toFixed(2)} k/s`;
}

/** The File Size column: "299,200 of 2,220,560" while it moves, the plain size once it stops. */
export function formatTransferSize(transfer: Transfer): string {
  const total = formatCount(transfer.filesize);
  return transfer.phase === "downloading"
    ? `${formatCount(transfer.received)} of ${total}`
    : total;
}

/** Remaining time at the Rate column's rate, "00:06:19", or blank. */
export function formatTimeLeft(transfer: Transfer): string {
  if (transfer.phase !== "downloading" || transfer.rate <= 0) return "";
  const seconds = Math.ceil(
    (transfer.filesize - transfer.received) / transfer.rate,
  );
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
