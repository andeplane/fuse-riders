import { scriptedRandom } from "../__mocks__/seededRandom";
import { FUSE_TRACKS } from "../winamp/fuseTracks";

import type { SearchResult } from "./fakeNetwork";
import type { Transfer, TransferFate } from "./transfers";
import {
  advanceTransfer,
  cancelTransfer,
  decideFate,
  formatRate,
  formatTimeLeft,
  formatTransferSize,
  isFinished,
  startTransfer,
  TIME_WARP,
  transferPercent,
  transferStatus,
} from "./transfers";

const SONG: SearchResult = {
  id: "r1",
  filename: "C:\\My Music\\Eminem - Stan.mp3",
  filesize: 6_464_000,
  bitrate: 128,
  frequency: 44100,
  length: 404,
  user: "dialup_dan",
  lineSpeed: "Cable",
  ping: 60,
  source: {
    kind: "song",
    song: { artist: "Eminem", title: "Stan", length: 404 },
  },
};

function withFate(fate: TransferFate, overrides: Partial<Transfer> = {}) {
  return {
    ...startTransfer("d1", SONG, scriptedRandom([0, 0, 0.9])),
    fate,
    ...overrides,
  };
}

/** Steps a transfer by a second at a time until it stops changing phase or the budget runs out. */
function run(transfer: Transfer, seconds: number): Transfer {
  let current = transfer;
  for (let second = 0; second < seconds; second += 1)
    current = advanceTransfer(current, 1000, scriptedRandom([0.5]));
  return current;
}

describe(decideFate.name, () => {
  it("dooms most song downloads in the ways people remember", () => {
    expect(decideFate(SONG, scriptedRandom([0.1]))).toEqual({
      kind: "error",
      atFraction: 0,
    });
    expect(decideFate(SONG, scriptedRandom([0.3]))).toEqual({ kind: "queued" });
    expect(decideFate(SONG, scriptedRandom([0.5]))).toEqual({
      kind: "error",
      atFraction: 0.99,
    });
    expect(decideFate(SONG, scriptedRandom([0.6, 0]))).toEqual({
      kind: "error",
      atFraction: 0.15,
    });
    expect(decideFate(SONG, scriptedRandom([0.9, 0]))).toEqual({
      kind: "complete",
      delivery: { kind: "fuse", trackId: FUSE_TRACKS[0]?.id },
    });
  });

  it("always delivers the decoy, and usually a shared Fuse file", () => {
    expect(
      decideFate(
        { ...SONG, source: { kind: "decoy" } },
        scriptedRandom([0.99]),
      ),
    ).toEqual({ kind: "complete", delivery: { kind: "decoy" } });
    const fuse = {
      ...SONG,
      source: { kind: "fuse", trackId: "snaky-blue" },
    } as const;
    expect(decideFate(fuse, scriptedRandom([0.2]))).toEqual({
      kind: "complete",
      delivery: { kind: "fuse", trackId: "snaky-blue" },
    });
    expect(decideFate(fuse, scriptedRandom([0.9, 0]))).toEqual({
      kind: "error",
      atFraction: 0.1,
    });
  });
});

describe(advanceTransfer.name, () => {
  it("gets info, then sits Remotely Queued for ever with a wandering position", () => {
    const start = withFate(
      { kind: "queued" },
      { infoMs: 1500, queuePosition: 5 },
    );
    expect(transferStatus(start)).toBe("Getting Info...");
    const waiting = advanceTransfer(start, 1000, scriptedRandom([0]));
    expect(waiting.phase).toBe("info");
    const queued = advanceTransfer(waiting, 1000, scriptedRandom([0]));
    expect(transferStatus(queued)).toBe("Remotely Queued (5)");
    expect(
      advanceTransfer(queued, 1000, scriptedRandom([0.1, 0.1])).queuePosition,
    ).toBe(4);
    expect(
      advanceTransfer(queued, 1000, scriptedRandom([0.1, 0.9])).queuePosition,
    ).toBe(6);
    expect(
      advanceTransfer(queued, 1000, scriptedRandom([0.9])).queuePosition,
    ).toBe(5);
    expect(run(queued, 600).phase).toBe("queued");
  });

  it("fails straight after Getting Info for an immediate error", () => {
    const failed = run(withFate({ kind: "error", atFraction: 0 }), 5);
    expect(transferStatus(failed)).toBe("Transfer Error!");
    expect(failed.received).toBe(0);
  });

  it("downloads to 99% and then fails, the cruellest one", () => {
    const failed = run(withFate({ kind: "error", atFraction: 0.99 }), 600);
    expect(failed.phase).toBe("error");
    expect(transferPercent(failed)).toBe(99);
    expect(formatTransferSize(failed)).toBe("6,464,000");
  });

  it("completes at the warped real-world rate", () => {
    const start = withFate({
      kind: "complete",
      delivery: { kind: "fuse", trackId: "snaky-blue" },
    });
    const moving = run(start, 2);
    expect(moving.phase).toBe("downloading");
    expect(moving.received).toBe(0);
    const going = advanceTransfer(moving, 1000, scriptedRandom([0.5]));
    expect(transferStatus(going)).toBe("Downloading...");
    expect(transferStatus(going, "up")).toBe("Uploading...");
    expect(going.received).toBeGreaterThan(0);
    expect(going.received).toBeCloseTo(going.rate * TIME_WARP, -1);
    expect(formatTransferSize(going)).toMatch(/^[\d,]+ of 6,464,000$/);
    expect(formatRate(going.rate)).toMatch(/^\d+\.\d\d k\/s$/);
    expect(formatTimeLeft(going)).toMatch(/^\d\d:\d\d:\d\d$/);
    const done = run(going, 600);
    expect(transferStatus(done)).toBe("File Complete!");
    expect(isFinished(done)).toBe(true);
    expect(advanceTransfer(done, 1000, scriptedRandom([0]))).toBe(done);
    expect(formatTimeLeft(done)).toBe("");
    expect(formatRate(done.rate)).toBe("");
  });

  it("moves at modem and slow-line rates too", () => {
    for (const lineSpeed of ["56K", "28.8"] as const) {
      const start = withFate(
        { kind: "complete", delivery: { kind: "decoy" } },
        { lineSpeed },
      );
      const moving = run(start, 5);
      expect(moving.rate).toBeLessThan(6000);
      expect(moving.phase).toBe("downloading");
    }
  });
});

describe(cancelTransfer.name, () => {
  it("cancels a moving transfer and leaves a finished one alone", () => {
    const cancelled = cancelTransfer(withFate({ kind: "queued" }));
    expect(transferStatus(cancelled)).toBe("Cancelled");
    const failed = run(withFate({ kind: "error", atFraction: 0 }), 5);
    expect(cancelTransfer(failed)).toBe(failed);
  });
});

describe("labels", () => {
  it("says Waiting... for an upload that has not started, and handles an empty file", () => {
    const start = withFate({ kind: "queued" });
    expect(transferStatus(start, "up")).toBe("Waiting...");
    expect(transferPercent({ ...start, filesize: 0 })).toBe(0);
  });
});
