import type { Scheduler, TimerHandle } from "../mirc/irc/client";
import type {
  IrcConnection,
  IrcTransport,
  TransportHandlers,
} from "../mirc/irc/transport";

/** One connection the fake handed out: what the client sent, and controls to play the server's part. */
export class FakeIrcLink {
  readonly sent: string[] = [];
  closed = false;

  constructor(
    readonly url: string,
    private readonly handlers: TransportHandlers,
  ) {}

  readonly connection: IrcConnection = {
    send: (line) => {
      if (!this.closed) this.sent.push(line);
    },
    close: () => {
      if (this.closed) return;
      this.closed = true;
      this.handlers.onClose("Disconnected");
    },
  };

  open() {
    this.handlers.onOpen();
  }

  /** The server sends lines (each a raw IRC line without CRLF). */
  serverSays(...lines: string[]) {
    for (const line of lines) if (!this.closed) this.handlers.onLine(line);
  }

  /** The server or the network ends the connection. */
  drop(reason = "Connection reset by peer") {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose(reason);
  }

  /** Runs the usual welcome burst for `nick`. */
  welcome(nick: string) {
    this.serverSays(
      `:irc.test 001 ${nick} :Welcome to the Test IRC Network ${nick}`,
      `:irc.test 005 ${nick} PREFIX=(qaohv)~&@%+ CHANTYPES=# NETWORK=TestNet :are supported by this server`,
      `:irc.test 376 ${nick} :End of /MOTD command.`,
    );
  }
}

/** A transport whose connections are driven by the test. */
export class FakeIrcTransport implements IrcTransport {
  readonly links: FakeIrcLink[] = [];

  connect(url: string, handlers: TransportHandlers): IrcConnection {
    const link = new FakeIrcLink(url, handlers);
    this.links.push(link);
    return link.connection;
  }

  get last(): FakeIrcLink {
    const link = this.links[this.links.length - 1];
    if (!link) throw new Error("no connection yet");
    return link;
  }
}

/** Timers the test advances by hand. */
export class ManualScheduler implements Scheduler {
  private nextId = 1;
  private time = 0;
  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >();

  now = (): number => this.time;

  setTimeout = (callback: () => void, ms: number): TimerHandle => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, callback });
    return { id };
  };

  clearTimeout = (handle: TimerHandle): void => {
    this.timers.delete(handle.id);
  };

  get pending(): number {
    return this.timers.size;
  }

  /** Moves the clock forward, firing every timer that falls due in order. */
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.timers)
        if (entry[1].at <= end && (!due || entry[1].at < due[1].at))
          due = entry;
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = end;
  }
}
