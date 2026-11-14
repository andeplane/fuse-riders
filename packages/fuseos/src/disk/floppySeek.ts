/**
 * How long Explorer waits before it lists A:: the time a 3½" drive takes to spin up and find track 0. The
 * noise itself is the desktop's "floppy" system sound (`src/sounds`), which Explorer plays as the wait
 * starts, so Control Panel > Sounds and `?mute` govern it like every other sound.
 */
export const FLOPPY_SEEK_MS = 1400;

/** Resolves once the drive has "sought"; `wait` is the timer, a fake in tests. */
export function createFloppySeek(
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): () => Promise<void> {
  return () => wait(FLOPPY_SEEK_MS);
}
