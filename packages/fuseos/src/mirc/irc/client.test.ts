import {
  FakeIrcTransport,
  ManualScheduler,
} from "../../__mocks__/ircTransport";

import type { ClientDeps } from "./client";
import {
  IrcClient,
  KEEPALIVE_INTERVAL_MS,
  MAX_RECONNECT_ATTEMPTS,
  PING_AFTER_MS,
  reconnectDelay,
  REGISTRATION_TIMEOUT_MS,
} from "./client";
import { findNetwork } from "./networks";
import type { IrcNetwork } from "./networks";
import { channelId, findWindow, LIST_ID, queryId, STATUS_ID } from "./session";

const TEST_NET: IrcNetwork = {
  id: "testnet",
  name: "TestNet",
  servers: [{ host: "irc.test", port: 6697, websocket: "wss://irc.test/ws" }],
  browserNote: [],
  connectNote: ["* Test servers log everything."],
};

function setup(overrides: Partial<ClientDeps> = {}) {
  const transport = new FakeIrcTransport();
  const scheduler = new ManualScheduler();
  const client = new IrcClient(
    { transport, scheduler, now: scheduler.now, random: () => 0, ...overrides },
    { nick: "Guest1234", altNick: "Guest1234_", realName: "Fuse User" },
  );
  let changes = 0;
  client.subscribe(() => {
    changes += 1;
  });
  return { transport, scheduler, client, changes: () => changes };
}

function statusText(client: IrcClient): string[] {
  return (
    findWindow(client.getState(), STATUS_ID)?.lines.map((l) => l.text) ?? []
  );
}

function windowText(client: IrcClient, id: string): string[] {
  return findWindow(client.getState(), id)?.lines.map((l) => l.text) ?? [];
}

function connected() {
  const env = setup();
  env.client.connect(TEST_NET);
  env.transport.last.open();
  env.transport.last.welcome("Guest1234");
  return env;
}

function joined() {
  const env = connected();
  env.transport.last.serverSays(
    ":Guest1234!u@h JOIN #fuseos-test",
    ":irc.test 353 Guest1234 = #fuseos-test :@op Guest1234",
    ":irc.test 366 Guest1234 #fuseos-test :End",
  );
  env.transport.last.sent.length = 0;
  return env;
}

describe("IrcClient connecting", () => {
  it("registers with CAP LS, NICK and USER once the socket opens", () => {
    const { client, transport, changes } = setup();
    client.connect(TEST_NET);
    expect(transport.last.url).toBe("wss://irc.test/ws");
    expect(client.getState().phase).toBe("connecting");
    expect(statusText(client)).toEqual([
      "* Connecting to irc.test (6697)",
      "* Test servers log everything.",
    ]);
    transport.last.open();
    expect(transport.last.sent).toEqual([
      "CAP LS 302",
      "NICK Guest1234",
      "USER guest1234 0 * :Fuse User",
    ]);
    expect(client.getState().phase).toBe("registering");
    transport.last.welcome("Guest1234");
    expect(client.getState()).toMatchObject({
      phase: "online",
      network: "TestNet",
      server: "irc.test:6697",
    });
    expect(client.connected).toBe(true);
    expect(changes()).toBeGreaterThan(3);
  });

  it("explains a network browsers cannot reach instead of connecting", () => {
    const { client, transport } = setup();
    const efnet = findNetwork("efnet");
    if (!efnet) throw new Error("EFnet missing");
    client.connect(efnet);
    expect(transport.links).toHaveLength(0);
    expect(client.getState().phase).toBe("offline");
    const lines = statusText(client);
    expect(lines[0]).toBe("* Connecting to irc.efnet.org (6667)");
    expect(
      lines.some((text) =>
        text.includes("EFnet doesn't accept browser connections"),
      ),
    ).toBe(true);
    expect(lines.at(-1)).toBe("* Disconnected");
  });

  it("goes through a configured bridge for a network without its own WebSocket", () => {
    const { client, transport } = setup({
      bridgeUrl: "wss://bridge.example/irc",
    });
    const efnet = findNetwork("efnet");
    if (!efnet) throw new Error("EFnet missing");
    client.connect(efnet);
    expect(transport.last.url).toBe("wss://bridge.example/irc?network=efnet");
  });

  it("times out a registration that never completes and retries", () => {
    const { client, transport, scheduler } = setup();
    client.connect(TEST_NET);
    transport.last.open();
    scheduler.advance(REGISTRATION_TIMEOUT_MS);
    expect(statusText(client)).toContain(
      "* Disconnected (Registration timed out)",
    );
    expect(transport.links[0]?.closed).toBe(true);
    scheduler.advance(reconnectDelay(1, () => 0));
    expect(transport.links).toHaveLength(2);
  });

  it("uses a sanitized ident and a default real name", () => {
    const transport = new FakeIrcTransport();
    const scheduler = new ManualScheduler();
    const client = new IrcClient(
      { transport, scheduler, now: scheduler.now, random: () => 0 },
      { nick: "[Neo]", altNick: "", realName: "", ident: "!!!" },
    );
    client.connect(TEST_NET);
    transport.last.open();
    expect(transport.last.sent[2]).toBe("USER fuseos 0 * :FuseOS user");
  });

  it("reconnects a dropped link with backoff, rejoins channels and gives up after the limit", () => {
    const { client, transport, scheduler } = joined();
    client.setAway("eating");
    transport.last.drop("Connection reset by peer");
    expect(client.getState().phase).toBe("offline");
    expect(windowText(client, channelId("#fuseos-test")).at(-1)).toBe(
      "* Disconnected (Connection reset by peer)",
    );
    expect(statusText(client).at(-1)).toBe(
      "* Retrying in 2 seconds (attempt 1 of 5)",
    );
    scheduler.advance(2000);
    expect(transport.links).toHaveLength(2);
    transport.last.open();
    transport.last.welcome("Guest1234");
    expect(transport.last.sent).toContain("JOIN #fuseos-test");
    expect(transport.last.sent).toContain("AWAY eating");
    for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      transport.last.drop();
      scheduler.advance(60_000);
    }
    expect(statusText(client).at(-1)).toBe(
      "* Giving up. Press the lightning bolt to connect again.",
    );
  });

  it("pings a quiet link and drops one that stays silent", () => {
    const { client, transport, scheduler } = connected();
    scheduler.advance(KEEPALIVE_INTERVAL_MS);
    expect(transport.last.sent).not.toContain("PING fuseos");
    scheduler.advance(PING_AFTER_MS);
    expect(transport.last.sent).toContain("PING fuseos");
    scheduler.advance(KEEPALIVE_INTERVAL_MS * 3);
    expect(
      statusText(client).some((t) =>
        t.startsWith("* Disconnected (Ping timeout"),
      ),
    ).toBe(true);
  });

  it("quits cleanly without reconnecting, and a new connect replaces the old link", () => {
    const { client, transport, scheduler } = connected();
    client.connect(TEST_NET);
    expect(transport.links[0]?.sent.at(-1)).toBe("QUIT Leaving");
    expect(transport.links).toHaveLength(2);
    transport.last.open();
    client.submit(STATUS_ID, "/quit see ya");
    expect(transport.last.sent.at(-1)).toBe("QUIT :see ya");
    scheduler.advance(120_000);
    expect(transport.links).toHaveLength(2);
    expect(client.connected).toBe(false);
  });

  it("ignores events from a link it has already replaced", () => {
    const { client, transport } = connected();
    const old = transport.last;
    client.connect(TEST_NET);
    old.serverSays(":x!y@z PRIVMSG Guest1234 :late");
    expect(findWindow(client.getState(), queryId("x"))).toBeUndefined();
  });

  it("drops lines it cannot parse", () => {
    const { client, transport } = connected();
    const before = client.getState();
    transport.last.serverSays("");
    expect(client.getState()).toBe(before);
  });
});

describe("IrcClient commands", () => {
  it("says text to a channel with a local echo carrying our prefix", () => {
    const { client, transport } = joined();
    client.submit(channelId("#fuseos-test"), "hello \x0304world");
    expect(transport.last.sent).toEqual([
      "PRIVMSG #fuseos-test :hello \x0304world",
    ]);
    expect(windowText(client, channelId("#fuseos-test")).at(-1)).toBe(
      "<Guest1234> hello \x0304world",
    );
  });

  it("splits long messages under the line limit", () => {
    const { client, transport } = joined();
    client.submit(channelId("#fuseos-test"), "word ".repeat(200));
    expect(transport.last.sent.length).toBeGreaterThan(1);
    for (const sent of transport.last.sent)
      expect(sent.length).toBeLessThanOrEqual(510);
  });

  it("sends /me as a CTCP ACTION", () => {
    const { client, transport } = joined();
    client.submit(channelId("#fuseos-test"), "/me waves");
    expect(transport.last.sent).toEqual([
      "PRIVMSG #fuseos-test :\x01ACTION waves\x01",
    ]);
    expect(windowText(client, channelId("#fuseos-test")).at(-1)).toBe(
      "* Guest1234 waves",
    );
  });

  it("sends /msg to a query window when one is open, else echoes in the active window", () => {
    const { client, transport } = joined();
    client.submit(channelId("#fuseos-test"), "/msg bob hi");
    expect(transport.last.sent).toEqual(["PRIVMSG bob hi"]);
    expect(windowText(client, channelId("#fuseos-test")).at(-1)).toBe(
      "-> *bob* hi",
    );
    client.submit(STATUS_ID, "/query bob there?");
    expect(client.getState().activeId).toBe(queryId("bob"));
    expect(windowText(client, queryId("bob"))).toEqual(["<Guest1234> there?"]);
  });

  it("sends joins, parts, hops, nick changes, whois, topic, notices and CTCPs", () => {
    const { client, transport } = joined();
    const chan = channelId("#fuseos-test");
    for (const text of [
      "/join #other key",
      "/join #plain",
      "/part",
      "/hop",
      "/nick Neo",
      "/whois bob",
      "/topic",
      "/topic new topic",
      "/notice bob psst",
      "/ctcp bob version",
      "/mode #fuseos-test +m",
    ])
      client.submit(chan, text);
    expect(transport.last.sent).toEqual([
      "JOIN #other key",
      "JOIN #plain",
      "PART #fuseos-test Leaving",
      "PART #fuseos-test Rejoining",
      "JOIN #fuseos-test",
      "NICK Neo",
      "WHOIS bob bob",
      "TOPIC #fuseos-test",
      "TOPIC #fuseos-test :new topic",
      "NOTICE bob psst",
      "PRIVMSG bob \x01VERSION\x01",
      "MODE #fuseos-test +m",
    ]);
    expect(windowText(client, chan)).toContain("-> -bob- psst");
    expect(statusText(client)).toContain("-> [bob] VERSION");
    expect(statusText(client)).toContain("-> Server: MODE #fuseos-test +m");
  });

  it("sets and clears away", () => {
    const { client, transport } = joined();
    client.setAway("Gone to lunch");
    client.setAway(undefined);
    expect(transport.last.sent).toEqual(["AWAY :Gone to lunch", "AWAY"]);
    expect(client.getState().away).toBeUndefined();
  });

  it("refuses network commands while offline but changes the nick locally", () => {
    const { client, transport } = setup();
    client.submit(STATUS_ID, "/join #fuse");
    expect(statusText(client).at(-1)).toBe("* /join: not connected to server");
    client.submit(STATUS_ID, "/nick Zero");
    expect(client.getState().nick).toBe("Zero");
    client.submit(STATUS_ID, "/query bob hi");
    expect(windowText(client, queryId("bob")).at(-1)).toBe(
      "* /msg: not connected to server",
    );
    client.submit(queryId("bob"), "hello?");
    expect(windowText(client, queryId("bob")).at(-1)).toBe(
      "* /msg: not connected to server",
    );
    client.activate(STATUS_ID);
    client.submit(STATUS_ID, "/quit");
    expect(statusText(client).at(-1)).toBe("* /quit: not connected to server");
    client.submit(STATUS_ID, "/server");
    expect(statusText(client).at(-1)).toContain("pick a network");
    expect(transport.links).toHaveLength(0);
    client.connect(TEST_NET);
    transport.last.open();
    expect(transport.last.sent[1]).toBe("NICK Zero");
  });

  it("connects with /server by network name, host or WebSocket URL", () => {
    const { client, transport } = setup();
    client.submit(STATUS_ID, "/server ergo");
    expect(transport.last.url).toBe("wss://testnet.ergo.chat/webirc");
    client.submit(STATUS_ID, "/server wss://irc.example.net:8443/ws");
    expect(transport.last.url).toBe("wss://irc.example.net:8443/ws");
    client.submit(STATUS_ID, "/disconnect");
    client.submit(STATUS_ID, "/server");
    expect(transport.links).toHaveLength(3);
    client.submit(STATUS_ID, "/server irc.undernet.org");
    expect(transport.links).toHaveLength(3);
    expect(
      statusText(client).some((t) =>
        t.includes("Undernet doesn't accept browser connections"),
      ),
    ).toBe(true);
  });

  it("handles /help, /clear, /close, /list and errors locally", () => {
    const { client } = setup();
    client.submit(STATUS_ID, "/help");
    expect(statusText(client)[0]).toBe("Commands:");
    client.submit(STATUS_ID, "/clear");
    expect(statusText(client)).toEqual([]);
    client.submit(STATUS_ID, "hello");
    expect(statusText(client)[0]).toContain("not on a channel");
    client.submit(STATUS_ID, "/list");
    expect(client.getState().activeId).toBe(LIST_ID);
    expect(client.getState().list.demo).toBe(true);
    client.submit(LIST_ID, "/close");
    expect(client.getState().activeId).toBe(STATUS_ID);
    client.submit("nope", "hello");
    client.submit(STATUS_ID, "/close");
    expect(findWindow(client.getState(), STATUS_ID)).toBeDefined();
  });

  it("asks the server for LIST when online", () => {
    const { client, transport } = joined();
    client.list();
    expect(transport.last.sent).toEqual(["LIST"]);
    expect(client.getState().list).toEqual({
      entries: [],
      demo: false,
      complete: false,
    });
  });

  it("parts a channel when its window closes and activates another window", () => {
    const { client, transport } = joined();
    client.closeWindow(channelId("#fuseos-test"));
    expect(transport.last.sent).toEqual(["PART #fuseos-test Leaving"]);
    expect(client.getState().activeId).toBe(STATUS_ID);
    client.join("#again");
    expect(transport.last.sent.at(-1)).toBe("JOIN #again");
  });

  it("updates the identity for the next connection and prints banner lines", () => {
    const { client } = setup();
    client.setIdentity({ nick: "Acid_Burn", altNick: "Acid", realName: "x" });
    expect(client.getState()).toMatchObject({
      nick: "Acid_Burn",
      altNick: "Acid",
    });
    client.print("motd", ["one", "two"]);
    expect(statusText(client)).toEqual(["one", "two"]);
    client.activate(STATUS_ID);
  });

  it("keeps the identity while online, and dispose quits", () => {
    const { client, transport } = connected();
    client.setIdentity({ nick: "Other", altNick: "", realName: "" });
    expect(client.getState().nick).toBe("Guest1234");
    client.dispose();
    expect(transport.last.closed).toBe(true);
  });
});

describe("reconnectDelay", () => {
  it("doubles from two seconds up to a minute, plus jitter", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((n) => reconnectDelay(n, () => 0)),
    ).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    expect(reconnectDelay(1, () => 0.999)).toBe(2999);
  });
});
