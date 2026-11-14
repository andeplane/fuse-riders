import {
  byteLength,
  escapeTagValue,
  formatCtcp,
  line,
  MAX_INBOUND_LINE_LENGTH,
  parseCtcp,
  parseMessage,
  parsePrefix,
  serializeMessage,
  splitByBytes,
  unescapeTagValue,
} from "./message";

describe("parseMessage", () => {
  it("parses a PRIVMSG with a full prefix and trailing parameter", () => {
    expect(
      parseMessage(":alice!ali@example.org PRIVMSG #fuse :hello there\r\n"),
    ).toEqual({
      tags: {},
      prefix: {
        raw: "alice!ali@example.org",
        nick: "alice",
        user: "ali",
        host: "example.org",
      },
      command: "PRIVMSG",
      params: ["#fuse", "hello there"],
    });
  });

  it("parses a numeric with middle parameters and no prefix user", () => {
    const message = parseMessage(":irc.test 353 me = #fuse :@alice +bob carol");
    expect(message?.prefix).toEqual({ raw: "irc.test", nick: "irc.test" });
    expect(message?.command).toBe("353");
    expect(message?.params).toEqual(["me", "=", "#fuse", "@alice +bob carol"]);
  });

  it("parses IRCv3 tags with escapes, valueless tags and empty values", () => {
    const message = parseMessage(
      "@time=2001-09-01T12:00:00.000Z;msgid=a\\sb\\:c\\\\d\\r\\n\\x;draft/bot;empty= :n!u@h PRIVMSG #c :hi",
    );
    expect(message?.tags).toEqual({
      time: "2001-09-01T12:00:00.000Z",
      msgid: "a b;c\\d\r\nx",
      "draft/bot": true,
      empty: true,
    });
  });

  it("upper-cases the command, tolerates extra spaces and keeps an empty trailing parameter", () => {
    expect(parseMessage("ping   :token")).toEqual({
      tags: {},
      command: "PING",
      params: ["token"],
    });
    expect(parseMessage(":n!u@h TOPIC #c :")?.params).toEqual(["#c", ""]);
    expect(parseMessage("JOIN #a")?.params).toEqual(["#a"]);
  });

  it("rejects empty, prefix-only, tag-only and oversized lines", () => {
    expect(parseMessage("")).toBeUndefined();
    expect(parseMessage("\r\n")).toBeUndefined();
    expect(parseMessage(":prefix")).toBeUndefined();
    expect(parseMessage("@a=b")).toBeUndefined();
    expect(parseMessage(":prefix ")).toBeUndefined();
    expect(
      parseMessage(`PRIVMSG #c :${"x".repeat(MAX_INBOUND_LINE_LENGTH)}`),
    ).toBeUndefined();
  });

  it("treats a colon in the command position as a word, not a trailing parameter", () => {
    expect(parseMessage(":x :weird")?.command).toBe(":WEIRD");
  });
});

describe("parsePrefix", () => {
  it("handles nick@host without a user", () => {
    expect(parsePrefix("nick@host")).toEqual({
      raw: "nick@host",
      nick: "nick",
      host: "host",
    });
  });

  it("handles nick!user without a host", () => {
    expect(parsePrefix("nick!user")).toEqual({
      raw: "nick!user",
      nick: "nick",
      user: "user",
    });
  });
});

describe("tag escaping", () => {
  it("round-trips every escaped character", () => {
    const value = "a b;c\\d\r\ne";
    expect(unescapeTagValue(escapeTagValue(value))).toBe(value);
  });

  it("drops a lone trailing backslash", () => {
    expect(unescapeTagValue("abc\\")).toBe("abc");
  });
});

describe("serializeMessage", () => {
  it("adds a trailing colon only when the last parameter needs one", () => {
    expect(line("PRIVMSG", "#c", "hello world")).toBe(
      "PRIVMSG #c :hello world",
    );
    expect(line("JOIN", "#c")).toBe("JOIN #c");
    expect(line("TOPIC", "#c", "")).toBe("TOPIC #c :");
    expect(line("PRIVMSG", "#c", ":)")).toBe("PRIVMSG #c ::)");
  });

  it("strips CR, LF and NUL so a parameter cannot inject a second command", () => {
    expect(line("PRIVMSG", "#c", "hi\r\nQUIT :pwned")).toBe(
      "PRIVMSG #c :hi  QUIT :pwned",
    );
    expect(line("NICK", "bad\0nick")).toBe("NICK :bad nick");
    expect(line("MODE", "#c two words", "+o")).toBe("MODE #ctwowords +o");
  });

  it("serializes tags, valued and valueless", () => {
    expect(
      serializeMessage({
        tags: { "+draft/reply": "a b", "+typing": true },
        command: "TAGMSG",
        params: ["#c"],
      }),
    ).toBe("@+draft/reply=a\\sb;+typing TAGMSG #c");
  });

  it("round-trips through the parser", () => {
    const text = line("PRIVMSG", "#fuse", "colours \x0304red\x03 and :colons:");
    expect(parseMessage(text)?.params).toEqual([
      "#fuse",
      "colours \x0304red\x03 and :colons:",
    ]);
  });
});

describe("CTCP", () => {
  it("parses ACTION and requests with and without arguments", () => {
    expect(parseCtcp("\x01ACTION waves\x01")).toEqual({
      command: "ACTION",
      args: "waves",
    });
    expect(parseCtcp("\x01version\x01")).toEqual({
      command: "VERSION",
      args: "",
    });
    expect(parseCtcp("\x01PING 123")).toEqual({ command: "PING", args: "123" });
    expect(parseCtcp("plain text")).toBeUndefined();
    expect(parseCtcp("\x01\x01")).toBeUndefined();
  });

  it("formats a request without stray delimiters", () => {
    expect(formatCtcp("ACTION", "dances \x01")).toBe("\x01ACTION dances \x01");
    expect(formatCtcp("VERSION")).toBe("\x01VERSION\x01");
  });
});

describe("splitByBytes", () => {
  it("leaves short text alone and returns one empty chunk for empty text", () => {
    expect(splitByBytes("hello", 10)).toEqual(["hello"]);
    expect(splitByBytes("", 10)).toEqual([""]);
  });

  it("breaks at spaces when it can", () => {
    expect(splitByBytes("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(splitByBytes("aaa bbb ccc", 9)).toEqual(["aaa bbb", "ccc"]);
  });

  it("hard-splits a long word and never splits a multi-byte character", () => {
    const pieces = splitByBytes("ææææææ", 5);
    expect(pieces).toEqual(["ææ", "ææ", "ææ"]);
    for (const piece of pieces)
      expect(byteLength(piece)).toBeLessThanOrEqual(5);
    expect(splitByBytes("😀😀😀", 8)).toEqual(["😀😀", "😀"]);
  });

  it("refuses a budget too small for one character", () => {
    expect(() => splitByBytes("abc", 2)).toThrow(RangeError);
  });
});
