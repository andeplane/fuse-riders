export interface SendSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  close(code: number, reason: string): void;
  terminate(): void;
}
export const MAX_BUFFERED_BYTES = 512_000;
export const SLOW_CLIENT_MS = 3_000;
export const SLOW_CLOSE_GRACE_MS = 1_000;

/** Dropped snapshots tolerate short congestion; persistent congestion requires reconnect. */
export class LanSendGate {
  private blocked = new WeakMap<SendSocket, number>();
  constructor(private now: () => number) {}
  writable(socket: SendSocket): boolean {
    if (socket.readyState !== 1) {
      const since = this.blocked.get(socket);
      if (
        socket.readyState === 2 &&
        since !== undefined &&
        this.now() - since >= SLOW_CLIENT_MS + SLOW_CLOSE_GRACE_MS
      )
        socket.terminate();
      return false;
    }
    if (socket.bufferedAmount <= MAX_BUFFERED_BYTES) {
      this.blocked.delete(socket);
      return true;
    }
    const now = this.now(),
      since = this.blocked.get(socket);
    if (since === undefined) this.blocked.set(socket, now);
    else if (now - since >= SLOW_CLIENT_MS)
      socket.close(1013, "Slow connection; reconnect");
    return false;
  }
}
