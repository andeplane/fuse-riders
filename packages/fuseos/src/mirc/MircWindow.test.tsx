import { act, fireEvent, screen, within } from "@testing-library/react";

import { FakeIrcTransport, ManualScheduler } from "../__mocks__/ircTransport";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import type { MircDeps } from "./mircDeps";
import { MircDepsContext } from "./mircDeps";
import type { MircPrefs } from "./mircPrefs";
import { defaultPrefs, MemoryMircPrefsStore } from "./mircPrefs";
import { childTitle, switchbarLabel, welcomeBanner } from "./useMircViewModel";

const DAY = 86_400_000;

function setup(prefs?: Partial<MircPrefs>, withDeps = true) {
  const transport = new FakeIrcTransport();
  const scheduler = new ManualScheduler();
  const base = defaultPrefs(() => 0.4242, 0);
  const store = new MemoryMircPrefsStore(prefs ? { ...base, ...prefs } : undefined);
  const deps: MircDeps = {
    transport,
    scheduler,
    now: () => 40 * DAY + scheduler.now(),
    random: () => 0.4242,
    prefs: store,
  };
  const ui = withDeps ? (
    <MircDepsContext.Provider value={deps}>
      <Desktop />
    </MircDepsContext.Provider>
  ) : (
    <Desktop />
  );
  const rendered = renderWithProviders(ui, { initialOpen: [{ kind: "mirc" }] });
  return { ...rendered, transport, scheduler, prefsStore: store };
}

function mirc() {
  return within(screen.getByTestId("mirc"));
}

function dismissNag() {
  fireEvent.click(mirc().getByRole("button", { name: "Continue" }));
}

function log(name: string): string {
  return mirc().getByRole("log", { name: `${name} messages` }).textContent ?? "";
}

function connectToErgo(env: ReturnType<typeof setup>) {
  dismissNag();
  fireEvent.click(mirc().getByRole("button", { name: "Options" }));
  fireEvent.change(mirc().getByLabelText("IRC Servers:"), { target: { value: "ergo" } });
  fireEvent.click(mirc().getByRole("button", { name: "Connect to IRC Server" }));
  const link = env.transport.last;
  act(() => {
    link.open();
    link.welcome("Guest4242");
  });
  return link;
}

function joinTestChannel(env: ReturnType<typeof setup>) {
  const link = connectToErgo(env);
  fireEvent.click(mirc().getByRole("button", { name: "Join" }));
  expect(link.sent.at(-1)).toBe("JOIN #fuseos-test");
  act(() =>
    link.serverSays(
      ":Guest4242!u@h JOIN #fuseos-test",
      ":irc.test 332 Guest4242 #fuseos-test :Testing \x0304FuseOS",
      ":irc.test 353 Guest4242 = #fuseos-test :@op +voiced Guest4242 alice",
      ":irc.test 366 Guest4242 #fuseos-test :End",
    ),
  );
  link.sent.length = 0;
  return link;
}

describe("mIRC window", () => {
  it("opens with the shareware nag and the welcome banner, and remembers the first run", () => {
    const env = setup({ firstRun: 0 });
    expect(mirc().getByTestId("mirc-nag")).toHaveTextContent("Your 30 day evaluation period is over!");
    expect(mirc().getByTestId("mirc-nag")).toHaveTextContent("using it for 41 days");
    fireEvent.click(mirc().getByRole("button", { name: "Introduction" }));
    expect(mirc().getByRole("dialog", { name: "Introduction" })).toBeInTheDocument();
    fireEvent.click(mirc().getByRole("button", { name: "OK" }));
    fireEvent.click(mirc().getByRole("button", { name: "About" }));
    fireEvent.click(mirc().getByRole("button", { name: "How to register" }));
    expect(mirc().getByRole("dialog", { name: "How to register" })).toHaveTextContent("Nothing to buy");
    fireEvent.click(mirc().getByRole("button", { name: "OK" }));
    expect(log("Status")).toContain("Welcome to mIRC");
    expect(env.prefsStore.get()?.firstRun).toBe(0);
  });

  it("saves first-run defaults with a Guest nick", () => {
    const env = setup();
    expect(env.prefsStore.get()).toMatchObject({ nick: "Guest4242", networkId: "efnet" });
    expect(mirc().getByTestId("mirc-nag")).toHaveTextContent("using it for 1 day.");
  });

  it("explains that EFnet cannot be reached from a browser", () => {
    const env = setup();
    dismissNag();
    fireEvent.click(mirc().getByRole("button", { name: "Connect" }));
    expect(env.transport.links).toHaveLength(0);
    expect(log("Status")).toContain("EFnet doesn't accept browser connections");
    expect(log("Status")).toContain("/server ergo");
  });

  it("connects through the Options dialog, pops up the Channels Folder and joins", () => {
    const env = setup();
    const link = connectToErgo(env);
    expect(link.url).toBe("wss://testnet.ergo.chat/webirc");
    expect(link.sent.slice(0, 3)).toEqual(["CAP LS 302", "NICK Guest4242", "USER guest4242 0 * :FuseOS User"]);
    expect(link.sent).toContain("MODE Guest4242 +i");
    expect(env.prefsStore.get()?.networkId).toBe("ergo");
    expect(mirc().getByRole("tab", { name: "TestNet Guest4242" })).toBeInTheDocument();
    expect(mirc().getByRole("dialog", { name: "mIRC Channels Folder" })).toBeInTheDocument();
    joinTestChannel(env);
  });

  it("shows the channel, its topic and an ordered nicklist, and sends what is typed", () => {
    const env = setup();
    const link = joinTestChannel(env);
    const channel = mirc().getByRole("region", { name: "#fuseos-test" });
    expect(within(channel).getByText("#fuseos-test [4]: Testing \x0304FuseOS")).toBeInTheDocument();
    const nicks = within(mirc().getByRole("listbox", { name: "Nicklist" })).getAllByRole("option");
    expect(nicks.map((nick) => nick.textContent)).toEqual(["@op", "+voiced", "alice", "Guest4242"]);
    const box = mirc().getByRole("textbox", { name: "Message #fuseos-test" });
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(link.sent).toEqual(["PRIVMSG #fuseos-test hello"]);
    expect(log("#fuseos-test")).toContain("<Guest4242> hello");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(link.sent).toHaveLength(1);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveValue("hello");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: "al" } });
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box).toHaveValue("alice: ");
    fireEvent.change(box, { target: { value: "hi " } });
    fireEvent.keyDown(box, { key: "b", ctrlKey: true });
    expect(box).toHaveValue("hi \x02");
    fireEvent.keyDown(box, { key: "x", ctrlKey: true });
    expect(box).toHaveValue("hi \x02");
    act(() => link.serverSays(":alice!a@h PRIVMSG #fuseos-test :\x02\x0312,8bold blue\x0f plain \x16rev\x16 \x1funder\x1f \x1dit"));
    const runs = mirc().getByText("bold blue");
    expect(runs).toHaveStyle({ fontWeight: "900" });
  });

  it("opens queries from the nicklist and sends nick commands from its menu", () => {
    const env = setup();
    const link = joinTestChannel(env);
    const alice = within(mirc().getByRole("listbox", { name: "Nicklist" })).getByText("alice");
    fireEvent.mouseDown(alice);
    expect(alice).toHaveAttribute("aria-selected", "true");
    fireEvent.contextMenu(alice, { clientX: 50, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Whois" }));
    expect(link.sent).toEqual(["WHOIS alice alice"]);
    for (const [item, line] of [
      ["Op", "MODE #fuseos-test +o alice"],
      ["Deop", "MODE #fuseos-test -o alice"],
      ["Voice", "MODE #fuseos-test +v alice"],
      ["Devoice", "MODE #fuseos-test -v alice"],
      ["Kick", "KICK #fuseos-test alice :alice"],
    ] as const) {
      fireEvent.contextMenu(alice, { clientX: 50, clientY: 60 });
      fireEvent.click(screen.getByRole("menuitem", { name: item }));
      expect(link.sent.at(-1)).toBe(line);
    }
    fireEvent.contextMenu(alice, { clientX: 50, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Query" }));
    expect(mirc().getByRole("tab", { name: "alice" })).toHaveAttribute("aria-selected", "true");
    fireEvent.doubleClick(within(mirc().getByRole("listbox", { name: "Nicklist" })).getByText("op"));
    expect(mirc().getByRole("tab", { name: "op" })).toBeInTheDocument();
  });

  it("flags unread windows in the switchbar and minimizes and restores from it", () => {
    const env = setup();
    const link = joinTestChannel(env);
    const status = mirc().getByRole("tab", { name: "TestNet Guest4242" });
    act(() => link.serverSays(":irc.test NOTICE Guest4242 :server says hi"));
    expect(status).toHaveAttribute("data-activity", "1");
    fireEvent.click(status);
    expect(status).toHaveAttribute("data-activity", "0");
    fireEvent.click(status);
    expect(mirc().queryByRole("region", { name: "Status" })).toBeNull();
    fireEvent.click(status);
    expect(mirc().getByRole("region", { name: "Status" })).toBeInTheDocument();
    fireEvent.click(within(mirc().getByRole("region", { name: "Status" })).getByRole("button", { name: "Minimize" }));
    expect(mirc().queryByRole("region", { name: "Status" })).toBeNull();
  });

  it("parts a channel when its window closes", () => {
    const env = setup();
    const link = joinTestChannel(env);
    const channel = mirc().getByRole("region", { name: "#fuseos-test" });
    fireEvent.click(within(channel).getByRole("button", { name: "Close" }));
    expect(link.sent).toEqual(["PART #fuseos-test Leaving"]);
    expect(mirc().queryByRole("region", { name: "#fuseos-test" })).toBeNull();
  });

  it("maximizes children into the frame caption and tiles and cascades them", () => {
    const env = setup();
    joinTestChannel(env);
    const channel = mirc().getByRole("region", { name: "#fuseos-test" });
    fireEvent.click(within(channel).getByRole("button", { name: "Maximize" }));
    expect(screen.getAllByText(/^mIRC - \[#fuseos-test \[4\]/).length).toBeGreaterThan(0);
    fireEvent.click(mirc().getByRole("button", { name: "Restore child" }));
    expect(screen.queryByText(/^mIRC - \[/)).toBeNull();
    fireEvent.click(mirc().getByRole("button", { name: "Tile Windows" }));
    fireEvent.click(mirc().getByRole("button", { name: "Cascade Windows" }));
    fireEvent.click(mirc().getByRole("menuitem", { name: "Window" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tile" }));
    fireEvent.click(mirc().getByRole("menuitem", { name: "Window" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cascade" }));
    fireEvent.click(mirc().getByRole("menuitem", { name: "Window" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /1 TestNet Guest4242/ }));
    expect(mirc().getByRole("tab", { name: "TestNet Guest4242" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves and sizes a child by dragging its caption and grip", () => {
    setup();
    dismissNag();
    const status = mirc().getByRole("region", { name: "Status" });
    const caption = status.querySelector(".title-bar");
    const grip = status.querySelector(".mirc-grip");
    if (!caption || !grip) throw new Error("missing chrome");
    fireEvent.pointerDown(caption, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(caption, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(caption, { pointerId: 1 });
    expect(status.style.left).toBe("30px");
    expect(status.style.top).toBe("20px");
    fireEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: -1000, clientY: -1000, pointerId: 1 });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    expect(status.style.width).toBe("200px");
    fireEvent.pointerMove(caption, { clientX: 400, clientY: 400, pointerId: 1 });
    expect(status.style.left).toBe("30px");
    fireEvent.pointerDown(caption, { button: 2, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.doubleClick(caption);
    expect(screen.getAllByText("mIRC - [Status]").length).toBeGreaterThan(0);
  });

  it("shows the offline channel list, and joins from it once online", () => {
    const env = setup();
    dismissNag();
    fireEvent.click(mirc().getByRole("button", { name: "List Channels" }));
    const list = mirc().getByRole("listbox", { name: "Channels" });
    expect(within(list).getAllByRole("option").length).toBeGreaterThan(10);
    fireEvent.mouseDown(within(list).getAllByRole("option")[0] as HTMLElement);
    fireEvent.doubleClick(within(list).getAllByRole("option")[0] as HTMLElement);
    expect(log("Status")).toContain("* /join: not connected to server");
    expect(env.transport.links).toHaveLength(0);
  });

  it("fills the list from the server's LIST when online", () => {
    const env = setup();
    const link = connectToErgo(env);
    fireEvent.click(mirc().getByRole("button", { name: "Close" }));
    fireEvent.click(mirc().getByRole("menuitem", { name: "Tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Channels List" }));
    expect(link.sent.at(-1)).toBe("LIST");
    expect(mirc().getByText("Retrieving channels...")).toBeInTheDocument();
    act(() => link.serverSays(":irc.test 321 Guest4242 Channel :Users Name", ":irc.test 322 Guest4242 #fuse 3 :hi", ":irc.test 323 Guest4242 :End"));
    expect(mirc().getByRole("tab", { name: "Channels List" })).toBeInTheDocument();
    expect(within(mirc().getByRole("listbox", { name: "Channels" })).getByRole("option")).toHaveTextContent("#fuse");
  });

  it("runs the Commands menu: join, query, whois, nick, away and quit", () => {
    const env = setup();
    const link = joinTestChannel(env);
    const menu = (name: string) => {
      fireEvent.click(mirc().getByRole("menuitem", { name: "Commands" }));
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    const answer = (value: string) => {
      const dialog = mirc().getByRole("dialog");
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value } });
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    };
    menu("Join channel...");
    answer("#other");
    menu("Whois user...");
    answer("bob");
    menu("Change nick...");
    answer("Neo");
    menu("Away: Gone to eat");
    menu("Back");
    menu("Part channel");
    expect(link.sent).toEqual([
      "JOIN #other",
      "WHOIS bob bob",
      "NICK Neo",
      "AWAY :Gone to eat",
      "AWAY",
      "PART #fuseos-test Leaving",
    ]);
    menu("Query user...");
    const dialog = mirc().getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  " } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "OK" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    menu("Query user...");
    answer("carol");
    expect(mirc().getByRole("tab", { name: "carol" })).toBeInTheDocument();
    menu("Quit IRC");
    expect(link.sent.at(-1)).toBe("QUIT Leaving");
    expect(log("carol")).toContain("* Disconnected");
  });

  it("explains the parts a web page cannot do", () => {
    setup();
    dismissNag();
    for (const button of ["DCC Send", "Aliases", "Colours", "Timer", "URL List"]) {
      fireEvent.click(mirc().getByRole("button", { name: button }));
      expect(mirc().getByRole("dialog", { name: button })).toBeInTheDocument();
      fireEvent.click(mirc().getByRole("button", { name: "OK" }));
    }
    fireEvent.click(mirc().getByRole("menuitem", { name: "DCC" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Chat..." }));
    expect(mirc().getByRole("dialog", { name: "DCC Chat" })).toHaveTextContent("straight between two computers");
  });

  it("edits the Connect options, validating the nick", () => {
    const env = setup();
    dismissNag();
    fireEvent.click(mirc().getByRole("menuitem", { name: "File" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Options..." }));
    const dialog = within(mirc().getByRole("dialog", { name: "mIRC Options" }));
    fireEvent.change(dialog.getByLabelText("Nickname:"), { target: { value: "bad nick" } });
    expect(dialog.getByRole("alert")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "OK" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Nickname:"), { target: { value: "Acid_Burn" } });
    fireEvent.change(dialog.getByLabelText("E-Mail Address:"), { target: { value: "kate@example.net" } });
    fireEvent.click(dialog.getByLabelText("Invisible mode"));
    fireEvent.click(dialog.getByRole("treeitem", { name: "Options" }));
    fireEvent.click(dialog.getByLabelText("Pop up Channels Folder on connect"));
    fireEvent.click(dialog.getByRole("treeitem", { name: "Display" }));
    fireEvent.click(dialog.getByLabelText("Timestamp events [HH:nn]"));
    fireEvent.click(dialog.getByRole("treeitem", { name: "Identd" }));
    expect(dialog.getByText(/cannot listen on a port/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("treeitem", { name: "Sounds" }));
    expect(dialog.getByText(/not available in the FuseOS edition/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "OK" }));
    expect(env.prefsStore.get()).toMatchObject({
      nick: "Acid_Burn",
      email: "kate@example.net",
      invisible: false,
      folderOnConnect: false,
      timestamps: true,
    });
    expect(log("Status")).toMatch(/\[\d\d:\d\d\]/);
    fireEvent.click(mirc().getByRole("menuitem", { name: "Tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Timestamp" }));
    expect(env.prefsStore.get()?.timestamps).toBe(false);
    fireEvent.click(mirc().getByRole("button", { name: "Connect" }));
    expect(log("Status")).toContain("EFnet");
  });

  it("manages the Channels Folder favourites", () => {
    const env = setup();
    dismissNag();
    fireEvent.click(mirc().getByRole("button", { name: "Channels Folder" }));
    const dialog = within(mirc().getByRole("dialog", { name: "mIRC Channels Folder" }));
    expect(dialog.getByRole("button", { name: "Join" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Enter name of channel to join:"), { target: { value: "retro" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add" }));
    expect(env.prefsStore.get()?.favorites).toContain("#retro");
    fireEvent.mouseDown(dialog.getByRole("option", { name: "#help" }));
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    expect(env.prefsStore.get()?.favorites).not.toContain("#help");
    fireEvent.click(dialog.getByLabelText("Pop up folder on connect"));
    expect(env.prefsStore.get()?.folderOnConnect).toBe(false);
    fireEvent.doubleClick(dialog.getByRole("option", { name: "#chat" }));
    expect(log("Status")).toContain("* /join: not connected to server");
  });

  it("disconnects from the toolbar and closes from File > Exit and the Status close box", () => {
    const env = setup();
    const link = connectToErgo(env);
    fireEvent.click(mirc().getByRole("button", { name: "Close" }));
    fireEvent.click(mirc().getByRole("button", { name: "Disconnect" }));
    expect(link.sent.at(-1)).toBe("QUIT Leaving");
    fireEvent.click(mirc().getByRole("menuitem", { name: "Help" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Contents" }));
    expect(log("Status")).toContain("Commands:");
    fireEvent.click(mirc().getByRole("button", { name: "Help" }));
    fireEvent.click(mirc().getByRole("menuitem", { name: "File" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Exit" }));
    expect(screen.queryByTestId("mirc")).toBeNull();
  });

  it("closes mIRC from the Status window's close box", () => {
    setup();
    dismissNag();
    const status = mirc().getByRole("region", { name: "Status" });
    fireEvent.click(within(status).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("mirc")).toBeNull();
  });

  it("says so when the build has no mIRC dependencies", () => {
    setup(undefined, false);
    expect(mirc().getByText("mIRC is not installed in this build.")).toBeInTheDocument();
  });
});

describe("captions", () => {
  it("formats Status, channel, query and list captions and switchbar labels", () => {
    const network = { id: "n", name: "Net", servers: [], browserNote: [] };
    expect(welcomeBanner(network).join("\n")).toContain("Net is selected");
    const state = {
      phase: "online" as const,
      nick: "me",
      userModes: "",
      network: "Net",
      server: "irc.net:6697",
      support: { prefixModes: "", prefixSymbols: "", chantypes: "#", chanmodes: ["", "", "", ""] as const },
      list: { entries: [], demo: false, complete: true },
    };
    const window = { id: "x", name: "#c", lines: [], topic: "", modes: "", members: [], joined: false, activity: 0 as const };
    const full = { ...state, windows: [], activeId: "status", wantedNick: "me", altNick: "", nickAttempts: 0, caps: [], capsOffered: [], pendingNames: {}, nextLineId: 1 };
    expect(childTitle({ ...window, kind: "status" }, full)).toBe("Status: me on Net (irc.net:6697)");
    expect(childTitle({ ...window, kind: "channel" }, full)).toBe("#c");
    expect(childTitle({ ...window, kind: "list" }, full)).toBe("0 Channels");
    expect(switchbarLabel({ ...window, kind: "query", name: "bob" }, full)).toBe("bob");
    expect(switchbarLabel({ ...window, kind: "status" }, { ...full, phase: "offline" })).toBe("Status");
  });
});
