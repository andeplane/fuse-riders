/**
 * How the client reaches an IRC server. Browsers cannot open raw TCP, so the production adapter is a
 * WebSocket carrying IRC lines (the IRCv3 WebSocket binding: one message per frame, `text.ircv3.net`
 * subprotocol). Tests supply a typed fake through the same interface.
 */

export type TransportHandlers = {
  onOpen: () => void;
  /** One IRC line, without CRLF. */
  onLine: (line: string) => void;
  /** The connection ended; `reason` is for the Status window. Called once, after which nothing else is. */
  onClose: (reason: string) => void;
};

export type IrcConnection = {
  send: (line: string) => void;
  close: () => void;
};

export type IrcTransport = {
  connect: (url: string, handlers: TransportHandlers) => IrcConnection;
};

/** What a socket reports back to the adapter. */
export type SocketEvents = {
  onOpen: () => void;
  onMessage: (data: unknown) => void;
  onClose: (code: number, reason: string) => void;
};

/** The parts of the browser `WebSocket` the adapter uses, so the adapter itself can be tested with a fake socket. */
export type SocketLike = {
  readonly readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

export type WebSocketFactory = (
  url: string,
  protocols: string[],
  events: SocketEvents,
) => SocketLike;

export const IRC_SUBPROTOCOLS = ["text.ircv3.net"];
const OPEN = 1;

/** Splits a frame into lines: one per frame is the norm, but gateways that batch with CRLF are tolerated. */
export function splitFrame(frame: string): string[] {
  return frame.split(/\r?\n/).filter((part) => part.length > 0);
}

export function createWebSocketTransport(
  factory: WebSocketFactory,
): IrcTransport {
  return {
    connect(url, handlers) {
      let closed = false;
      const finish = (reason: string) => {
        if (closed) return;
        closed = true;
        handlers.onClose(reason);
      };
      const decoder = new TextDecoder();
      let socket: SocketLike;
      try {
        socket = factory(url, IRC_SUBPROTOCOLS, {
          onOpen: () => {
            if (!closed) handlers.onOpen();
          },
          onMessage: (data) => {
            if (closed) return;
            const text =
              typeof data === "string"
                ? data
                : data instanceof ArrayBuffer
                  ? decoder.decode(data)
                  : "";
            for (const part of splitFrame(text)) handlers.onLine(part);
          },
          onClose: (code, reason) =>
            finish(
              reason.length > 0
                ? reason
                : code === 1006
                  ? "Connection refused or lost"
                  : `Connection closed (${code})`,
            ),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        queueMicrotask(() => finish(reason));
        return { send: () => undefined, close: () => finish("Closed") };
      }
      return {
        send(line) {
          if (!closed && socket.readyState === OPEN) socket.send(line);
        },
        close() {
          if (closed) return;
          socket.close(1000, "Client quit");
          finish("Disconnected");
        },
      };
    },
  };
}

/** The production adapter over the browser's WebSocket. */
export function browserWebSocketTransport(): IrcTransport {
  return createWebSocketTransport((url, protocols, events) => {
    const socket = new WebSocket(url, protocols);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => events.onOpen();
    socket.onmessage = (event) => events.onMessage(event.data);
    socket.onclose = (event) => events.onClose(event.code, event.reason);
    return socket;
  });
}
