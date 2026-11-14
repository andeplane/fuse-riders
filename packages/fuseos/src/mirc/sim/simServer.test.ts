import { ManualScheduler } from "../../__mocks__/ircTransport";
import { IrcClient } from "../irc/client";
import { findNetwork, simNetwork } from "../irc/networks";
import type { SessionState } from "../irc/session";
import { channelId, findWindow, queryId, STATUS_ID } from "../irc/session";

import type { BrainRequest, RegularsBrain } from "./brain";
import { IDLE_MS } from "./simServer";
import { createSimTransport, simHost, SimServer } from "./simServer";

class ScriptedBrain implements RegularsBrain {
  readonly requests: BrainRequest[] = [];
  answer: string | undefined = "hei hei";
  describe() {
    return "a script";
  }
  reply(request: BrainRequest) {
    this.requests.push(request);
    return Promise.resolve(this.answer);
  }
  dispose() {}
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(random = () => 0) {
  const scheduler = new ManualScheduler();
  const brain = new ScriptedBrain();
  const transport = createSimTransport({ scheduler, now: scheduler.now, random, brain }, simNetwork);
  const client = new IrcClient(
    { transport, scheduler, now: scheduler.now, random },
    { nick: "Guest1", altNick: "Guest1_", realName: "Fuse", invisible: true },
  );
  const efnet = findNetwork("efnet");
  if (!efnet) throw new Error("EFnet");
  client.connect(efnet);
  scheduler.advance(400);
  for (let i = 0; i < 6; i += 1) scheduler.advance(0);
  return { scheduler, brain, client, efnet };
}

const text = (state: SessionState, id: string) => findWindow(state, id)?.lines.map((l) => l.text) ?? [];

function joined() {
  const env = setup();
  env.client.join("#ddrnorway");
  env.scheduler.advance(8000);
  return env;
}

describe("simulated network", () => {
  it("registers the client with a MOTD that says it is simulated", () => {
    const { client } = setup();
    const state = client.getState();
    expect(state.phase).toBe("online");
    expect(state.userModes).toBe("i");
    const status = text(state, STATUS_ID).join("\n");
    expect(status).toContain("Looking up your hostname");
    expect(status).toContain("simulated");
    expect(status).toContain("Regulars are thinking with: a script");
    expect(state.support.network).toBe("EFnet");
  });

  it("joins #ddrnorway with its topic, regulars and a greeting", async () => {
    const { client, scheduler } = joined();
    const window = findWindow(client.getState(), channelId("#ddrnorway"));
    expect(window?.topic).toContain("DDR Norway");
    expect(window?.members.map((m) => m.prefixes + m.nick)).toEqual(
      expect.arrayContaining(["@RiChY", "@Andeplane", "+Zredna", "+CCBSbot", "Guest1"]),
    );
    scheduler.advance(6000);
    await flush();
    scheduler.advance(0);
    const lines = text(client.getState(), channelId("#ddrnorway")).join("\n");
    expect(lines).toContain("-CCBSbot- Velkommen til #ddrnorway!");
    expect(lines).toContain("<@RiChY> hei Guest1 :)");
  });

  it("lets a mentioned regular answer through the brain, with the channel's recent lines", async () => {
    const { client, scheduler, brain } = joined();
    client.submit(channelId("#ddrnorway"), "Zredna, kommer du på søndag?");
    await flush();
    scheduler.advance(5000);
    expect(brain.requests.at(-1)?.regular.nick).toBe("Zredna");
    expect(brain.requests.at(-1)?.history.at(-1)).toEqual({ nick: "Guest1", text: "Zredna, kommer du på søndag?" });
    expect(text(client.getState(), channelId("#ddrnorway"))).toContain("<+Zredna> hei hei");
  });

  it("answers CCBS commands from the bundled results", () => {
    const { client, scheduler } = joined();
    for (const command of ["!siste", "!t cc 1 2003", "!t nothing", "!spiller Andeplane", "!spiller ghost", "!sesonger", "!vinnere challenge cup 2003", "!vinnere", "!ccbs", "!unknown"])
      client.submit(channelId("#ddrnorway"), command);
    scheduler.advance(20_000);
    const lines = text(client.getState(), channelId("#ddrnorway")).join("\n");
    expect(lines).toContain("DDR Norway Reunion - 2012-04-28");
    expect(lines).toContain("Challenge Cup 1 - 2003-05-25, Oslo Bowling");
    expect(lines).toContain('Fant ingen turnering for "nothing"');
    expect(lines).toMatch(/Andeplane: \d+ rangerte turneringer/);
    expect(lines).toContain('Fant ingen spiller "ghost"');
    expect(lines).toContain("Sesonger: ");
    expect(lines).toContain("Challenge Cup 1: Tom");
    expect(lines).toContain("Bruk: !vinnere");
    expect(lines).toContain("Kilde: https://ccbs.sesse.net/tournaments.pl");
  });

  it("answers private messages, whois, list, topic, mode, away and ping", async () => {
    const { client, scheduler } = joined();
    client.submit(STATUS_ID, "/msg Andeplane hei");
    await flush();
    scheduler.advance(5000);
    expect(text(client.getState(), channelId("#ddrnorway")).join("\n")).toContain("Andeplane is away: koder litt");
    expect(text(client.getState(), queryId("Andeplane"))).toContain("<Andeplane> hei hei");
    client.activate(STATUS_ID);
    client.submit(STATUS_ID, "/msg CCBSbot siste");
    client.submit(STATUS_ID, "/msg nobody hi");
    client.submit(STATUS_ID, "/whois RiChY");
    client.submit(STATUS_ID, "/whois Guest1");
    client.submit(STATUS_ID, "/whois ghost");
    client.submit(STATUS_ID, "/ctcp RiChY VERSION");
    client.submit(STATUS_ID, "/ctcp RiChY PING");
    client.submit(STATUS_ID, "/away lunsj");
    client.submit(STATUS_ID, "/away");
    client.submit(STATUS_ID, "/topic #ddrnorway mitt topic");
    client.submit(STATUS_ID, "/topic #ddrnorway");
    client.submit(STATUS_ID, "/topic #nowhere");
    client.submit(STATUS_ID, "/mode #ddrnorway");
    client.submit(STATUS_ID, "/mode #ddrnorway +m");
    client.submit(STATUS_ID, "/mode Guest1");
    client.submit(STATUS_ID, "/mode #nowhere");
    client.submit(STATUS_ID, "/raw NAMES #ddrnorway");
    client.submit(STATUS_ID, "/raw NOTICE RiChY :x");
    client.submit(STATUS_ID, "/raw PING :abc");
    client.submit(STATUS_ID, "/raw PONG :abc");
    client.submit(STATUS_ID, "/motd");
    client.submit(STATUS_ID, "/frobnicate");
    client.submit(STATUS_ID, "/list");
    scheduler.advance(10_000);
    const status = text(client.getState(), STATUS_ID).join("\n");
    expect(status).toContain("RiChY is richy@hdc.ddr.no * RiChY");
    expect(status).toContain("Guest1 is ");
    expect(status).toContain("* ghost No such nick/channel");
    expect(status).toContain("* nobody No such nick/channel");
    expect(status).toContain("[RiChY VERSION reply]: mIRC v6.03 (simulated)");
    expect(status).toContain("* You have been marked as being away");
    expect(status).toContain("* You are no longer marked as being away");
    expect(status).toContain("* #ddrnorway You're not channel operator");
    expect(status).toContain("* #nowhere No such channel");
    expect(status).toContain("* FROBNICATE: Unknown command");
    expect(client.getState().list.entries.map((e) => e.channel)).toEqual(expect.arrayContaining(["#ddrnorway", "#quake3arena"]));
  });

  it("makes new channels with the user as op, lets them set the topic, and parts", () => {
    const { client, scheduler } = setup();
    client.join("#fuseos-test");
    client.submit(STATUS_ID, "/raw JOIN nochannel");
    scheduler.advance(0);
    const window = findWindow(client.getState(), channelId("#fuseos-test"));
    expect(window?.members.map((m) => m.prefixes + m.nick)).toEqual(["@Guest1"]);
    client.submit(channelId("#fuseos-test"), "/topic hei");
    client.submit(channelId("#fuseos-test"), "/topic");
    client.submit(channelId("#fuseos-test"), "hello?");
    client.join("#fuseos-test");
    client.submit(channelId("#fuseos-test"), "/part");
    client.submit(channelId("#fuseos-test"), "/part");
    scheduler.advance(0);
    const lines = text(client.getState(), channelId("#fuseos-test"));
    expect(lines).toContain("* Guest1 changes topic to 'hei'");
    expect(lines).toContain("* You have left #fuseos-test");
    expect(lines.join("\n")).toContain("You're not on that channel");
    client.submit(channelId("#fuseos-test"), "still here?");
    scheduler.advance(0);
    expect(text(client.getState(), channelId("#fuseos-test")).at(-1)).toBe("* #fuseos-test Cannot send to channel");
  });

  it("refuses regulars' nicks and bad nicks, and renames the user", () => {
    const { client, scheduler } = joined();
    client.submit(STATUS_ID, "/nick RiChY");
    client.submit(STATUS_ID, "/nick 9lives");
    client.submit(STATUS_ID, "/nick Neo");
    scheduler.advance(0);
    const status = text(client.getState(), channelId("#ddrnorway")).join("\n");
    expect(status).toContain("* RiChY: Nickname is already in use.");
    expect(status).toContain("* 9lives: Erroneous Nickname");
    expect(client.getState().nick).toBe("Neo");
    expect(findWindow(client.getState(), channelId("#ddrnorway"))?.members.some((m) => m.nick === "Neo")).toBe(true);
  });

  it("chatters in #ddrnorway while the user is there, and stops on quit", () => {
    const { client, scheduler } = joined();
    const before = text(client.getState(), channelId("#ddrnorway")).length;
    scheduler.advance(IDLE_MS.max * 2);
    expect(text(client.getState(), channelId("#ddrnorway")).length).toBeGreaterThan(before);
    client.submit(STATUS_ID, "/quit bye");
    scheduler.advance(10);
    expect(client.getState().phase).toBe("offline");
    expect(scheduler.pending).toBe(0);
  });

  it("refuses commands before registration and ignores garbage", () => {
    const scheduler = new ManualScheduler();
    const lines: string[] = [];
    const server = new SimServer(
      { scheduler, now: scheduler.now, random: () => 0, brain: new ScriptedBrain() },
      { id: "", name: "Test" },
      (line) => lines.push(line),
      () => undefined,
    );
    server.receive("");
    server.receive("JOIN #x");
    server.receive("CAP LS 302");
    server.receive("CAP REQ :multi-prefix");
    server.receive("NICK Neo");
    server.receive("NOTICE x :y");
    expect(lines).toEqual([
      ":irc.fuseos.sim 451 * :You have not registered",
      ":irc.fuseos.sim CAP * LS :multi-prefix",
      ":irc.fuseos.sim CAP * ACK :multi-prefix",
      ":irc.fuseos.sim 451 Neo :You have not registered",
    ]);
    expect(simHost("efnet")).toBe("irc.efnet.sim");
    server.stop();
    server.receive("PING :x");
    expect(lines).toHaveLength(4);
  });

  it("ignores a silent brain and closes cleanly from the client side", async () => {
    const { client, scheduler, brain } = joined();
    brain.answer = undefined;
    client.submit(channelId("#ddrnorway"), "RiChY?");
    await flush();
    scheduler.advance(5000);
    expect(text(client.getState(), channelId("#ddrnorway")).at(-1)).toBe("<Guest1> RiChY?");
    client.disconnect();
    expect(client.getState().phase).toBe("offline");
  });
});
