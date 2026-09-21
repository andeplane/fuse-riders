import type { Impact } from "../engine/view.js";
/** Disposable impact synth; the shared music catalog is played by the separate radio. */
export class Audio {
  private context?: AudioContext;
  private last = 0;
  constructor(
    public muted: boolean,
    private readonly open: () => AudioContext = () => new AudioContext(),
  ) {}
  unlock(): void {
    if (!this.muted) {
      try {
        this.context ??= this.open();
        void this.context.resume().catch(() => {
          this.muted = true;
        });
      } catch {
        // Browsers that cannot open audio still get a fully playable game.
        this.muted = true;
      }
    }
  }
  play(e: Impact): void {
    const c = this.context;
    if (
      this.muted ||
      !c ||
      c.state !== "running" ||
      e.kind === "wall" ||
      c.currentTime - this.last < 0.025
    )
      return;
    this.last = c.currentTime;
    const oscillator = c.createOscillator(),
      gain = c.createGain();
    const hz =
      e.kind === "bomb"
        ? 65
        : e.kind === "pickup"
          ? 1100
          : e.kind === "core"
            ? 110
            : e.kind === "paddle"
              ? 720
              : e.kind === "launch"
                ? 440
                : 260;
    oscillator.type = e.kind === "core" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(hz, c.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      hz / 3,
      c.currentTime + 0.14,
    );
    gain.gain.setValueAtTime(0.045, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(c.destination);
    oscillator.start();
    oscillator.stop(c.currentTime + 0.2);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  destroy(): void {
    void this.context?.close().catch(() => {
      /* Already closed during page teardown. */
    });
  }
}
