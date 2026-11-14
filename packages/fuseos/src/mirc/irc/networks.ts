/**
 * The server list (File > Options > Connect > Servers), as a 2001 install shipped it, EFnet first. A web page
 * cannot open IRC's TCP connections, and no public WebSocket gateway welcomes other sites' clients (EFnet's and
 * Libera's only take their own pages; KiwiIRC's hosted gateway publishes no permission), so every network
 * here is simulated inside FuseOS unless the site owner configures a bridge.
 */

export type IrcServer = {
  host: string;
  port: number;
};

export type IrcNetwork = {
  /** What `/server <id>` accepts, lower case. */
  id: string;
  name: string;
  servers: readonly IrcServer[];
};

export const NETWORKS: readonly IrcNetwork[] = [
  {
    id: "efnet",
    name: "EFnet",
    servers: [{ host: "irc.efnet.org", port: 6667 }],
  },
  {
    id: "ircnet",
    name: "IRCnet",
    servers: [{ host: "open.ircnet.net", port: 6667 }],
  },
  {
    id: "undernet",
    name: "Undernet",
    servers: [{ host: "irc.undernet.org", port: 6667 }],
  },
  {
    id: "dalnet",
    name: "DALnet",
    servers: [{ host: "irc.dal.net", port: 6667 }],
  },
  {
    id: "quakenet",
    name: "QuakeNet",
    servers: [{ host: "irc.quakenet.org", port: 6667 }],
  },
  {
    id: "libera",
    name: "Libera.Chat",
    servers: [{ host: "irc.libera.chat", port: 6697 }],
  },
  { id: "oftc", name: "OFTC", servers: [{ host: "irc.oftc.net", port: 6697 }] },
];

export const DEFAULT_NETWORK_ID = "efnet";

export function findNetwork(query: string): IrcNetwork | undefined {
  const wanted = query.toLowerCase();
  return NETWORKS.find(
    (network) =>
      network.id === wanted ||
      network.name.toLowerCase() === wanted ||
      network.servers.some((server) => server.host === wanted),
  );
}

/** `/server <host>` for a host that is not in the list: a simulated network named after it. */
export function networkForHost(host: string): IrcNetwork {
  const [name = host, port] = host.split(":");
  return {
    id: name.toLowerCase(),
    name,
    servers: [{ host: name, port: Number(port) || 6667 }],
  };
}

/** The scheme of the in-page simulated networks (`sim://efnet`), which `createSimTransport` serves. */
export const SIM_SCHEME = "sim:";

/**
 * Where to connect: the WebSocket↔IRC bridge when the site owner has configured one (docs/fuseos/mirc.md),
 * otherwise the network's simulation in this page.
 */
export function connectUrl(
  network: IrcNetwork,
  bridgeUrl: string | undefined,
): string {
  if (!bridgeUrl) return `${SIM_SCHEME}//${encodeURIComponent(network.id)}`;
  const url = new URL(bridgeUrl);
  url.searchParams.set("network", network.id);
  return url.href;
}

/** The network a `sim://` URL names, for the simulated transport. */
export function simNetwork(url: string): { id: string; name: string } {
  const id = decodeURIComponent(url.replace(/^sim:\/\//, ""));
  const known = findNetwork(id);
  return known ? { id: known.id, name: known.name } : { id, name: id };
}

/**
 * The Channels List shown when offline: what a /list on a big network looked like around 2001. The names
 * and topics are made up in the spirit of the time; they are not copied from any real channel.
 */
export function demoChannelList(): {
  channel: string;
  users: number;
  topic: string;
}[] {
  return [
    {
      channel: "#chatzone",
      users: 412,
      topic: "Welcome to #chatzone! Be nice, no flooding, no ASL spam :)",
    },
    {
      channel: "#winamp-skins",
      users: 87,
      topic: "It really whips. Share your skins, link to your page",
    },
    {
      channel: "#quake3arena",
      users: 233,
      topic: "Q3A pickups tonight 9pm EST | servers in /topic | no camping",
    },
    {
      channel: "#counterstrike",
      users: 318,
      topic: "CS beta 7.1 is out!! | clan wars on fridays | no hax",
    },
    {
      channel: "#starcraft",
      users: 156,
      topic: "Brood War 1.08 | looking for 2v2 on USEast | gg no re",
    },
    {
      channel: "#diablo2",
      users: 201,
      topic: "LoD trading | no dupes | hardcore ladder talk welcome",
    },
    {
      channel: "#webdesign",
      users: 64,
      topic: "Tables vs frames debate is OVER | best viewed at 800x600",
    },
    {
      channel: "#linux",
      users: 298,
      topic: "RTFM | kernel 2.4 is out | no distro wars please",
    },
    {
      channel: "#help",
      users: 120,
      topic: "Ask your question and wait. Don't ask to ask.",
    },
    {
      channel: "#mirchelp",
      users: 95,
      topic: "Scripting help: aliases, popups, remotes | paste to a pastebin",
    },
    {
      channel: "#y2k",
      users: 12,
      topic: "We made it. The toaster still works.",
    },
    {
      channel: "#dialup",
      users: 33,
      topic: "56k club | don't pick up the phone!!",
    },
    {
      channel: "#anime",
      users: 176,
      topic: "Fansub talk | no spoilers without warning",
    },
    {
      channel: "#gamedev",
      users: 58,
      topic: "OpenGL vs Direct3D, round 47 | post your screenshots",
    },
    {
      channel: "#trivia",
      users: 143,
      topic: "Trivia bot running | !start to play | 1500 questions",
    },
    { channel: "#friends", users: 77, topic: "Just hanging out. Say hi!" },
  ];
}
