import { createFloppySeek, FLOPPY_SEEK_MS } from "./floppySeek";

describe(createFloppySeek.name, () => {
  it("waits out the seek on the injected timer", async () => {
    const waits: number[] = [];
    const seek = createFloppySeek((ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await seek();
    await seek();
    expect(waits).toEqual([FLOPPY_SEEK_MS, FLOPPY_SEEK_MS]);
  });

  it("uses a real timer by default", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void createFloppySeek()().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(FLOPPY_SEEK_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
