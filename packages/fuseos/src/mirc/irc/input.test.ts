import type { InputContext } from "./input";
import { HELP_LINES, parseInput } from "./input";

const channel: InputContext = { kind: "channel", name: "#fuse" };
const query: InputContext = { kind: "query", name: "alice" };
const status: InputContext = { kind: "status", name: "" };

describe("parseInput", () => {
  it("says plain text to the window's channel or query", () => {
    expect(parseInput("hello", channel)).toEqual({
      type: "say",
      target: "#fuse",
      text: "hello",
    });
    expect(parseInput("hi", query)).toEqual({
      type: "say",
      target: "alice",
      text: "hi",
    });
    expect(parseInput("line\r\nbreak", query)).toEqual({
      type: "say",
      target: "alice",
      text: "line break",
    });
  });

  it("refuses plain text in Status and ignores blank input", () => {
    expect(parseInput("hello", status)).toMatchObject({ type: "error" });
    expect(parseInput("   ", channel)).toBeUndefined();
    expect(parseInput("/", channel)).toBeUndefined();
  });

  it("parses /me in a channel and refuses it in Status", () => {
    expect(parseInput("/me waves hello", channel)).toEqual({
      type: "action",
      target: "#fuse",
      text: "waves hello",
    });
    expect(parseInput("/action waves", query)).toEqual({
      type: "action",
      target: "alice",
      text: "waves",
    });
    expect(parseInput("/me waves", status)).toMatchObject({ type: "error" });
    expect(parseInput("/me", channel)).toEqual({
      type: "error",
      text: "* /me: insufficient parameters",
    });
  });

  it("parses /msg, /notice and /query keeping the message's spacing", () => {
    expect(parseInput("/msg bob hi  there", status)).toEqual({
      type: "msg",
      target: "bob",
      text: "hi  there",
    });
    expect(parseInput("/m bob x", status)).toMatchObject({ type: "msg" });
    expect(parseInput("/msg bob", status)).toMatchObject({ type: "error" });
    expect(parseInput("/notice bob psst", status)).toEqual({
      type: "notice",
      target: "bob",
      text: "psst",
    });
    expect(parseInput("/notice", status)).toMatchObject({ type: "error" });
    expect(parseInput("/query bob", status)).toEqual({
      type: "query",
      nick: "bob",
    });
    expect(parseInput("/query bob hey you", status)).toEqual({
      type: "query",
      nick: "bob",
      text: "hey you",
    });
    expect(parseInput("/query", status)).toMatchObject({ type: "error" });
  });

  it("parses /ctcp", () => {
    expect(parseInput("/ctcp bob version", status)).toEqual({
      type: "ctcp",
      target: "bob",
      command: "VERSION",
      args: "",
    });
    expect(parseInput("/ctcp bob", status)).toMatchObject({ type: "error" });
  });

  it("parses /join, adding the # when it is missing", () => {
    expect(parseInput("/join #fuseos-test", status)).toEqual({
      type: "join",
      channel: "#fuseos-test",
    });
    expect(parseInput("/j fuse key", status)).toEqual({
      type: "join",
      channel: "#fuse",
      key: "key",
    });
    expect(parseInput("/join", status)).toMatchObject({ type: "error" });
  });

  it("parses /part from the window or a named channel", () => {
    expect(parseInput("/part", channel)).toEqual({
      type: "part",
      channel: "#fuse",
    });
    expect(parseInput("/part bye all", channel)).toEqual({
      type: "part",
      channel: "#fuse",
      reason: "bye all",
    });
    expect(parseInput("/leave #other later", status)).toEqual({
      type: "part",
      channel: "#other",
      reason: "later",
    });
    expect(parseInput("/part", status)).toMatchObject({ type: "error" });
    expect(parseInput("/hop", channel)).toEqual({
      type: "hop",
      channel: "#fuse",
    });
    expect(parseInput("/hop", status)).toMatchObject({ type: "error" });
  });

  it("parses /nick, /whois and /quit", () => {
    expect(parseInput("/nick Zero_Cool", status)).toEqual({
      type: "nick",
      nick: "Zero_Cool",
    });
    expect(parseInput("/nick", status)).toMatchObject({ type: "error" });
    expect(parseInput("/whois bob", status)).toEqual({
      type: "whois",
      nick: "bob",
    });
    expect(parseInput("/wi", query)).toEqual({ type: "whois", nick: "alice" });
    expect(parseInput("/whois", channel)).toMatchObject({ type: "error" });
    expect(parseInput("/quit", status)).toEqual({ type: "quit" });
    expect(parseInput("/exit gone fishing", status)).toEqual({
      type: "quit",
      reason: "gone fishing",
    });
  });

  it("parses connection, window and away commands", () => {
    expect(parseInput("/server", status)).toEqual({ type: "server" });
    expect(parseInput("/server ergo", status)).toEqual({
      type: "server",
      network: "ergo",
    });
    expect(parseInput("/disconnect", status)).toEqual({ type: "disconnect" });
    expect(parseInput("/list", status)).toEqual({ type: "list" });
    expect(parseInput("/clear", status)).toEqual({ type: "clear" });
    expect(parseInput("/close", status)).toEqual({ type: "close" });
    expect(parseInput("/away eating", status)).toEqual({
      type: "away",
      message: "eating",
    });
    expect(parseInput("/away", status)).toEqual({ type: "away" });
    expect(parseInput("/back", status)).toEqual({ type: "away" });
    expect(parseInput("/help", status)).toEqual({ type: "help" });
    expect(HELP_LINES.length).toBeGreaterThan(3);
  });

  it("parses /topic", () => {
    expect(parseInput("/topic", channel)).toEqual({
      type: "topic",
      channel: "#fuse",
    });
    expect(parseInput("/topic new topic", channel)).toEqual({
      type: "topic",
      channel: "#fuse",
      topic: "new topic",
    });
    expect(parseInput("/topic #x hi", status)).toEqual({
      type: "topic",
      channel: "#x",
      topic: "hi",
    });
    expect(parseInput("/topic", status)).toMatchObject({ type: "error" });
  });

  it("builds MODE and KICK lines for the op aliases", () => {
    expect(parseInput("/op a b", channel)).toEqual({
      type: "raw",
      line: "MODE #fuse +oo a b",
    });
    expect(parseInput("/deop a", channel)).toEqual({
      type: "raw",
      line: "MODE #fuse -o a",
    });
    expect(parseInput("/voice a", channel)).toEqual({
      type: "raw",
      line: "MODE #fuse +v a",
    });
    expect(parseInput("/devoice a", channel)).toEqual({
      type: "raw",
      line: "MODE #fuse -v a",
    });
    expect(parseInput("/op a", status)).toMatchObject({ type: "error" });
    expect(parseInput("/kick lamer flooding", channel)).toEqual({
      type: "raw",
      line: "KICK #fuse lamer :flooding",
    });
    expect(parseInput("/kick #x lamer", status)).toEqual({
      type: "raw",
      line: "KICK #x lamer :lamer",
    });
    expect(parseInput("/kick", channel)).toMatchObject({ type: "error" });
  });

  it("sends /raw and unknown commands to the server as typed", () => {
    expect(parseInput("/raw PRIVMSG x :y", status)).toEqual({
      type: "raw",
      line: "PRIVMSG x :y",
    });
    expect(parseInput("/quote", status)).toMatchObject({ type: "error" });
    expect(parseInput("/invite bob #fuse", status)).toEqual({
      type: "raw",
      line: "INVITE bob #fuse",
    });
    expect(parseInput("/motd", status)).toEqual({ type: "raw", line: "MOTD" });
    expect(parseInput("//JOIN #a", status)).toEqual({
      type: "join",
      channel: "#a",
    });
  });
});
