import { parseMessage } from "./message";
import type { SessionState } from "./session";
import {
  activate,
  addLine,
  addLineEverywhere,
  channelId,
  CTCP_VERSION_REPLY,
  DEFAULT_SUPPORT,
  displayPrefix,
  findWindow,
  guestNick,
  initialSession,
  LIST_ID,
  MAX_LINES,
  MAX_LIST_ENTRIES,
  nextNickAttempt,
  parseISupport,
  parseModeChanges,
  parseNamesEntry,
  queryId,
  receive,
  sortMembers,
  STATUS_ID,
} from "./session";

const NOW = Date.UTC(2001, 8, 1, 12, 0, 0);
const rand = () => 0.4242;

function feed(
  state: SessionState,
  ...lines: string[]
): { state: SessionState; send: string[] } {
  let current = state;
  const send: string[] = [];
  for (const text of lines) {
    const message = parseMessage(text);
    if (!message) throw new Error(`bad line ${text}`);
    const result = receive(current, message, NOW, rand);
    current = result.state;
    send.push(...result.send);
  }
  return { state: current, send };
}

function texts(state: SessionState, id: string): string[] {
  return findWindow(state, id)?.lines.map((entry) => entry.text) ?? [];
}

function online(nick = "me"): SessionState {
  return feed(
    { ...initialSession(nick, "me2"), phase: "registering" },
    `:irc.test 001 ${nick} :Welcome to TestNet ${nick}`,
    `:irc.test 005 ${nick} PREFIX=(qaohv)~&@%+ CHANTYPES=# CHANMODES=beI,k,l,imnpst NETWORK=TestNet :are supported`,
  ).state;
}

function inChannel(): SessionState {
  return feed(
    online(),
    ":me!u@h JOIN #fuse",
    ":irc.test 332 me #fuse :Welcome to #fuse",
    ":irc.test 333 me #fuse op!o@h 999302400",
    ":irc.test 353 me = #fuse :@op +voiced",
    ":irc.test 353 me = #fuse :me zed Alice",
    ":irc.test 366 me #fuse :End of /NAMES list.",
  ).state;
}

describe("registration", () => {
  it("goes online on 001 and reads ISUPPORT", () => {
    const state = online();
    expect(state.phase).toBe("online");
    expect(state.support).toMatchObject({
      prefixSymbols: "~&@%+",
      chantypes: "#",
      network: "TestNet",
    });
    expect(texts(state, STATUS_ID)[0]).toBe("Welcome to TestNet me");
  });

  it("answers PING with PONG and ignores PONG", () => {
    expect(feed(initialSession("me", ""), "PING :irc.test").send).toEqual([
      "PONG irc.test",
    ]);
    expect(
      feed(initialSession("me", ""), ":irc.test PONG irc.test :x").send,
    ).toEqual([]);
  });

  it("negotiates the capabilities it understands, across a multi-line LS", () => {
    const registering = {
      ...initialSession("me", ""),
      phase: "registering" as const,
    };
    const first = feed(registering, ":irc.test CAP * LS * :sasl multi-prefix");
    expect(first.send).toEqual([]);
    const second = feed(first.state, ":irc.test CAP * LS :server-time=x batch");
    expect(second.send).toEqual(["CAP REQ :multi-prefix server-time"]);
    const ack = feed(
      second.state,
      ":irc.test CAP me ACK :multi-prefix server-time",
    );
    expect(ack.state.caps).toEqual(["multi-prefix", "server-time"]);
    expect(ack.send).toEqual(["CAP END"]);
  });

  it("ends CAP when nothing is wanted or the server refuses, and stays quiet once online", () => {
    const registering = {
      ...initialSession("me", ""),
      phase: "registering" as const,
    };
    expect(feed(registering, ":irc.test CAP * LS :sasl").send).toEqual([
      "CAP END",
    ]);
    const nak = feed(registering, ":irc.test CAP me NAK :server-time");
    expect(nak.send).toEqual(["CAP END"]);
    expect(nak.state.caps).toEqual([]);
    expect(feed(online(), ":irc.test CAP me LS :multi-prefix").send).toEqual(
      [],
    );
    expect(feed(online(), ":irc.test CAP me ACK :away-notify").send).toEqual(
      [],
    );
    expect(feed(online(), ":irc.test CAP me NEW :x").send).toEqual([]);
  });

  it("tries the alternative nick, then underscores, then a Guest nick on collisions", () => {
    let state: SessionState = {
      ...initialSession("Neo", "Trinity"),
      phase: "registering",
    };
    const tried: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = feed(
        state,
        `:irc.test 433 * ${state.nick} :Nickname is already in use`,
      );
      state = result.state;
      tried.push(...result.send);
    }
    expect(tried).toEqual([
      "NICK Trinity",
      "NICK Neo__",
      "NICK Neo___",
      "NICK Guest4242",
      "NICK Guest4242",
    ]);
    expect(texts(state, STATUS_ID)[0]).toContain("trying Trinity");
  });

  it("skips an alternative nick that is the same as the nick", () => {
    expect(nextNickAttempt(initialSession("Neo", "neo"), rand)).toBe("Neo_");
    expect(guestNick(() => 0.0007)).toBe("Guest0007");
  });

  it("reports a collision after registration instead of renaming", () => {
    const result = feed(
      online(),
      ":irc.test 433 me taken :Nickname is already in use",
    );
    expect(result.send).toEqual([]);
    expect(texts(result.state, STATUS_ID).at(-1)).toBe(
      "* taken: Nickname is already in use",
    );
  });

  it("shows the MOTD and the rest of the welcome burst in Status, and tracks user modes", () => {
    const state = feed(
      online(),
      ":irc.test 375 me :- irc.test Message of the Day -",
      ":irc.test 372 me :- Be excellent to each other",
      ":irc.test 376 me :End of /MOTD command.",
      ":irc.test 251 me :There are 3 users",
      ":irc.test 221 me +iw",
      ":me MODE me :-w+x",
      ":irc.test 900 me me!u@h me :You are now logged in as me",
    ).state;
    expect(texts(state, STATUS_ID)).toContain("- Be excellent to each other");
    expect(texts(state, STATUS_ID)).toContain("There are 3 users");
    expect(state.userModes).toBe("ix");
    expect(texts(state, STATUS_ID).at(-1)).toBe("You are now logged in as me");
  });
});

describe("channels", () => {
  it("opens and activates a channel window on our own JOIN, with topic and an ordered nicklist", () => {
    const state = inChannel();
    const window = findWindow(state, channelId("#fuse"));
    expect(state.activeId).toBe(channelId("#FUSE"));
    expect(window).toMatchObject({
      kind: "channel",
      name: "#fuse",
      joined: true,
      topic: "Welcome to #fuse",
    });
    expect(window?.members.map((m) => `${displayPrefix(m)}${m.nick}`)).toEqual([
      "@op",
      "+voiced",
      "Alice",
      "me",
      "zed",
    ]);
    expect(texts(state, channelId("#fuse"))).toEqual([
      "* Now talking in #fuse",
      "* Topic is 'Welcome to #fuse'",
      "* Set by op on Sat, 01 Sep 2001 00:00:00 GMT",
    ]);
    expect(state.pendingNames).toEqual({});
  });

  it("tracks joins, parts, quits, nick changes and kicks in the nicklist", () => {
    const state = feed(
      inChannel(),
      ":bob!b@host JOIN #fuse",
      ":zed!z@host PART #fuse :later",
      ":Alice!a@host QUIT :Ping timeout",
      ":bob!b@host NICK robert",
      ":op!o@h KICK #fuse voiced :flooding",
      ":nobody PART #fuse",
    ).state;
    const window = findWindow(state, channelId("#fuse"));
    expect(window?.members.map((m) => m.nick)).toEqual(["op", "me", "robert"]);
    expect(texts(state, channelId("#fuse")).slice(3)).toEqual([
      "* bob (b@host) has joined #fuse",
      "* zed (z@host) has left #fuse (later)",
      "* Alice (a@host) has quit IRC (Ping timeout)",
      "* bob is now known as robert",
      "* voiced was kicked by op (flooding)",
      "* nobody has left #fuse",
    ]);
  });

  it("marks the channel left on our own PART or KICK and keeps the window", () => {
    const parted = feed(inChannel(), ":me!u@h PART #fuse").state;
    expect(findWindow(parted, channelId("#fuse"))).toMatchObject({
      joined: false,
      members: [],
    });
    expect(texts(parted, channelId("#fuse")).at(-1)).toBe(
      "* You have left #fuse",
    );
    const kicked = feed(inChannel(), ":op!o@h KICK #fuse me :bye").state;
    expect(findWindow(kicked, channelId("#fuse"))?.joined).toBe(false);
    expect(texts(kicked, channelId("#fuse")).at(-1)).toBe(
      "* You were kicked from #fuse by op (bye)",
    );
  });

  it("applies prefix modes and channel modes, ignoring list modes", () => {
    const state = feed(
      inChannel(),
      ":irc.test 324 me #fuse +ntk secret",
      ":op!o@h MODE #fuse +o-v+b+l Alice voiced *!*@spam 50",
      ":op!o@h MODE #fuse -k+v secret Alice",
    ).state;
    const window = findWindow(state, channelId("#fuse"));
    expect(window?.modes).toBe("ntl");
    expect(window?.members.find((m) => m.nick === "Alice")?.prefixes).toBe(
      "@+",
    );
    expect(window?.members.find((m) => m.nick === "voiced")?.prefixes).toBe("");
    expect(window?.members[0]?.nick).toBe("Alice");
    expect(texts(state, channelId("#fuse")).at(-1)).toBe(
      "* op sets mode: -k+v secret Alice",
    );
  });

  it("updates the topic on TOPIC and on 331/332", () => {
    const state = feed(
      inChannel(),
      ":op!o@h TOPIC #fuse :New topic",
      ":irc.test 331 me #fuse :No topic",
    ).state;
    expect(findWindow(state, channelId("#fuse"))?.topic).toBe("New topic");
    expect(texts(state, channelId("#fuse")).slice(-2)).toEqual([
      "* op changes topic to 'New topic'",
      "* No topic is set",
    ]);
  });

  it("renames the user everywhere on their own nick change", () => {
    const state = feed(inChannel(), ":me!u@h NICK neo").state;
    expect(state.nick).toBe("neo");
    expect(texts(state, STATUS_ID).at(-1)).toBe("* Your nick is now neo");
    expect(
      findWindow(state, channelId("#fuse"))?.members.some(
        (m) => m.nick === "neo",
      ),
    ).toBe(true);
  });
});

describe("messages", () => {
  it("shows channel messages with the sender's prefix and highlights mentions", () => {
    const state = activate(
      feed(
        inChannel(),
        ":op!o@h PRIVMSG #fuse :hello everyone",
        ":zed!z@h PRIVMSG #fuse :hey me, sup?",
      ).state,
      STATUS_ID,
    );
    const window = findWindow(state, channelId("#fuse"));
    expect(window?.lines.slice(-2).map((l) => l.text)).toEqual([
      "<@op> hello everyone",
      "<zed> hey me, sup?",
    ]);
    expect(window?.lines.at(-1)?.highlight).toBe(true);
    expect(window?.lines.at(-2)?.highlight).toBeUndefined();
    const later = feed(
      state,
      ":zed!z@h PRIVMSG #fuse :mention of meme is not a highlight",
    ).state;
    expect(
      findWindow(later, channelId("#fuse"))?.lines.at(-1)?.highlight,
    ).toBeUndefined();
  });

  it("opens a query window for a private message and flags it", () => {
    const state = feed(inChannel(), ":bob!b@h PRIVMSG me :psst").state;
    const window = findWindow(state, queryId("bob"));
    expect(window).toMatchObject({ kind: "query", name: "bob", activity: 3 });
    expect(texts(state, queryId("BOB"))).toEqual(["<bob> psst"]);
  });

  it("shows ACTIONs as * nick text", () => {
    const state = feed(
      inChannel(),
      ":op!o@h PRIVMSG #fuse :\x01ACTION waves\x01",
    ).state;
    expect(findWindow(state, channelId("#fuse"))?.lines.at(-1)).toMatchObject({
      kind: "action",
      text: "* op waves",
    });
  });

  it("uses the server-time tag for the line time", () => {
    const state = feed(
      inChannel(),
      "@time=2001-09-01T08:30:00.000Z :op!o@h PRIVMSG #fuse :early",
      "@time=nonsense :op!o@h PRIVMSG #fuse :x",
    ).state;
    const lines = findWindow(state, channelId("#fuse"))?.lines ?? [];
    expect(lines.at(-2)?.time).toBe(Date.UTC(2001, 8, 1, 8, 30));
    expect(lines.at(-1)?.time).toBe(NOW);
  });

  it("routes notices: server and pre-registration ones to Status, private ones to the active window", () => {
    const early = feed(
      initialSession("me", ""),
      ":irc.test NOTICE * :*** Looking up your hostname...",
    ).state;
    expect(texts(early, STATUS_ID)).toEqual([
      "-irc.test- *** Looking up your hostname...",
    ]);
    const state = feed(
      inChannel(),
      ":bob!b@h NOTICE me :hi there",
      ":op!o@h NOTICE #fuse :channel notice",
    ).state;
    expect(texts(state, channelId("#fuse")).slice(-2)).toEqual([
      "-bob- hi there",
      "-op:#fuse- channel notice",
    ]);
  });

  it("answers VERSION, PING, TIME and CLIENTINFO privately, never to a channel", () => {
    const state = inChannel();
    expect(feed(state, ":bob!b@h PRIVMSG me :\x01VERSION\x01").send).toEqual([
      `NOTICE bob :\x01VERSION ${CTCP_VERSION_REPLY}\x01`,
    ]);
    expect(feed(state, ":bob!b@h PRIVMSG me :\x01PING 42\x01").send).toEqual([
      "NOTICE bob :\x01PING 42\x01",
    ]);
    expect(feed(state, ":bob!b@h PRIVMSG me :\x01TIME\x01").send[0]).toContain(
      "TIME ",
    );
    expect(
      feed(state, ":bob!b@h PRIVMSG me :\x01CLIENTINFO\x01").send[0],
    ).toContain("ACTION CLIENTINFO");
    expect(feed(state, ":bob!b@h PRIVMSG me :\x01FINGER\x01").send).toEqual([]);
    expect(feed(state, ":bob!b@h PRIVMSG #fuse :\x01VERSION\x01").send).toEqual(
      [],
    );
    expect(
      texts(
        feed(state, ":bob!b@h PRIVMSG me :\x01VERSION\x01").state,
        STATUS_ID,
      ).at(-1),
    ).toBe("[bob VERSION]");
    expect(
      texts(
        feed(state, ":bob!b@h PRIVMSG me :\x01PING 1\x01").state,
        STATUS_ID,
      ).at(-1),
    ).toBe("[bob PING] 1");
  });

  it("shows CTCP replies in the active window", () => {
    const state = feed(
      inChannel(),
      ":bob!b@h NOTICE me :\x01VERSION SomeClient 1.0\x01",
    ).state;
    expect(texts(state, channelId("#fuse")).at(-1)).toBe(
      "[bob VERSION reply]: SomeClient 1.0",
    );
  });

  it("shows invites, ignores AWAY notifications and reports ERROR", () => {
    const state = feed(
      inChannel(),
      ":bob!b@h INVITE me #secret",
      ":bob!b@h AWAY :lunch",
      "ERROR :Closing Link: K-lined",
      ":x UNKNOWNCMD",
    ).state;
    expect(texts(state, channelId("#fuse")).at(-1)).toBe(
      "* bob invites you to join #secret",
    );
    expect(texts(state, STATUS_ID).at(-1)).toBe("* Closing Link: K-lined");
  });
});

describe("whois, away and errors", () => {
  it("formats a WHOIS reply in the active window", () => {
    const state = feed(
      inChannel(),
      ":irc.test 311 me bob b host.example * :Bob B",
      ":irc.test 319 me bob :@#fuse #other",
      ":irc.test 312 me bob irc.test :Test server",
      ":irc.test 313 me bob :is an IRC operator",
      ":irc.test 301 me bob :gone fishing",
      ":irc.test 317 me bob 3725 999302400 :seconds idle, signon time",
      ":irc.test 317 me bob 61 :seconds idle",
      ":irc.test 318 me bob :End of /WHOIS list.",
    ).state;
    expect(texts(state, channelId("#fuse")).slice(-8)).toEqual([
      "bob is b@host.example * Bob B",
      "bob on @#fuse #other",
      "bob using irc.test Test server",
      "bob is an IRC operator",
      "bob is away: gone fishing",
      "bob has been idle 1hr 2mins 5secs, signon: Sat, 01 Sep 2001 00:00:00 GMT",
      "bob has been idle 1min 1sec",
      "bob End of /WHOIS list.",
    ]);
  });

  it("shows the away reply in an open query and tracks our own away state", () => {
    const withQuery = feed(
      inChannel(),
      ":bob!b@h PRIVMSG me :hi",
      ":irc.test 301 me bob :brb",
    ).state;
    expect(texts(withQuery, queryId("bob")).at(-1)).toBe("bob is away: brb");
    const away = feed(
      { ...inChannel(), away: "lunch" },
      ":irc.test 306 me :You have been marked as being away",
    ).state;
    expect(texts(away, channelId("#fuse")).at(-1)).toBe(
      "* You have been marked as being away",
    );
    const back = feed(
      away,
      ":irc.test 305 me :You are no longer marked as being away",
    ).state;
    expect(back.away).toBeUndefined();
  });

  it("shows join failures and other errors where the user is looking", () => {
    const state = feed(
      inChannel(),
      ":irc.test 474 me #banned :Cannot join channel (+b)",
      ":irc.test 421 me FOO :Unknown command",
      ":irc.test 499 me :Something odd",
      ":irc.test 329 me #fuse 999302400",
    ).state;
    expect(texts(state, channelId("#fuse")).slice(-3)).toEqual([
      "* #banned Cannot join channel (+b)",
      "* FOO: Unknown command",
      "* Something odd",
    ]);
  });
});

describe("channels list", () => {
  it("collects a LIST reply into the list window, bounded", () => {
    const state = feed(
      online(),
      ":irc.test 321 me Channel :Users Name",
      ":irc.test 322 me #fuse 12 :Fuse games",
      ":irc.test 322 me #odd x :no number",
      ":irc.test 323 me :End of /LIST",
    ).state;
    expect(findWindow(state, LIST_ID)?.kind).toBe("list");
    expect(state.list).toEqual({
      entries: [
        { channel: "#fuse", users: 12, topic: "Fuse games" },
        { channel: "#odd", users: 0, topic: "no number" },
      ],
      demo: false,
      complete: true,
    });
    const full = {
      ...state,
      list: {
        ...state.list,
        entries: Array.from({ length: MAX_LIST_ENTRIES }, () => ({
          channel: "#x",
          users: 1,
          topic: "",
        })),
      },
    };
    expect(
      feed(full, ":irc.test 322 me #more 1 :x").state.list.entries,
    ).toHaveLength(MAX_LIST_ENTRIES);
  });
});

describe("helpers", () => {
  it("bounds each window to MAX_LINES and flags inactive windows by importance", () => {
    let state = inChannel();
    state = activate(state, STATUS_ID);
    for (let index = 0; index < MAX_LINES + 5; index += 1)
      state = addLine(state, channelId("#fuse"), "join", `line ${index}`, NOW);
    const window = findWindow(state, channelId("#fuse"));
    expect(window?.lines).toHaveLength(MAX_LINES);
    expect(window?.lines[0]?.text).toBe("line 5");
    expect(window?.activity).toBe(1);
    expect(activate(state, "nope")).toBe(state);
    expect(
      findWindow(activate(state, channelId("#fuse")), channelId("#fuse"))
        ?.activity,
    ).toBe(0);
  });

  it("falls back to Status for a window that is not open and skips the list window when broadcasting", () => {
    const state = addLine(
      initialSession("me", ""),
      "chan:#gone",
      "info",
      "x",
      NOW,
    );
    expect(texts(state, STATUS_ID)).toEqual(["x"]);
    const withList = feed(
      online(),
      ":irc.test 321 me Channel :Users Name",
    ).state;
    const everywhere = addLineEverywhere(
      withList,
      "error",
      "* Disconnected",
      NOW,
    );
    expect(findWindow(everywhere, LIST_ID)?.lines).toEqual([]);
  });

  it("parses ISUPPORT edge cases", () => {
    expect(
      parseISupport(DEFAULT_SUPPORT, [
        "PREFIX=(ov)@",
        "CHANTYPES=",
        "NETWORK=",
        "CHANMODES=b",
      ]),
    ).toEqual({
      ...DEFAULT_SUPPORT,
      chanmodes: ["b", "", "", ""],
    });
  });

  it("parses NAMES entries with multi-prefix and userhost-in-names", () => {
    expect(parseNamesEntry("+@bob!b@host", { ...DEFAULT_SUPPORT })).toEqual({
      nick: "bob",
      prefixes: "@+",
      userhost: "b@host",
    });
    expect(parseNamesEntry("plain", DEFAULT_SUPPORT)).toEqual({
      nick: "plain",
      prefixes: "",
    });
  });

  it("parses mode changes, giving parameters only to modes that take them", () => {
    expect(parseModeChanges("+lk-l", ["10", "key"], DEFAULT_SUPPORT)).toEqual([
      { adding: true, mode: "l", param: "10" },
      { adding: true, mode: "k", param: "key" },
      { adding: false, mode: "l" },
    ]);
    expect(parseModeChanges("+o", [], DEFAULT_SUPPORT)).toEqual([
      { adding: true, mode: "o" },
    ]);
  });

  it("sorts members with unknown prefixes last", () => {
    expect(
      sortMembers(
        [
          { nick: "b", prefixes: "" },
          { nick: "a", prefixes: "!" },
          { nick: "c", prefixes: "@" },
        ],
        DEFAULT_SUPPORT,
      ).map((m) => m.nick),
    ).toEqual(["c", "a", "b"]);
  });
});
