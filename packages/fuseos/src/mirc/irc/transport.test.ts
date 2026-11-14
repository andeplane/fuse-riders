import type { SocketEvents, SocketLike, TransportHandlers } from "./transport";
import {
  createWebSocketTransport,
  IRC_SUBPROTOCOLS,
  splitFrame,
} from "./transport";

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closedWith: [number | undefined, string | undefined] | undefined;
  constructor(readonly events: SocketEvents) {}
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = [code, reason];
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const opened: Array<[string, string[]]> = [];
  const transport = createWebSocketTransport((url, protocols, events) => {
    opened.push([url, protocols]);
    const socket = new FakeSocket(events);
    sockets.push(socket);
    return socket;
  });
  const log: string[] = [];
  const handlers: TransportHandlers = {
    onOpen: () => log.push("open"),
    onLine: (text) => log.push(`line:${text}`),
    onClose: (reason) => log.push(`close:${reason}`),
  };
  const connection = transport.connect("wss://irc.test/ws", handlers);
  const socket = sockets[0];
  if (!socket) throw new Error("no socket");
  return { connection, socket, log, opened };
}

describe("createWebSocketTransport", () => {
  it("opens with the IRCv3 subprotocol and sends only while open", () => {
    const { connection, socket, log, opened } = setup();
    expect(opened).toEqual([["wss://irc.test/ws", IRC_SUBPROTOCOLS]]);
    connection.send("NICK early");
    socket.readyState = 1;
    socket.events.onOpen();
    connection.send("NICK me");
    expect(socket.sent).toEqual(["NICK me"]);
    expect(log).toEqual(["open"]);
  });

  it("splits text frames and decodes binary ones", () => {
    const { socket, log } = setup();
    socket.events.onMessage(":a PRIVMSG #c :one\r\n:a PRIVMSG #c :two\r\n");
    socket.events.onMessage(new TextEncoder().encode("PING :x").buffer);
    socket.events.onMessage(42);
    expect(log).toEqual([
      "line::a PRIVMSG #c :one",
      "line::a PRIVMSG #c :two",
      "line:PING :x",
    ]);
  });

  it("reports the close reason once, with readable defaults", () => {
    const first = setup();
    first.socket.events.onClose(1006, "");
    first.socket.events.onClose(1000, "again");
    first.socket.events.onMessage("PING :late");
    first.socket.events.onOpen();
    expect(first.log).toEqual(["close:Connection refused or lost"]);
    const second = setup();
    second.socket.events.onClose(1001, "");
    expect(second.log).toEqual(["close:Connection closed (1001)"]);
    const third = setup();
    third.socket.events.onClose(1000, "Bye");
    expect(third.log).toEqual(["close:Bye"]);
  });

  it("closes the socket on a client close and reports it once", () => {
    const { connection, socket, log } = setup();
    connection.close();
    connection.close();
    socket.readyState = 1;
    connection.send("x");
    expect(socket.closedWith).toEqual([1000, "Client quit"]);
    expect(socket.sent).toEqual([]);
    expect(log).toEqual(["close:Disconnected"]);
  });

  it("reports a socket that cannot be constructed as a close", async () => {
    const transport = createWebSocketTransport(() => {
      throw new Error("bad url");
    });
    const log: string[] = [];
    const connection = transport.connect("nonsense", {
      onOpen: () => log.push("open"),
      onLine: () => log.push("line"),
      onClose: (reason) => log.push(reason),
    });
    connection.send("x");
    await Promise.resolve();
    connection.close();
    expect(log).toEqual(["bad url"]);
    const other = createWebSocketTransport(() => {
      throw "plain";
    });
    const reasons: string[] = [];
    other
      .connect("x", {
        onOpen: () => undefined,
        onLine: () => undefined,
        onClose: (r) => reasons.push(r),
      })
      .close();
    expect(reasons).toEqual(["Closed"]);
  });
});

describe("splitFrame", () => {
  it("drops empty lines and accepts bare LF", () => {
    expect(splitFrame("a\nb\r\n\r\n")).toEqual(["a", "b"]);
  });
});
