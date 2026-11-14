import {
  connectUrl,
  DEFAULT_NETWORK_ID,
  demoChannelList,
  findNetwork,
  NETWORKS,
  networkForHost,
  simNetwork,
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
      ]),
    );
    expect(findNetwork(DEFAULT_NETWORK_ID)?.name).toBe("EFnet");
  });

  it("finds networks by id, name or host", () => {
    expect(findNetwork("EFNET")?.id).toBe("efnet");
    expect(findNetwork("libera.chat")?.id).toBe("libera");
    expect(findNetwork("irc.dal.net")?.id).toBe("dalnet");
    expect(findNetwork("nowhere")).toBeUndefined();
  });

  it("makes an ad-hoc network for a host not in the list", () => {
    expect(networkForHost("irc.Example.net:7000")).toEqual({
      id: "irc.example.net",
      name: "irc.Example.net",
      servers: [{ host: "irc.Example.net", port: 7000 }],
    });
    expect(networkForHost("irc.example.net").servers[0]?.port).toBe(6667);
  });

  it("connects to the simulation, or the bridge when one is configured", () => {
    const efnet = findNetwork("efnet");
    if (!efnet) throw new Error("missing EFnet");
    expect(connectUrl(efnet, undefined)).toBe("sim://efnet");
    expect(connectUrl(efnet, "wss://bridge.example/irc?x=1")).toBe(
      "wss://bridge.example/irc?x=1&network=efnet",
    );
    expect(simNetwork("sim://efnet")).toEqual({ id: "efnet", name: "EFnet" });
    expect(simNetwork("sim://irc.example.net")).toEqual({
      id: "irc.example.net",
      name: "irc.example.net",
    });
  });

  it("has a demo channel list", () => {
    expect(demoChannelList().length).toBeGreaterThan(10);
  });
});
