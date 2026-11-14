/**
 * The server list (File > Options > Connect > Servers). In 2001 every network here was a TCP host on
 * port 6667; a browser can only reach the ones that also run a WebSocket listener open to third-party
 * web clients. The rest stay in the list — it would not be mIRC without EFnet at the top — and explain
 * themselves in the Status window instead of connecting.
 */

export type IrcServer = {
  host: string;
  port: number;
  /** A WebSocket endpoint that speaks IRC (`wss://...`), when the network runs one browsers may use. */
  websocket?: string;
};

export type IrcNetwork = {
  /** What `/server <id>` accepts, lower case. */
  id: string;
  name: string;
  servers: readonly IrcServer[];
  /** Status lines shown when the network cannot be reached from a browser (no WebSocket listener). */
  browserNote: readonly string[];
  /** Status lines shown as the connection starts (who runs it, what they log). */
  connectNote?: readonly string[];
  /** A channel worth suggesting after connecting (the Channels Folder's first entry). */
  homeChannel?: string;
};

function noBrowser(name: string): readonly string[] {
  return [
    `* ${name} doesn't accept browser connections: its servers only speak plain IRC over TCP, and a web page can only open WebSockets.`,
    "* Try a network whose WebSocket gateway lets other sites in: /server ergo (Ergo testnet) or /server unrealircd.",
  ];
}

export const NETWORKS: readonly IrcNetwork[] = [
  {
    id: "efnet",
    name: "EFnet",
    servers: [{ host: "irc.efnet.org", port: 6667 }],
    browserNote: [
      ...noBrowser("EFnet").slice(0, 1),
      "* EFnet's own web gateway (chat.efnet.org) only accepts its own page, so other sites' clients are turned away.",
      ...noBrowser("EFnet").slice(1),
    ],
  },
  {
    id: "ircnet",
    name: "IRCnet",
    servers: [{ host: "open.ircnet.net", port: 6667 }],
    browserNote: noBrowser("IRCnet"),
  },
  {
    id: "undernet",
    name: "Undernet",
    servers: [{ host: "irc.undernet.org", port: 6667 }],
    browserNote: noBrowser("Undernet"),
  },
  {
    id: "dalnet",
    name: "DALnet",
    servers: [{ host: "irc.dal.net", port: 6667 }],
    browserNote: noBrowser("DALnet"),
  },
  {
    id: "quakenet",
    name: "QuakeNet",
    servers: [{ host: "irc.quakenet.org", port: 6667 }],
    browserNote: noBrowser("QuakeNet"),
  },
  {
    id: "libera",
    name: "Libera.Chat",
    servers: [{ host: "irc.libera.chat", port: 6697 }],
    browserNote: [
      "* Libera.Chat only takes web users through its own web chat (web.libera.chat), which other sites' clients cannot use.",
      "* Try /server ergo, or use web.libera.chat in a browser tab.",
    ],
  },
  {
    id: "oftc",
    name: "OFTC",
    servers: [{ host: "irc.oftc.net", port: 6697 }],
    browserNote: [
      "* OFTC's web gateway speaks socket.io, not IRC over WebSocket, so this client cannot use it.",
      "* Try /server ergo instead.",
    ],
  },
  {
    id: "ergo",
    name: "Ergo testnet",
    servers: [
      {
        host: "testnet.ergo.chat",
        port: 6697,
        websocket: "wss://testnet.ergo.chat/webirc",
      },
    ],
    browserNote: [],
    connectNote: [
      "* Ergo's testnet is a public test server: its operators log all traffic. Don't say anything private here.",
    ],
    homeChannel: "#fuseos-test",
  },
  {
    id: "unrealircd",
    name: "UnrealIRCd",
    servers: [
      {
        host: "irc.unrealircd.org",
        port: 6697,
        websocket: "wss://irc.unrealircd.org",
      },
    ],
    browserNote: [],
    connectNote: [
      "* This is UnrealIRCd's own support network: be polite, and take general chat elsewhere.",
    ],
    homeChannel: "#unreal-support",
  },
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

/**
 * `/server <host>` for a host that is not in the list: a `ws(s)://` URL connects as given; anything else is
 * a plain IRC host a browser cannot reach without a bridge.
 */
export function networkForHost(host: string): IrcNetwork {
  if (/^wss?:\/\//i.test(host)) {
    const url = new URL(host);
    return {
      id: url.hostname,
      name: url.hostname,
      servers: [
        {
          host: url.hostname,
          port: Number(url.port) || (url.protocol === "wss:" ? 443 : 80),
          websocket: host,
        },
      ],
      browserNote: [],
    };
  }
  const [name = host, port] = host.split(":");
  return {
    id: name,
    name,
    servers: [{ host: name, port: Number(port) || 6667 }],
    browserNote: noBrowser(name),
  };
}

/**
 * Where to open the socket: the network's own WebSocket listener, else the bridge (when the site has one
 * configured) asked to dial the TCP server, else nowhere.
 */
export function connectUrl(
  network: IrcNetwork,
  bridgeUrl: string | undefined,
): string | undefined {
  const server = network.servers[0];
  if (!server) return undefined;
  if (server.websocket) return server.websocket;
  if (!bridgeUrl) return undefined;
  const url = new URL(bridgeUrl);
  url.searchParams.set("network", network.id);
  return url.href;
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
