/**
 * Room status text arrives on two cadences. Connection and pause text repeats forever: every accepted world
 * frame (20 Hz) and every runtime tick (100 Hz) restate it. Notices happen once — a host `error` reply, a
 * rejected command, a protocol failure — and a player has to be able to read them. Emitting every repetition
 * hid every notice within one frame (#23), so recurring text is emitted only when it changes, a notice holds
 * the line for a bounded time before the current recurring text returns, and a terminal notice holds forever.
 * The clock is injected; nothing here schedules work of its own.
 */
export const NOTICE_HOLD_MS = 4000;
export class StatusNotices {
  private recurringText?: string;
  private emitted?: string;
  private holdUntil = -Infinity;
  private terminated = false;
  constructor(
    private readonly now: () => number,
    private readonly emit: (text: string) => void,
  ) {}
  /** Repeating connection/pause text: shown on a change only, and never over a live notice. */
  recurring(text: string): void {
    if (this.terminated) return;
    this.recurringText = text;
    this.refresh();
  }
  /** One-shot text that must stay readable; a later notice replaces it and repeats extend the hold. */
  notice(text: string): void {
    if (this.terminated) return;
    this.holdUntil = this.now() + NOTICE_HOLD_MS;
    this.show(text);
  }
  /** Unrecoverable for this page (protocol mismatch, replaced host tab): nothing may overwrite it. */
  terminal(text: string): void {
    if (this.terminated) return;
    this.show(text);
    this.terminated = true;
  }
  /**
   * Routine rejections — a single input frame the host refused — are network noise, not something a player
   * acts on: show them, but let the next tick restore the connection status and never hide a live notice.
   */
  transient(text: string): void {
    if (this.terminated || this.now() < this.holdUntil) return;
    this.show(text);
  }
  /** Called every runtime tick: restores the current recurring status once a notice hold has expired. */
  refresh(): void {
    if (
      this.terminated ||
      this.now() < this.holdUntil ||
      this.recurringText === undefined
    )
      return;
    this.show(this.recurringText);
  }
  private show(text: string): void {
    if (text === this.emitted) return;
    this.emitted = text;
    this.emit(text);
  }
}
