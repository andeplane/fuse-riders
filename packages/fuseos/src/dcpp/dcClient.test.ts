import type { FakeDcClock } from "../__mocks__/dcpp";
import { createFakeDcClock, createTestDcClientDeps } from "../__mocks__/dcpp";
import { scriptedRandom } from "../__mocks__/seededRandom";

import type { DcClientDeps, DeliveryEvent, HubConnection } from "./dcClient";
import {
  CHECK_DELAY_MS,
  CONNECT_DELAY_MS,
  DcClient,
  FAKE_SHARE_DELAY_MS,
  KICK_DELAY_MS,
  SEARCH_DELAY_MS,
} from "./dcClient";
import { MiB } from "./format";
import { FUSEHUB, LINUX_HUB, LINUX_HUB_2 } from "./hubs";
import type { SearchQuery } from "./search";

const RETRO = "retrovault.servegame.com:411";
const EU = "eu-movies.myftp.org:411";
const REPO = [
  { path: "README.md", size: 300 * MiB },
  { path: "packages/fuseos/src/App.tsx", size: 300 * MiB },
];
const C_DRIVE = {
  virtualName: "fuse-games",
  directory: "C:\\",
  size: 600 * MiB,
};

function setup(overrides: Partial<DcClientDeps> = {}): {
  clock: FakeDcClock;
  client: DcClient;
  deliveries: DeliveryEvent[];
  hub: (address: string) => HubConnection;
  chat: (address: string) => string[];
} {
  const clock = createFakeDcClock();
  const client = new DcClient(createTestDcClientDeps(clock, overrides));
  const deliveries: DeliveryEvent[] = [];
  client.onDelivered((event) => deliveries.push(event));
  const hub = (address: string) => {
    const connection = client.connection(address);
    if (!connection) throw new Error(`not connected to ${address}`);
    return connection;
  };
  const chat = (address: string) =>
    hub(address).chat.map((line) =>
      line.nick === undefined ? line.text : `<${line.nick}> ${line.text}`,
    );
  return { clock, client, deliveries, hub, chat };
}

const query = (text: string): SearchQuery => ({
  text,
  sizeMode: "any",
  size: 0,
  type: "any",
  onlyFreeSlots: false,
});

describe("DcClient hubs", () => {
  it("connects, shows the MOTD and users, then kicks a 0 B share after 30 seconds", () => {
    const { clock, client, hub, chat } = setup();
    client.connect(FUSEHUB);
    expect(hub(FUSEHUB).status).toBe("connecting");
    expect(chat(FUSEHUB)).toEqual([`*** Connecting to ${FUSEHUB}...`]);
    clock.advance(CONNECT_DELAY_MS);
    expect(hub(FUSEHUB).status).toBe("connected");
    expect(chat(FUSEHUB)).toContain("*** Connected");
    expect(chat(FUSEHUB)).toContain(
      "<FuseBot> Welcome to FuseHub, home of the Fuse Games fans!",
    );
    const nicks = hub(FUSEHUB).users.map((user) => user.nick);
    expect(nicks.slice(0, 2).sort()).toEqual(["FuseBot", "[OP]fuse_admin"]);
    expect(nicks).toContain(client.getState().nick);
    clock.advance(CHECK_DELAY_MS);
    expect(chat(FUSEHUB).at(-1)).toBe(
      `<FuseBot> ${client.getState().nick}: You must share at least 512.00 MB to stay in this hub. You share 0 B. Kicking in 30s`,
    );
    expect(hub(FUSEHUB).kickAt).toBe(clock.now() + KICK_DELAY_MS);
    clock.advance(KICK_DELAY_MS);
    expect(chat(FUSEHUB).slice(-2)).toEqual([
      `<FuseBot> FuseBot is kicking ${client.getState().nick} because: Share below minimum (0 B / 512.00 MB)`,
      "*** Disconnected",
    ]);
    expect(hub(FUSEHUB).status).toBe("disconnected");
    expect(hub(FUSEHUB).users).toEqual([]);
    expect(hub(FUSEHUB).kickAt).toBeUndefined();
  });

  it("lets you off once you share C:\\ in time, and updates your share in the user list", () => {
    const { clock, client, hub, chat } = setup();
    client.connect(FUSEHUB);
    clock.advance(CONNECT_DELAY_MS + CHECK_DELAY_MS);
    expect(hub(FUSEHUB).kickAt).toBeDefined();
    client.setRepoFiles(REPO);
    expect(client.repoSize()).toBe(600 * MiB);
    client.setShareDirs([C_DRIVE]);
    expect(chat(FUSEHUB)).toContain(
      `<FuseBot> Share check passed: 600.00 MB. Welcome, ${client.getState().nick}!`,
    );
    expect(chat(FUSEHUB).at(-1)).toMatch(/Type 'fuse' or 'README' in Search/);
    expect(hub(FUSEHUB).kickAt).toBeUndefined();
    const self = hub(FUSEHUB).users.find(
      (user) => user.nick === client.getState().nick,
    );
    expect(self?.shared).toBe(600 * MiB);
    clock.advance(KICK_DELAY_MS * 2);
    expect(hub(FUSEHUB).status).toBe("connected");
  });

  it("re-reads the C:\\ size when the manifest arrives after sharing", () => {
    const { client } = setup();
    client.setShareDirs([{ ...C_DRIVE, size: 0 }]);
    client.setRepoFiles(REPO);
    expect(client.shared()).toBe(600 * MiB);
    client.setShareDirs([{ virtualName: "x", directory: "D:\\", size: 5 }]);
    client.setRepoFiles([]);
    expect(client.shared()).toBe(5);
  });

  it("has an op check your file list and kick you for a fake share", () => {
    const { clock, client, hub, chat } = setup();
    client.setRepoFiles(REPO);
    client.setShareDirs([C_DRIVE]);
    client.connect(RETRO);
    clock.advance(CONNECT_DELAY_MS + CHECK_DELAY_MS);
    expect(chat(RETRO).join("\n")).not.toMatch(/Kicking/);
    clock.advance(FAKE_SHARE_DELAY_MS);
    expect(chat(RETRO).at(-1)).toBe(
      `<[OP]Bitmaster> Browsing ${client.getState().nick}'s file list...`,
    );
    clock.advance(3_000);
    expect(chat(RETRO).slice(-3)).toEqual([
      "<[OP]Bitmaster> 2 files of .ts, .md and .json in a folder called fuse-games? That is a git repository, not a share.",
      `<[OP]Bitmaster> [OP]Bitmaster is kicking ${client.getState().nick} because: Fake share`,
      "*** Disconnected",
    ]);
    expect(hub(RETRO).status).toBe("disconnected");
  });

  it("is not fooled by an empty share either", () => {
    const { clock, client, chat } = setup();
    client.setShareDirs([
      { virtualName: "x", directory: "D:\\", size: 300 * MiB },
    ]);
    client.connect(RETRO);
    clock.advance(
      CONNECT_DELAY_MS + CHECK_DELAY_MS + FAKE_SHARE_DELAY_MS + 3_000,
    );
    expect(chat(RETRO)).toContain(
      "<[OP]Bitmaster> Your file list is empty. Nice try.",
    );
  });

  it("warns on a fake-share hub too when the share is under the minimum, then checks it once it passes", () => {
    const { clock, client, chat } = setup();
    client.setRepoFiles(REPO);
    client.connect(RETRO);
    clock.advance(CONNECT_DELAY_MS + CHECK_DELAY_MS);
    expect(chat(RETRO).at(-1)).toMatch(/You must share at least 256.00 MB/);
    client.setShareDirs([C_DRIVE]);
    clock.advance(FAKE_SHARE_DELAY_MS + 3_000);
    expect(chat(RETRO)).toContain(
      `<[OP]Bitmaster> [OP]Bitmaster is kicking ${client.getState().nick} because: Fake share`,
    );
  });

  it("redirects from a full hub and follows the redirect to the overflow hub", () => {
    const { clock, client, hub, chat } = setup();
    client.connect(LINUX_HUB);
    clock.advance(CONNECT_DELAY_MS);
    expect(chat(LINUX_HUB)).toContain(
      `<Tux> This hub is full (500/500). Please try ${LINUX_HUB_2}`,
    );
    expect(hub(LINUX_HUB).redirect).toBe(LINUX_HUB_2);
    expect(hub(LINUX_HUB).status).toBe("disconnected");
    expect(client.followRedirect(LINUX_HUB)).toBe(LINUX_HUB_2);
    clock.advance(CONNECT_DELAY_MS + CHECK_DELAY_MS);
    expect(hub(LINUX_HUB_2).status).toBe("connected");
    expect(chat(LINUX_HUB_2).join("\n")).not.toMatch(/must share/);
    expect(client.followRedirect(LINUX_HUB_2)).toBeUndefined();
  });

  it("times out on a hub that does not exist", () => {
    const { clock, client, hub, chat } = setup();
    client.connect("nowhere.example:411");
    clock.advance(CONNECT_DELAY_MS);
    expect(chat("nowhere.example:411")).toEqual([
      "*** Connecting to nowhere.example:411...",
      "*** Connection timeout",
      "*** Disconnected",
    ]);
    expect(hub("nowhere.example:411").hub.name).toBe("nowhere.example:411");
  });

  it("ignores a second connect, reconnects on request and stops every timer when the hub closes", () => {
    const { clock, client, hub, chat } = setup();
    client.connect(EU);
    client.connect(EU);
    expect(chat(EU)).toHaveLength(1);
    clock.advance(CONNECT_DELAY_MS);
    client.reconnect(EU);
    expect(chat(EU).slice(-2)).toEqual([
      "*** Disconnected",
      `*** Connecting to ${EU}...`,
    ]);
    clock.advance(CONNECT_DELAY_MS);
    expect(hub(EU).status).toBe("connected");
    client.reconnect("not-open:411");
    client.closeHub(EU);
    expect(client.connection(EU)).toBeUndefined();
    expect(clock.pending()).toBe(0);
    client.connect(EU);
    clock.advance(CONNECT_DELAY_MS);
    client.closeHub(EU);
    client.connect(EU);
    client.reconnect(EU);
    expect(hub(EU).status).toBe("connecting");
  });

  it("fills the chat with period small talk while connected", () => {
    const { clock, client, chat } = setup();
    client.connect(FUSEHUB);
    clock.advance(CONNECT_DELAY_MS + CHECK_DELAY_MS);
    const before = chat(FUSEHUB).length;
    clock.advance(60_000);
    expect(chat(FUSEHUB).length).toBeGreaterThan(before + 3);
  });

  it("speaks in main chat, answers the bot commands and keeps /clear and /me local", () => {
    const { clock, client, chat } = setup();
    const nick = client.getState().nick;
    client.sendChat(FUSEHUB, "hello?");
    client.connect(FUSEHUB);
    client.sendChat(FUSEHUB, "too early");
    expect(chat(FUSEHUB).at(-1)).toBe("*** Not connected");
    clock.advance(CONNECT_DELAY_MS);
    client.sendChat(FUSEHUB, "   ");
    client.sendChat(FUSEHUB, "hi all");
    expect(chat(FUSEHUB).at(-1)).toBe(`<${nick}> hi all`);
    client.sendChat(FUSEHUB, "/me waves");
    expect(client.connection(FUSEHUB)?.chat.at(-1)).toMatchObject({
      kind: "me",
      nick,
      text: "waves",
    });
    client.sendChat(FUSEHUB, "+help");
    client.sendChat(FUSEHUB, "+rules");
    client.sendChat(FUSEHUB, "+myinfo");
    clock.advance(400);
    const replies = chat(FUSEHUB).filter((line) =>
      line.startsWith("<FuseBot> "),
    );
    expect(replies.slice(-3)).toEqual([
      "<FuseBot> Commands: +help, +rules, +myinfo. That is all, this bot is from 2002.",
      "<FuseBot> Min share 512.00 MB. No fakers. Be nice.",
      `<FuseBot> ${nick}: share 0 B, tag <++ V:0.401,M:A,H:1/0/0,S:3>`,
    ]);
    client.sendChat(FUSEHUB, "/clear");
    expect(chat(FUSEHUB)).toEqual([]);
  });

  it("renames you, ignoring an empty nick and replacing characters the protocol reserves", () => {
    const { client } = setup();
    client.setNick("  ");
    expect(client.getState().nick).toMatch(/^fuse_user\d{3}$/);
    client.setNick("Neo $ the|one");
    expect(client.getState().nick).toBe("Neo___the_one");
    client.note("Hub list downloaded");
    expect(client.getState().statusText).toBe("Hub list downloaded");
  });
});

describe("DcClient search and file lists", () => {
  it("says so when no hub is connected and ignores an empty search", () => {
    const { client } = setup();
    client.search(query("  "));
    expect(client.getState().search.status).toBe("idle");
    client.search(query("matrix"));
    expect(client.getState().search).toMatchObject({
      status: "done",
      results: [],
      message: "You are not connected to any hubs",
    });
  });

  it("finds the repository and the soundtrack on FuseHub, and 2003's usual suspects elsewhere", () => {
    const { clock, client } = setup();
    client.setRepoFiles(REPO);
    client.connect(FUSEHUB);
    client.connect(EU);
    clock.advance(CONNECT_DELAY_MS);
    client.search(query("readme"));
    expect(client.getState().search.status).toBe("searching");
    expect(client.getState().statusText).toBe("Searching for readme...");
    clock.advance(SEARCH_DELAY_MS);
    const { results, message } = client.getState().search;
    expect(results.length).toBeGreaterThan(0);
    // Only FuseHub's people share the repository; everyone also has the usual 2003 files ("readme_IMPORTANT.txt.vbs").
    const repoRows = results.filter((row) => row.delivery.kind === "repo");
    expect(repoRows.length).toBeGreaterThan(0);
    expect(repoRows.every((row) => row.hubAddress === FUSEHUB)).toBe(true);
    expect(results.some((row) => row.file === "readme_IMPORTANT.txt.vbs")).toBe(
      true,
    );
    expect(message).toBe(
      `${results.length} item${results.length === 1 ? "" : "s"}`,
    );
    client.search(query("Pixel Sax"));
    clock.advance(SEARCH_DELAY_MS);
    expect(client.getState().search.results[0]?.delivery.kind).toBe("track");
    client.search(query("knoppix"));
    clock.advance(SEARCH_DELAY_MS);
    const knoppix = client.getState().search.results;
    expect(knoppix.length).toBeGreaterThan(0);
    expect(knoppix.every((row) => row.delivery.kind === "joke")).toBe(true);
  });

  it("reports a single result in the singular", () => {
    const { clock, client } = setup();
    client.setRepoFiles([{ path: "only-one.txt", size: 1 }]);
    client.connect(FUSEHUB);
    clock.advance(CONNECT_DELAY_MS);
    client.connection(FUSEHUB);
    client.search(query("only-one"));
    clock.advance(SEARCH_DELAY_MS);
    const { results, message } = client.getState().search;
    expect(message).toBe(
      `${results.length} item${results.length === 1 ? "" : "s"}`,
    );
  });

  it("opens one file list per user and hub, and closes it", () => {
    const { client } = setup();
    const view = client.openFileList("Neo", EU);
    expect(client.openFileList("Neo", EU)).toBe(view);
    expect(client.getState().statusText).toBe("File list of Neo downloaded");
    expect(view.root.folders.length).toBeGreaterThan(0);
    client.closeFileList("Neo", EU);
    expect(client.getState().fileLists).toEqual([]);
  });
});

const JOKE = {
  file: "Teh.Matricks.1999.DivX.CD1.avi",
  path: "Movies\\DivX\\",
  size: 100 * 1024,
  nick: "Neo",
  hub: "[EU] Movies",
  hubAddress: EU,
  delivery: { kind: "joke" },
} as const;

describe("DcClient downloads", () => {
  // The constructor draws the nick, `download` four IP octets, then `start` rolls the outcome.
  const dice = (...rolls: number[]) =>
    scriptedRandom([0.5, 0, 0, 0, 0, ...rolls]);

  it("runs out of slots, then tries again on Force attempt", () => {
    const { clock, client } = setup({ random: dice(0.1) });
    const item = client.download(JOKE);
    expect(item).toMatchObject({
      state: "connecting",
      status: "Connecting...",
      ip: "62.1.1.1",
    });
    expect(client.getState().statusText).toBe(
      `Added ${JOKE.file} to the download queue`,
    );
    expect(client.download(JOKE).id).toBe(item.id);
    clock.advance(1_500);
    expect(client.getState().queue[0]).toMatchObject({
      state: "waiting",
      status: "No slots available",
      error: "No slots available",
    });
    client.retry(item.id);
    expect(client.getState().queue[0]?.state).toBe("connecting");
    client.retry("nope");
  });

  it("times out", () => {
    const { clock, client } = setup({ random: dice(0.5) });
    client.download(JOKE);
    clock.advance(5_000);
    expect(client.getState().queue[0]).toMatchObject({
      state: "failed",
      error: "Connection timeout",
    });
  });

  it("crawls to 99% and then the other end disconnects", () => {
    const { clock, client } = setup({ random: dice(0.9, 0, 0) });
    client.download(JOKE);
    clock.advance(1_200);
    const running = client.getState().queue[0];
    expect(running?.state).toBe("running");
    expect(running?.speed).toBe(Math.round((JOKE.size * 0.99) / 15));
    clock.advance(500);
    expect(client.getState().queue[0]?.status).toMatch(
      /^Downloaded .* \(\d+\.\d%\) in 1s$/,
    );
    client.retry(running?.id ?? "");
    expect(client.getState().queue[0]?.state).toBe("running");
    clock.advance(20_000);
    expect(client.getState().queue[0]).toMatchObject({
      state: "failed",
      error: "Disconnected",
      downloaded: Math.floor(JOKE.size * 0.99),
    });
    expect(client.getState().downloadedTotal).toBe(
      Math.floor(JOKE.size * 0.99),
    );
    expect(client.getState().finished).toEqual([]);
  });

  it("delivers a repository file: it finishes, lands in Finished Downloads and tells the desktop", () => {
    const { clock, client, deliveries } = setup({ random: dice(0) });
    const item = client.download({
      ...JOKE,
      file: "README.md",
      path: "fuse-games\\",
      size: 400 * 1024,
      delivery: { kind: "repo", path: "README.md" },
    });
    clock.advance(1_000);
    expect(client.getState().queue[0]?.speed).toBe(40 * 1024);
    clock.advance(60_000);
    expect(client.getState().queue[0]).toMatchObject({
      state: "done",
      status: "Download finished, idle...",
      downloaded: 400 * 1024,
    });
    expect(client.getState().finished.map((entry) => entry.file)).toEqual([
      "README.md",
    ]);
    expect(deliveries.map((event) => event.item.delivery)).toEqual([
      { kind: "repo", path: "README.md" },
    ]);
    expect(client.getState().statusText).toBe("README.md finished downloading");
    client.retry(item.id);
    expect(client.getState().queue[0]?.state).toBe("done");
    // A finished file can be queued again.
    expect(client.download({ ...item, delivery: item.delivery }).id).not.toBe(
      item.id,
    );
    client.removeFinished();
    expect(client.getState().queue.map((entry) => entry.state)).toEqual([
      "connecting",
    ]);
    client.clearFinished();
    expect(client.getState().finished).toEqual([]);
  });

  it("removes a queued download and cancels its timers; dispose stops everything", () => {
    const { clock, client } = setup({ random: dice(0.5) });
    const item = client.download(JOKE);
    client.remove(item.id);
    expect(client.getState().queue).toEqual([]);
    expect(clock.pending()).toBe(0);
    client.connect(FUSEHUB);
    client.download({ ...JOKE, delivery: { kind: "track", trackId: "x" } });
    clock.advance(1_000);
    expect(clock.pending()).toBeGreaterThan(0);
    const listener = vi.fn();
    client.subscribe(listener);
    client.dispose();
    expect(clock.pending()).toBe(0);
    client.note("after");
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes listeners", () => {
    const { client } = setup();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    client.note("one");
    unsubscribe();
    client.note("two");
    expect(listener).toHaveBeenCalledTimes(1);
    const delivered = vi.fn();
    client.onDelivered(delivered)();
  });
});
