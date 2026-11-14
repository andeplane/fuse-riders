import {
  connectUrl,
  DEFAULT_NETWORK_ID,
  demoChannelList,
  findNetwork,
  NETWORKS,
  networkForHost,
} from "./networks";

describe("networks", () => {
  it("lists the classic networks with EFnet as the default", () => {
    expect(NETWORKS.map((network) => network.name)).toEqual(
      expect.arrayContaining([
        "EFnet",
        "IRCnet",
        "Undernet",
        "DALnet",
        "QuakeNet",
        "Libera.Chat",
        "OFTC",
        "Ergo testnet",
      ]),
    );
    expect(findNetwork(DEFAULT_NETWORK_ID)?.name).toBe("EFnet");
  });

  it("gives every network either a WebSocket endpoint or an explanation", () => {
    for (const network of NETWORKS) {
      const websocket = network.servers[0]?.websocket;
      if (websocket) expect(websocket).toMatch(/^wss:\/\//);
      else expect(network.browserNote.length).toBeGreaterThan(0);
    }
  });

  it("finds networks by id, name or host", () => {
    expect(findNetwork("ERGO")?.id).toBe("ergo");
    expect(findNetwork("libera.chat")?.id).toBe("libera");
    expect(findNetwork("irc.dal.net")?.id).toBe("dalnet");
    expect(findNetwork("nowhere")).toBeUndefined();
  });

  it("makes an ad-hoc network for a WebSocket URL or a plain host", () => {
    expect(networkForHost("wss://irc.example.net/ws").servers[0]).toEqual({
      host: "irc.example.net",
      port: 443,
      websocket: "wss://irc.example.net/ws",
    });
    expect(networkForHost("ws://localhost:8067").servers[0]?.port).toBe(8067);
    expect(networkForHost("ws://localhost").servers[0]?.port).toBe(80);
    const plain = networkForHost("irc.example.net:7000");
    expect(plain.servers[0]).toEqual({ host: "irc.example.net", port: 7000 });
    expect(plain.browserNote[0]).toContain(
      "irc.example.net doesn't accept browser connections",
    );
    expect(networkForHost("irc.example.net").servers[0]?.port).toBe(6667);
  });

  it("connects to the network's own WebSocket, else the bridge, else nowhere", () => {
    const ergo = findNetwork("ergo");
    const efnet = findNetwork("efnet");
    if (!ergo || !efnet) throw new Error("missing networks");
    expect(connectUrl(ergo, "wss://bridge.example/")).toBe(
      "wss://testnet.ergo.chat/webirc",
    );
    expect(connectUrl(efnet, undefined)).toBeUndefined();
    expect(connectUrl(efnet, "wss://bridge.example/irc?x=1")).toBe(
      "wss://bridge.example/irc?x=1&network=efnet",
    );
    expect(
      connectUrl({ ...efnet, servers: [] }, "wss://bridge.example/"),
    ).toBeUndefined();
  });

  it("has a demo channel list", () => {
    expect(demoChannelList().length).toBeGreaterThan(10);
  });
});
