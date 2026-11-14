import { act, fireEvent, screen, within } from "@testing-library/react";

import { FakeIrcTransport, ManualScheduler } from "../__mocks__/ircTransport";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { MemoryModelCache } from "../llm/modelCache";

import type { MircDeps } from "./mircDeps";
import { MircDepsContext } from "./mircDeps";
import type { MircPrefs } from "./mircPrefs";
import { defaultPrefs, MemoryMircPrefsStore } from "./mircPrefs";
import type { BrainRequest, RegularsBrain } from "./sim/brain";
import { childTitle, switchbarLabel, welcomeBanner } from "./useMircViewModel";

const DAY = 86_400_000;

class ScriptedBrain implements RegularsBrain {
  readonly requests: BrainRequest[] = [];
  describe() {
    return "a test script";
  }
  usesModel() {
    return false;
  }
  prepare() {
    return Promise.resolve(false);
  }
  reply(request: BrainRequest) {
    this.requests.push(request);
    return Promise.resolve(`svar fra ${request.regular.nick}`);
  }
  dispose() {}
}

type Options = {
  prefs?: Partial<MircPrefs>;
  withDeps?: boolean;
  bridge?: boolean;
  brain?: boolean;
};

function setup(options: Options = {}) {
  const transport = new FakeIrcTransport();
  const scheduler = new ManualScheduler();
  const base = defaultPrefs(() => 0.4242, 0);
  const store = new MemoryMircPrefsStore(
    options.prefs ? { ...base, ...options.prefs } : undefined,
  );
  const brain = new ScriptedBrain();
  const deps: MircDeps = {
    transport,
    scheduler,
    now: () => 40 * DAY + scheduler.now(),
    random: () => 0.4242,
    prefs: store,
    ...(options.brain === false ? {} : { brain }),
    ...(options.bridge ? { bridgeUrl: "wss://bridge.example/irc" } : {}),
  };
  const ui =
    options.withDeps === false ? (
      <Desktop />
    ) : (
      <MircDepsContext.Provider value={deps}>
        <Desktop />
      </MircDepsContext.Provider>
    );
  const rendered = renderWithProviders(ui, {
    initialOpen: [{ kind: "mirc" }],
    llmDeps: { modelCache: new MemoryModelCache() },
  });
  return { ...rendered, transport, scheduler, prefsStore: store, brain };
}

type Env = ReturnType<typeof setup>;

const mirc = () => within(screen.getByTestId("mirc"));
const dismissNag = () =>
  fireEvent.click(mirc().getByRole("button", { name: "Continue" }));
const log = (name: string) =>
  mirc().getByRole("log", { name: `${name} messages` }).textContent ?? "";

/** Lets the simulated server's timers run (a socket's worth of delay, typing pauses). */
function run(env: Env, ms = 0) {
  act(() => {
    env.scheduler.advance(ms);
    for (let i = 0; i < 5; i += 1) env.scheduler.advance(0);
  });
}

async function settle(env: Env, ms: number) {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  run(env, ms);
}

function connect(env: Env) {
  dismissNag();
  fireEvent.click(mirc().getByRole("button", { name: "Connect" }));
  run(env, 400);
}

function joinDdr(env: Env) {
  connect(env);
  fireEvent.click(mirc().getByRole("button", { name: "Join" }));
  run(env, 8000);
}

/** Opens a menu-bar menu and chooses an item (plain and checkable items alike). */
function pick(menu: string, item: string | RegExp) {
  fireEvent.click(mirc().getByRole("menuitem", { name: menu }));
  fireEvent.click(
    within(screen.getByRole("menu", { name: menu })).getByLabelText(item),
  );
}

function closeFolder() {
  const dialog = mirc().getByRole("dialog", { name: "mIRC Channels Folder" });
  fireEvent.click(
    within(dialog).getAllByRole("button", { name: "Close" })[0] as HTMLElement,
  );
}

const editbox = (name: string) =>
  mirc().getByRole("textbox", { name: `Message ${name}` });

function type(name: string, text: string) {
  const box = editbox(name);
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("mIRC window", () => {
  it("opens with the shareware nag and the welcome banner, and remembers the first run", () => {
    const env = setup({ prefs: { firstRun: 0 } });
    expect(mirc().getByTestId("mirc-nag")).toHaveTextContent(
      "Your 30 day evaluation period is over!",
    );
    expect(mirc().getByTestId("mirc-nag")).toHaveTextContent(
      "using it for 41 days",
    );
    fireEvent.click(mirc().getByRole("button", { name: "Introduction" }));
    expect(
      mirc().getByRole("dialog", { name: "Introduction" }),
    ).toBeInTheDocument();
    fireEvent.click(mirc().getByRole("button", { name: "OK" }));
    fireEvent.click(mirc().getByRole("button", { name: "About" }));
    fireEvent.click(mirc().getByRole("button", { name: "How to register" }));
    expect(
      mirc().getByRole("dialog", { name: "How to register" }),
    ).toHaveTextContent("Nothing to buy");
    fireEvent.click(mirc().getByRole("button", { name: "OK" }));
    expect(log("Status")).toContain("Welcome to mIRC");
    expect(log("Status")).toContain("/join #ddrnorway");
    expect(env.prefsStore.get()?.firstRun).toBe(0);
  });

  it("saves first-run defaults with a Guest nick and EFnet", () => {
    const env = setup();
    expect(env.prefsStore.get()).toMatchObject({
      nick: "Guest4242",
      networkId: "efnet",
    });
    expect(mirc().getByTestId("mirc-nag")).toHaveTextContent(
      "using it for 1 day.",
    );
  });

  it("connects to the simulated EFnet, says so, and pops up the Channels Folder", () => {
    const env = setup();
    connect(env);
    expect(env.transport.links).toHaveLength(0);
    expect(log("Status")).toContain("(simulated)");
    expect(log("Status")).toContain(
      "Regulars are thinking with: a test script",
    );
    expect(
      mirc().getByRole("tab", { name: "EFnet Guest4242" }),
    ).toBeInTheDocument();
    expect(
      mirc().getByRole("dialog", { name: "mIRC Channels Folder" }),
    ).toBeInTheDocument();
  });

  it("goes through the bridge when the site has one", () => {
    const env = setup({ bridge: true });
    connect(env);
    expect(env.transport.last.url).toBe(
      "wss://bridge.example/irc?network=efnet",
    );
  });

  it("joins #ddrnorway with its regulars, and they answer through the brain", async () => {
    const env = setup();
    joinDdr(env);
    const nicks = within(
      mirc().getByRole("listbox", { name: "Nicklist" }),
    ).getAllByRole("option");
    const labels = nicks.map((nick) => nick.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([
        "@Andeplane",
        "@RiChY",
        "+CCBSbot",
        "+Zredna",
        "FootieFox",
        "Guest4242",
        "stepzilla",
        "Snute",
        "Tha_Dragon",
      ]),
    );
    // The six original regulars, the user, and the 63 other CCBS players with 5+ tournaments.
    expect(labels).toHaveLength(70);
    expect(log("#ddrnorway")).toContain("<@RiChY> hei Guest4242 :)");
    type("#ddrnorway", "Andeplane: hvem vant reunion?");
    await settle(env, 5000);
    expect(env.brain.requests.at(-1)?.regular.nick).toBe("Andeplane");
    expect(log("#ddrnorway")).toContain("<@Andeplane> svar fra Andeplane");
    type("#ddrnorway", "!siste");
    run(env, 2000);
    expect(log("#ddrnorway")).toContain("DDR Norway Reunion - 2012-04-28");
  });

  it("edits like mIRC's editbox: history, nick completion, formatting keys", () => {
    const env = setup();
    joinDdr(env);
    const box = editbox("#ddrnorway");
    type("#ddrnorway", "hello");
    expect(log("#ddrnorway")).toContain("<Guest4242> hello");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveValue("hello");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: "zre" } });
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box).toHaveValue("Zredna: ");
    fireEvent.change(box, { target: { value: "hi " } });
    fireEvent.keyDown(box, { key: "b", ctrlKey: true });
    expect(box).toHaveValue("hi \x02");
    fireEvent.keyDown(box, { key: "x", ctrlKey: true });
    expect(box).toHaveValue("hi \x02");
    type(
      "#ddrnorway",
      "\x02\x0312,8bold blue\x0f plain \x16rev\x16 \x1funder\x1f \x1dit",
    );
    expect(mirc().getByText("bold blue")).toHaveStyle({ fontWeight: "900" });
  });

  it("opens queries from the nicklist and runs its menu", () => {
    const env = setup();
    joinDdr(env);
    const list = () =>
      within(mirc().getByRole("listbox", { name: "Nicklist" }));
    const zredna = list().getByText("+Zredna");
    fireEvent.mouseDown(zredna);
    expect(zredna).toHaveAttribute("aria-selected", "true");
    fireEvent.contextMenu(zredna, { clientX: 50, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Whois" }));
    run(env);
    expect(log("#ddrnorway")).toContain("Zredna is zredna@hdc.ddr.no * Zredna");
    for (const item of ["Op", "Deop", "Voice", "Devoice", "Kick"]) {
      fireEvent.contextMenu(list().getByText("+Zredna"), {
        clientX: 50,
        clientY: 60,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: item }));
    }
    run(env);
    expect(log("#ddrnorway")).toContain("Unknown command");
    fireEvent.contextMenu(list().getByText("+Zredna"), {
      clientX: 50,
      clientY: 60,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Query" }));
    expect(mirc().getByRole("tab", { name: "Zredna" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(mirc().getByRole("tab", { name: "#ddrnorway" }));
    fireEvent.doubleClick(list().getByText("@RiChY"));
    expect(mirc().getByRole("tab", { name: "RiChY" })).toBeInTheDocument();
  });

  it("flags unread windows in the switchbar and minimizes and restores from it", () => {
    const env = setup();
    joinDdr(env);
    const status = mirc().getByRole("tab", { name: "EFnet Guest4242" });
    type("#ddrnorway", "/whois ghost");
    type("#ddrnorway", "/motd");
    run(env);
    expect(status).toHaveAttribute("data-activity", "1");
    fireEvent.click(status);
    expect(status).toHaveAttribute("data-activity", "0");
    fireEvent.click(status);
    expect(mirc().queryByRole("region", { name: "Status" })).toBeNull();
    fireEvent.click(status);
    expect(mirc().getByRole("region", { name: "Status" })).toBeInTheDocument();
    fireEvent.click(
      within(mirc().getByRole("region", { name: "Status" })).getByRole(
        "button",
        { name: "Minimize" },
      ),
    );
    expect(mirc().queryByRole("region", { name: "Status" })).toBeNull();
  });

  it("parts a channel when its window closes", () => {
    const env = setup();
    joinDdr(env);
    fireEvent.click(
      within(mirc().getByRole("region", { name: "#ddrnorway" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(mirc().queryByRole("region", { name: "#ddrnorway" })).toBeNull();
    expect(mirc().queryByRole("tab", { name: "#ddrnorway" })).toBeNull();
  });

  it("maximizes children into the frame caption, and tiles and cascades them", () => {
    const env = setup();
    joinDdr(env);
    fireEvent.click(
      within(mirc().getByRole("region", { name: "#ddrnorway" })).getByRole(
        "button",
        { name: "Maximize" },
      ),
    );
    expect(
      screen.getAllByText(/^mIRC - \[#ddrnorway \[70\]/).length,
    ).toBeGreaterThan(0);
    fireEvent.click(mirc().getByRole("button", { name: "Restore child" }));
    expect(screen.queryByText(/^mIRC - \[/)).toBeNull();
    fireEvent.click(mirc().getByRole("button", { name: "Tile Windows" }));
    fireEvent.click(mirc().getByRole("button", { name: "Cascade Windows" }));
    for (const item of ["Tile", "Cascade"]) {
      pick("Window", item);
    }
    pick("Window", /1 EFnet Guest4242/);
    expect(
      mirc().getByRole("tab", { name: "EFnet Guest4242" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("moves and sizes a child by dragging its caption and grip", () => {
    setup();
    dismissNag();
    const status = mirc().getByRole("region", { name: "Status" });
    const caption = status.querySelector(".title-bar");
    const grip = status.querySelector(".mirc-grip");
    if (!caption || !grip) throw new Error("missing chrome");
    fireEvent.pointerDown(caption, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(caption, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(caption, { pointerId: 1 });
    expect(status.style.left).toBe("30px");
    expect(status.style.top).toBe("20px");
    fireEvent.pointerDown(grip, {
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(grip, {
      clientX: -1000,
      clientY: -1000,
      pointerId: 1,
    });
    fireEvent.pointerUp(grip, { pointerId: 1 });
    expect(status.style.width).toBe("200px");
    fireEvent.pointerMove(caption, {
      clientX: 400,
      clientY: 400,
      pointerId: 1,
    });
    expect(status.style.left).toBe("30px");
    fireEvent.pointerDown(caption, {
      button: 2,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    fireEvent.doubleClick(caption);
    expect(screen.getAllByText("mIRC - [Status]").length).toBeGreaterThan(0);
  });

  it("shows the offline channel list, and the server's list once connected", () => {
    const env = setup();
    dismissNag();
    fireEvent.click(mirc().getByRole("button", { name: "List Channels" }));
    const offline = mirc().getByRole("listbox", { name: "Channels" });
    expect(within(offline).getAllByRole("option").length).toBeGreaterThan(10);
    fireEvent.mouseDown(
      within(offline).getAllByRole("option")[0] as HTMLElement,
    );
    fireEvent.doubleClick(
      within(offline).getAllByRole("option")[0] as HTMLElement,
    );
    expect(log("Status")).toContain("* /join: not connected to server");
    fireEvent.click(mirc().getByRole("button", { name: "Connect" }));
    pick("Tools", "Channels List");
    expect(mirc().queryByText("Retrieving channels...")).toBeNull();
    run(env, 400);
    closeFolder();
    fireEvent.click(mirc().getByRole("button", { name: "List Channels" }));
    expect(mirc().getByText("Retrieving channels...")).toBeInTheDocument();
    run(env);
    const online = within(mirc().getByRole("listbox", { name: "Channels" }));
    expect(online.getByText(/#ddrnorway/)).toBeInTheDocument();
    fireEvent.doubleClick(online.getByText(/#ddrnorway/));
    run(env);
    expect(mirc().getByRole("tab", { name: "#ddrnorway" })).toBeInTheDocument();
  });

  it("runs the Commands menu: join, query, whois, nick, away and quit", () => {
    const env = setup();
    joinDdr(env);
    const menu = (name: string) => pick("Commands", name);
    const answer = (value: string) => {
      const dialog = mirc().getByRole("dialog");
      fireEvent.change(within(dialog).getByRole("textbox"), {
        target: { value },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
      run(env);
    };
    menu("Whois user...");
    answer("RiChY");
    expect(log("#ddrnorway")).toContain("RiChY is richy@hdc.ddr.no");
    menu("Change nick...");
    answer("Neo");
    expect(mirc().getByRole("tab", { name: "EFnet Neo" })).toBeInTheDocument();
    menu("Away: Gone to eat");
    run(env);
    expect(log("#ddrnorway")).toContain("You have been marked as being away");
    menu("Back");
    run(env);
    expect(log("#ddrnorway")).toContain(
      "You are no longer marked as being away",
    );
    menu("Join channel...");
    answer("#fuseos-test");
    expect(mirc().getByRole("tab", { name: "#fuseos-test" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    menu("Part channel");
    run(env);
    expect(log("#fuseos-test")).toContain("* You have left #fuseos-test");
    menu("Query user...");
    const dialog = mirc().getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "  " },
    });
    fireEvent.submit(within(dialog).getByRole("button", { name: "OK" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    menu("Query user...");
    answer("stepzilla");
    expect(mirc().getByRole("tab", { name: "stepzilla" })).toBeInTheDocument();
    menu("Quit IRC");
    run(env);
    expect(log("stepzilla")).toContain("* Disconnected");
  });

  it("explains the parts a web page cannot do", () => {
    setup();
    dismissNag();
    for (const button of [
      "DCC Send",
      "Aliases",
      "Colours",
      "Timer",
      "URL List",
    ]) {
      fireEvent.click(mirc().getByRole("button", { name: button }));
      expect(mirc().getByRole("dialog", { name: button })).toBeInTheDocument();
      fireEvent.click(mirc().getByRole("button", { name: "OK" }));
    }
    pick("DCC", "Chat...");
    expect(mirc().getByRole("dialog", { name: "DCC Chat" })).toHaveTextContent(
      "straight between two computers",
    );
  });

  it("edits the Connect options, validating the nick, and connects from them", () => {
    const env = setup();
    dismissNag();
    pick("File", "Options...");
    const dialog = within(mirc().getByRole("dialog", { name: "mIRC Options" }));
    fireEvent.change(dialog.getByLabelText("Nickname:"), {
      target: { value: "bad nick" },
    });
    expect(dialog.getByRole("alert")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "OK" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Nickname:"), {
      target: { value: "Acid_Burn" },
    });
    fireEvent.change(dialog.getByLabelText("E-Mail Address:"), {
      target: { value: "kate@example.net" },
    });
    fireEvent.click(dialog.getByLabelText("Invisible mode"));
    fireEvent.click(dialog.getByRole("treeitem", { name: "Options" }));
    fireEvent.click(dialog.getByLabelText("Pop up Channels Folder on connect"));
    fireEvent.click(dialog.getByRole("treeitem", { name: /Display$/ }));
    fireEvent.click(dialog.getByLabelText("Timestamp events [HH:nn]"));
    fireEvent.click(dialog.getByRole("treeitem", { name: "Identd" }));
    expect(dialog.getByText(/cannot listen on a port/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("treeitem", { name: /Sounds$/ }));
    expect(
      dialog.getByText(/not available in the FuseOS edition/),
    ).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "OK" }));
    expect(env.prefsStore.get()).toMatchObject({
      nick: "Acid_Burn",
      email: "kate@example.net",
      invisible: false,
      folderOnConnect: false,
      timestamps: true,
    });
    expect(log("Status")).toMatch(/\[\d\d:\d\d\]/);
    pick("Tools", "Timestamp");
    expect(env.prefsStore.get()?.timestamps).toBe(false);
    fireEvent.click(mirc().getByRole("button", { name: "Options" }));
    fireEvent.change(mirc().getByLabelText("IRC Servers:"), {
      target: { value: "dalnet" },
    });
    fireEvent.click(
      mirc().getByRole("button", { name: "Connect to IRC Server" }),
    );
    run(env, 400);
    expect(
      mirc().getByRole("tab", { name: "DALnet Acid_Burn" }),
    ).toBeInTheDocument();
    expect(mirc().queryByRole("dialog")).toBeNull();
  });

  it("toggles the smart regulars, which use the shared model", () => {
    const env = setup({ brain: false });
    dismissNag();
    pick("Tools", /Smart regulars \(downloads \d+ MB\)/);
    expect(env.prefsStore.get()?.smartRegulars).toBe(true);
    fireEvent.click(mirc().getByRole("button", { name: "Connect" }));
    run(env, 400);
    expect(log("Status")).toContain(
      "Regulars are thinking with: Qwen 2.5 0.5B, running in this browser",
    );
  });

  it("manages the Channels Folder favourites", () => {
    const env = setup();
    dismissNag();
    fireEvent.click(mirc().getByRole("button", { name: "Channels Folder" }));
    const dialog = within(
      mirc().getByRole("dialog", { name: "mIRC Channels Folder" }),
    );
    expect(dialog.getByRole("button", { name: "Join" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Enter name of channel to join:"), {
      target: { value: "retro" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Add" }));
    expect(env.prefsStore.get()?.favorites).toContain("#retro");
    fireEvent.mouseDown(dialog.getByRole("option", { name: "#help" }));
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    expect(env.prefsStore.get()?.favorites).not.toContain("#help");
    fireEvent.click(dialog.getByLabelText("Pop up folder on connect"));
    expect(env.prefsStore.get()?.folderOnConnect).toBe(false);
    fireEvent.doubleClick(dialog.getByRole("option", { name: "#chatzone" }));
    expect(log("Status")).toContain("* /join: not connected to server");
  });

  it("disconnects from the toolbar and closes from File > Exit", () => {
    const env = setup();
    connect(env);
    closeFolder();
    fireEvent.click(mirc().getByRole("button", { name: "Disconnect" }));
    run(env);
    expect(log("Status")).toContain("* Disconnected");
    pick("Help", "Contents");
    expect(log("Status")).toContain("Commands:");
    fireEvent.click(mirc().getByRole("button", { name: "Help" }));
    pick("File", "Exit");
    expect(screen.queryByTestId("mirc")).toBeNull();
  });

  it("closes mIRC from the Status window's close box", () => {
    setup();
    dismissNag();
    fireEvent.click(
      within(mirc().getByRole("region", { name: "Status" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    expect(screen.queryByTestId("mirc")).toBeNull();
  });

  it("says so when the build has no mIRC dependencies", () => {
    setup({ withDeps: false });
    expect(
      mirc().getByText("mIRC is not installed in this build."),
    ).toBeInTheDocument();
  });
});

describe("captions", () => {
  it("formats Status, channel, query and list captions and switchbar labels", () => {
    expect(
      welcomeBanner({ id: "n", name: "Net", servers: [] }).join("\n"),
    ).toContain("Net is selected");
    const state = {
      phase: "online" as const,
      nick: "me",
      userModes: "",
      network: "Net",
      server: "irc.net:6697",
      support: {
        prefixModes: "",
        prefixSymbols: "",
        chantypes: "#",
        chanmodes: ["", "", "", ""] as const,
      },
      list: { entries: [], demo: false, complete: true },
      windows: [],
      activeId: "status",
      wantedNick: "me",
      altNick: "",
      nickAttempts: 0,
      caps: [],
      capsOffered: [],
      pendingNames: {},
      nextLineId: 1,
    };
    const window = {
      id: "x",
      name: "#c",
      lines: [],
      topic: "",
      modes: "",
      members: [],
      joined: false,
      activity: 0 as const,
    };
    expect(childTitle({ ...window, kind: "status" }, state)).toBe(
      "Status: me on Net (irc.net:6697)",
    );
    expect(childTitle({ ...window, kind: "channel" }, state)).toBe("#c");
    expect(childTitle({ ...window, kind: "list" }, state)).toBe("0 Channels");
    expect(
      switchbarLabel({ ...window, kind: "query", name: "bob" }, state),
    ).toBe("bob");
    expect(
      switchbarLabel(
        { ...window, kind: "status" },
        { ...state, phase: "offline" },
      ),
    ).toBe("Status");
  });
});
