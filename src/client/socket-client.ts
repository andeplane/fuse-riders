import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

const HEARTBEAT_MS = 2_000;
/** WebSocket.OPEN per the WHATWG spec — kept as a literal so tests do not need the DOM WebSocket global. */
const WEBSOCKET_OPEN = 1;

/** The subset of the WebSocket instance surface SocketClient uses, so tests can supply a typed fake. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: (event: Event) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
}

export type WebSocketFactory = () => WebSocketLike;

function websocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export class SocketClient {
  socket?: WebSocketLike;
  heartbeat?: ReturnType<typeof setInterval>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  intentionallyClosed = false;
  retry = 0;
  pingId = 0;
  constructor(
    private readonly authenticate: () => ClientMessage | undefined,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onStatus: (connected: boolean, reason?: 'replaced') => void,
    private readonly onRoundTrip?: (milliseconds: number) => void,
    private readonly createSocket: WebSocketFactory = () => new WebSocket(websocketUrl()),
  ) {}

  connect(): void {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    this.intentionallyClosed = false;
    const previous = this.socket;
    const socket = this.createSocket();
    this.socket = socket;
    // A prior connect() may still be CONNECTING (e.g. a stalled join-form submit retried on flaky
    // Wi-Fi). Close it now that this.socket points at the new one — its own listeners already guard
    // on `socket !== this.socket`, so this close is ignored rather than reported as a real disconnect.
    if (previous && previous !== socket) previous.close();
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.retry = 0;
      this.onStatus(true);
      const auth = this.authenticate();
      if (auth) this.send(auth);
      this.heartbeat = setInterval(() => {
        this.send({ type: 'heartbeat' });
        this.send({ type: 'ping', id: this.pingId++, sentAt: performance.now() });
      }, HEARTBEAT_MS);
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'pong') { this.onRoundTrip?.(performance.now() - message.sentAt); return; }
        this.onMessage(message);
      } catch {
        // Ignore malformed server frames; the next complete snapshot repairs the view.
      }
    });
    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return;
      clearInterval(this.heartbeat);
      if (event.code === 4001) this.intentionallyClosed = true;
      this.onStatus(false, event.code === 4001 ? 'replaced' : undefined);
      if (!this.intentionallyClosed) {
        const delay = Math.min(3_000, 300 * 2 ** this.retry++);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    });
    socket.addEventListener('error', () => socket.close());
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WEBSOCKET_OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.intentionallyClosed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    this.socket?.close();
  }
}
