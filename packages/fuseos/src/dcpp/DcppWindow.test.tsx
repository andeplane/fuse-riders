import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FakeDcClock } from "../__mocks__/dcpp";
import { createFakeDcClock, createTestDcppDeps } from "../__mocks__/dcpp";
import { createTestGames, renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { windowMeta } from "../desktop/windowMeta";
import { isWindowState, sameInstance } from "../state/appState";
import { deepLinkContents } from "../state/deepLink";
import { FUSE_TRACKS } from "../winamp/fuseTracks";

import { CHECK_DELAY_MS, CONNECT_DELAY_MS, SEARCH_DELAY_MS } from "./dcClient";
import { DcppDepsContext } from "./dcppDeps";
import { KiB } from "./format";
import type { Hub } from "./hubs";
import { FUSEHUB, HUBS, LINUX_HUB } from "./hubs";

/** The real hubs, with FuseHub's minimum cut to fit the small fixture repository on C:. */
const TEST_HUBS: readonly Hub[] = HUBS.map((hub) =>
  hub.address === FUSEHUB ? { ...hub, minShare: 100 * KiB } : hub,
);

function renderDcpp(clock: FakeDcClock = createFakeDcClock()) {
  const deps = createTestDcppDeps(clock, { hubs: TEST_HUBS });
  const result = renderWithProviders(
    <DcppDepsContext.Provider value={deps}>
      <Desktop />
    </DcppDepsContext.Provider>,
    { initialOpen: [{ kind: "dcpp" }] },
  );
  const advance = (ms: number) =>
    act(() => {
      clock.advance(ms);
    });
  return { ...result, clock, advance };
}

const dcpp = () => within(screen.getByTestId("dcpp"));
const grid = (name: string) => within(dcpp().getByRole("grid", { name }));
const toolbar = (name: string) =>
  within(dcpp().getByRole("toolbar", { name: "DC++ toolbar" })).getByRole(
    "button",
    { name },
  );
const row = (gridName: string, text: string | RegExp) => {
  const cell = grid(gridName).getAllByText(text)[0];
  const tr = cell?.closest("tr");
  if (!tr) throw new Error(`no row for ${String(text)}`);
  return tr;
};
const searchButton = () =>
  within(dcpp().getByRole("form", { name: "Search options" })).getByRole("button", { name: "Search" });
const log = () => dcpp().getByRole("log", { name: "Main chat" });

async function menu(name: string, item: string) {
  const user = userEvent.setup();
  await user.click(dcpp().getByRole("menuitem", { name }));
  await user.click(dcpp().getByRole("menuitemcheckbox", { name: item }));
}

async function connectFuseHub(advance: (ms: number) => void) {
  fireEvent.doubleClick(row("Public hubs", "FuseHub — Fuse Games fans"));
  advance(CONNECT_DELAY_MS + CHECK_DELAY_MS);
}

async function shareC() {
  const user = userEvent.setup();
  await user.click(toolbar("Settings"));
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  await user.click(settings.getByRole("button", { name: "Sharing" }));
  await user.click(settings.getByRole("button", { name: "Add folder" }));
  const pick = await screen.findByRole("button", { name: /^\(C:\) fuse-games — \d/ });
  await user.click(pick);
  expect(settings.getByText(/^Total size: [\d.]+ (kB|MB)$/)).toBeInTheDocument();
  await user.click(settings.getByRole("button", { name: "OK" }));
}

describe("DC++ registration", () => {
  it("opens from ?open=dcpp, keeps one window and validates as stored state", () => {
    expect(deepLinkContents(["dcpp"], { has: () => false })).toEqual([{ kind: "dcpp" }]);
    expect(sameInstance({ kind: "dcpp" }, { kind: "dcpp" })).toBe(true);
    expect(sameInstance({ kind: "dcpp" }, { kind: "winamp" })).toBe(false);
    const window = { id: "w1", minimized: false, maximized: false, kind: "dcpp" } as const;
    expect(isWindowState(window)).toBe(true);
    expect(windowMeta(window, createTestGames())).toMatchObject({
      title: "DC++ 0.401",
      icon: "dcpp",
      resizable: true,
    });
  });
});

describe("DC++", () => {
  it("opens on Public Hubs with the toolbar, the window tabs and the status bar", async () => {
    renderDcpp();
    expect(screen.getByRole("dialog", { name: "DC++ 0.401" })).toBeInTheDocument();
    const hubs = grid("Public hubs");
    expect(hubs.getByText("FuseHub — Fuse Games fans")).toBeInTheDocument();
    expect(hubs.queryByText("Linux ISO Lovers #2")).toBeNull();
    expect(dcpp().getByText("Hubs: 7")).toBeInTheDocument();
    expect(dcpp().getByRole("status")).toHaveTextContent("ReadyH: 0/0/0Slots: 3/3D: 0 BU: 0 BD: 0 B/s (0)U: 0 B/s (0)");
    expect(dcpp().getByRole("tab", { name: "Public Hubs" })).toHaveAttribute("aria-selected", "true");
    expect(toolbar("Reconnect")).toBeDisabled();
    const user = userEvent.setup();
    await user.type(dcpp().getByRole("textbox", { name: "Filter" }), "anime");
    expect(grid("Public hubs").getAllByRole("row")).toHaveLength(2);
    await user.click(dcpp().getByRole("button", { name: "Refresh" }));
    expect(dcpp().getByRole("status")).toHaveTextContent("Hub list downloaded");
    // Column sort: the header toggles up and down.
    await user.click(grid("Public hubs").getByRole("columnheader", { name: "Users" }));
    expect(grid("Public hubs").getByRole("columnheader", { name: /Users/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(grid("Public hubs").getByRole("columnheader", { name: /Users/ }));
    expect(grid("Public hubs").getByRole("columnheader", { name: /Users/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(grid("Public hubs").getByRole("columnheader", { name: "Address" }));
    await user.click(grid("Public hubs").getByRole("columnheader", { name: "Min share" }));
  });

  it("joins FuseHub, warns about the 0 B share, and keeps you once C:\\ is shared", async () => {
    const { advance } = renderDcpp();
    await connectFuseHub(advance);
    expect(dcpp().getByRole("tab", { name: "FuseHub — Fuse Games fans" })).toHaveAttribute("aria-selected", "true");
    expect(log()).toHaveTextContent("*** Connected");
    expect(log()).toHaveTextContent("<FuseBot> Welcome to FuseHub, home of the Fuse Games fans!");
    expect(log()).toHaveTextContent(/You must share at least 100.00 kB to stay in this hub. You share 0 B. Kicking in 30s/);
    const users = grid("Users");
    expect(users.getByText("[OP]fuse_admin")).toBeInTheDocument();
    expect(dcpp().getByText(/^\d+ Users$/)).toBeInTheDocument();
    expect(dcpp().getByRole("status")).toHaveTextContent("H: 1/0/0");
    await shareC();
    expect(log()).toHaveTextContent(/<FuseBot> Share check passed: [\d.]+ (kB|MB)\. Welcome, fuse_user\d+!/);
    advance(31_000);
    expect(log()).not.toHaveTextContent("is kicking");
    const user = userEvent.setup();
    await user.type(dcpp().getByRole("textbox", { name: "Message" }), "hello 2003{Enter}");
    expect(log()).toHaveTextContent(/<fuse_user\d+> hello 2003/);
  });

  it("gets kicked if you never share, then reconnects from the hub's status strip", async () => {
    const { advance } = renderDcpp();
    await connectFuseHub(advance);
    advance(30_000);
    expect(log()).toHaveTextContent(/<FuseBot> FuseBot is kicking fuse_user\d+ because: Share below minimum \(0 B \/ 100\.00 kB\)/);
    expect(dcpp().getByText(/^\[21:00\] Disconnected$/)).toBeInTheDocument();
    expect(dcpp().getByRole("tab", { name: "FuseHub — Fuse Games fans" })).toHaveClass("dc-tab-offline");
    const user = userEvent.setup();
    // The status strip's own button, after the toolbar's.
    await user.click(dcpp().getAllByRole("button", { name: "Reconnect" })[1] ?? document.body);
    expect(dcpp().getByText(/^\[21:00\] Connecting to fusehub/)).toBeInTheDocument();
    advance(CONNECT_DELAY_MS);
    await user.click(toolbar("Reconnect"));
    expect(dcpp().getByText(/^\[21:00\] Connecting to fusehub/)).toBeInTheDocument();
  });

  it("follows a full hub's redirect from the toolbar", async () => {
    const { advance } = renderDcpp();
    fireEvent.doubleClick(row("Public hubs", "Linux ISO Lovers"));
    advance(CONNECT_DELAY_MS);
    expect(log()).toHaveTextContent("This hub is full (500/500)");
    expect(dcpp().getAllByText(/Use Follow redirect to go to linuxiso2/).length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(toolbar("Follow last redirect"));
    advance(CONNECT_DELAY_MS);
    expect(dcpp().getByRole("tab", { name: "Linux ISO Lovers #2" })).toHaveAttribute("aria-selected", "true");
    expect(log()).toHaveTextContent("Welcome to Linux ISO Lovers #2, the overflow hub.");
    // Back on the full hub, the status strip's button does the same.
    await user.click(dcpp().getByRole("tab", { name: "Linux ISO Lovers" }));
    await user.click(dcpp().getByRole("button", { name: "Follow redirect" }));
    expect(dcpp().getByRole("tab", { name: "Linux ISO Lovers #2" })).toHaveAttribute("aria-selected", "true");
    expect(LINUX_HUB).toMatch(/linuxiso/);
  });

  it("finds README on FuseHub and opens the finished download in Notepad++", async () => {
    const { advance } = renderDcpp();
    await connectFuseHub(advance);
    await shareC();
    const user = userEvent.setup();
    await user.click(toolbar("Search"));
    await user.type(dcpp().getByRole("textbox", { name: "Search for" }), "README{Enter}");
    expect(dcpp().getAllByText("Searching for README...").length).toBeGreaterThan(0);
    advance(SEARCH_DELAY_MS);
    const results = grid("Search results");
    expect(results.getAllByText("README.md").length).toBeGreaterThan(0);
    expect(results.getAllByText("fuse-games\\").length).toBeGreaterThan(0);
    fireEvent.doubleClick(row("Search results", "README.md"));
    advance(1_000);
    expect(within(dcpp().getByRole("grid", { name: "Transfers" })).getByRole("progressbar")).toBeInTheDocument();
    advance(30_000);
    expect(await screen.findByRole("dialog", { name: "README.md - Notepad++" })).toBeInTheDocument();
    await menu("View", "Finished Downloads");
    expect(grid("Finished downloads").getByText("README.md")).toBeInTheDocument();
    expect(dcpp().getByText("Items: 1")).toBeInTheDocument();
  });

  it("plays a downloaded soundtrack track in Winamp", async () => {
    const { advance, winampPlayers } = renderDcpp();
    await connectFuseHub(advance);
    const user = userEvent.setup();
    await user.click(toolbar("Search"));
    const track = FUSE_TRACKS[3];
    if (!track) throw new Error("no track");
    await user.type(dcpp().getByRole("textbox", { name: "Search for" }), `${track.title}{Enter}`);
    advance(SEARCH_DELAY_MS);
    fireEvent.doubleClick(row("Search results", new RegExp(`^${track.title}\\.`)));
    advance(30_000);
    expect(await screen.findByRole("region", { name: "Winamp" })).toBeInTheDocument();
    await waitFor(() => expect(winampPlayers[0]?.currentIndex).toBe(3));
    // Double-clicking it in Finished Downloads plays it again.
    await user.click(toolbar("Finished Downloads"));
    fireEvent.doubleClick(row("Finished downloads", new RegExp(`^${track.title}\\.`)));
    await user.click(dcpp().getAllByText(new RegExp(`^${track.title}\\.`))[0] ?? document.body);
    fireEvent.contextMenu(row("Finished downloads", new RegExp(`^${track.title}\\.`)));
    await user.click(screen.getByRole("menuitem", { name: "Remove all" }));
    expect(grid("Finished downloads").queryAllByRole("row")).toHaveLength(1);
  });

  it("shows the classic failures in the Transfers pane and the Download Queue", async () => {
    const { advance } = renderDcpp();
    fireEvent.doubleClick(row("Public hubs", "[EU] Movies & Music 100GB+ min share"));
    advance(CONNECT_DELAY_MS);
    const user = userEvent.setup();
    await user.click(toolbar("Search"));
    await user.type(dcpp().getByRole("textbox", { name: "Search for" }), "iso");
    await user.selectOptions(dcpp().getByRole("combobox", { name: "File type" }), "Any");
    await user.selectOptions(dcpp().getByRole("combobox", { name: "Size mode" }), "atMost");
    await user.type(dcpp().getByRole("textbox", { name: "Size" }), "1");
    await user.selectOptions(dcpp().getByRole("combobox", { name: "Size unit" }), "GB");
    await user.click(dcpp().getByRole("checkbox", { name: "Only users with free slots" }));
    await user.click(dcpp().getByRole("checkbox", { name: "Only users with free slots" }));
    await user.click(searchButton());
    advance(SEARCH_DELAY_MS);
    const isoRows = grid("Search results").getAllByText(/\.iso$/);
    isoRows.slice(0, 4).forEach((cell) => {
      const tr = cell.closest("tr");
      if (tr) fireEvent.doubleClick(tr);
    });
    advance(60_000);
    const transfers = within(dcpp().getByRole("grid", { name: "Transfers" }));
    expect(
      transfers.getAllByText(/No slots available|Connection timeout|Disconnected|File not available|Connection closed by remote user/).length,
    ).toBeGreaterThan(0);
    await user.click(toolbar("Download Queue"));
    const queue = grid("Queued files");
    expect(queue.getAllByRole("row").length).toBeGreaterThan(1);
    await user.click(dcpp().getByRole("button", { name: "ISO\\Linux\\" }));
    fireEvent.contextMenu(queue.getAllByRole("row")[1] ?? document.body);
    await user.click(screen.getByRole("menuitem", { name: "Force attempt" }));
    fireEvent.contextMenu(grid("Queued files").getAllByRole("row")[1] ?? document.body);
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    await user.click(
      within(dcpp().getByRole("tree", { name: "Queued folders" })).getByRole("button", { name: "Download Queue" }),
    );
    fireEvent.contextMenu(within(dcpp().getByRole("grid", { name: "Transfers" })).getAllByRole("row")[1] ?? document.body);
    await user.click(screen.getByRole("menuitem", { name: "Force attempt" }));
    fireEvent.contextMenu(within(dcpp().getByRole("grid", { name: "Transfers" })).getAllByRole("row")[1] ?? document.body);
    await user.click(screen.getByRole("menuitem", { name: "Close connection" }));
    // Searching again with no hub left says why nothing comes back.
    await user.click(dcpp().getByRole("tab", { name: /\[EU\] Movies/ }));
    await user.click(dcpp().getByRole("button", { name: /^Close \[EU\]/ }));
    await user.click(dcpp().getByRole("tab", { name: "Search" }));
    await user.click(searchButton());
    expect(dcpp().getAllByText("You are not connected to any hubs").length).toBeGreaterThan(0);
  });

  it("browses another user's file list and queues a file from it", async () => {
    const { advance } = renderDcpp();
    fireEvent.doubleClick(row("Public hubs", "Chill Out Lounge"));
    advance(CONNECT_DELAY_MS);
    const user = userEvent.setup();
    // The bot shares nothing, so double-clicking it does nothing.
    fireEvent.doubleClick(row("Users", "Lounge-Bot"));
    expect(dcpp().getAllByRole("tab")).toHaveLength(2);
    fireEvent.contextMenu(row("Users", "[OP]Mellow"));
    await user.click(screen.getByRole("menuitem", { name: "Get file list" }));
    expect(dcpp().getByRole("tab", { name: "[OP]Mellow" })).toHaveAttribute("aria-selected", "true");
    const tree = within(dcpp().getByRole("tree", { name: "[OP]Mellow's folders" }));
    expect(tree.getByRole("button", { name: "[OP]Mellow" })).toBeInTheDocument();
    fireEvent.doubleClick(row("[OP]Mellow's files", "Software"));
    expect(tree.getByRole("button", { name: "Software" })).toBeInTheDocument();
    fireEvent.contextMenu(row("[OP]Mellow's files", "DCPlusPlus-0.401.exe"));
    await user.click(screen.getByRole("menuitem", { name: "Download" }));
    fireEvent.doubleClick(row("[OP]Mellow's files", "Winamp 2.91 full.exe"));
    await user.click(tree.getByRole("button", { name: "[OP]Mellow" }));
    expect(within(dcpp().getByRole("grid", { name: "Transfers" })).getByText("DCPlusPlus-0.401.exe")).toBeInTheDocument();
    expect(dcpp().getByText(/^Files: \d+$/)).toBeInTheDocument();
    // Middle-click closes a tab.
    fireEvent(
      dcpp().getByRole("tab", { name: "[OP]Mellow" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(dcpp().queryByRole("tab", { name: "[OP]Mellow" })).toBeNull();
    fireEvent(
      dcpp().getByRole("tab", { name: "Chill Out Lounge" }),
      new MouseEvent("auxclick", { bubbles: true, button: 2 }),
    );
    expect(dcpp().getByRole("tab", { name: "Chill Out Lounge" })).toBeInTheDocument();
  });

  it("gets a file list from a search result too", async () => {
    const { advance } = renderDcpp();
    fireEvent.doubleClick(row("Public hubs", "DSL Kings"));
    advance(CONNECT_DELAY_MS);
    const user = userEvent.setup();
    await menu("View", "Search");
    await user.type(dcpp().getByRole("textbox", { name: "Search for" }), "kilobyte{Enter}");
    advance(SEARCH_DELAY_MS);
    fireEvent.contextMenu(row("Search results", /Kilobyte/));
    await user.click(screen.getByRole("menuitem", { name: "Get file list" }));
    expect(dcpp().getByRole("tree", { name: /'s folders$/ })).toBeInTheDocument();
    await user.click(dcpp().getByRole("tab", { name: "Search" }));
    fireEvent.contextMenu(row("Search results", /Kilobyte/));
    await user.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(dcpp().getByRole("status")).toHaveTextContent("to the download queue");
  });

  it("marks hubs with unread chat in bold and lists every window in the Window menu", async () => {
    const { advance } = renderDcpp();
    await connectFuseHub(advance);
    const user = userEvent.setup();
    await user.click(dcpp().getByRole("tab", { name: "Public Hubs" }));
    advance(60_000);
    expect(dcpp().getByRole("tab", { name: "FuseHub — Fuse Games fans" })).toHaveClass("dc-tab-unread");
    await menu("Window", "FuseHub — Fuse Games fans");
    expect(dcpp().getByRole("tab", { name: "FuseHub — Fuse Games fans" })).not.toHaveClass("dc-tab-unread");
    advance(30_000);
    await menu("Window", "Close disconnected");
    expect(dcpp().queryByRole("tab", { name: "FuseHub — Fuse Games fans" })).toBeNull();
  });

  it("toggles the toolbar, status bar and transfer view, and opens Notepad, Favorites and About", async () => {
    const { advance } = renderDcpp();
    const user = userEvent.setup();
    await menu("View", "Toolbar");
    expect(dcpp().queryByRole("toolbar", { name: "DC++ toolbar" })).toBeNull();
    await menu("View", "Toolbar");
    await menu("View", "Status bar");
    expect(dcpp().queryByRole("status")).toBeNull();
    await menu("View", "Status bar");
    await menu("View", "Transfer view");
    expect(dcpp().queryByRole("grid", { name: "Transfers" })).toBeNull();
    await menu("View", "Transfer view");
    await menu("View", "Notepad");
    await user.type(dcpp().getByRole("textbox", { name: "Notepad" }), "hub list: fusehub");
    await menu("View", "Download Queue");
    await user.click(toolbar("Notepad"));
    expect(dcpp().getByRole("textbox", { name: "Notepad" })).toHaveValue("hub list: fusehub");
    await menu("File", "Refresh file list");
    expect(dcpp().getByRole("status")).toHaveTextContent("File list refreshed");
    await menu("View", "Favorite Hubs");
    await user.click(toolbar("Favorite Hubs"));
    await user.click(grid("Favorite hubs").getByText("FuseHub — Fuse Games fans"));
    await user.click(dcpp().getByRole("button", { name: "Connect" }));
    advance(CONNECT_DELAY_MS);
    expect(log()).toHaveTextContent("*** Connected");
    await menu("View", "Favorite Hubs");
    fireEvent.doubleClick(row("Favorite hubs", "FuseHub — Fuse Games fans"));
    await menu("View", "Public Hubs");
    await user.click(toolbar("Public Hubs"));
    fireEvent.contextMenu(row("Public hubs", "Anime Planet"));
    await user.click(screen.getByRole("menuitem", { name: "Connect" }));
    expect(dcpp().getByRole("tab", { name: "Anime Planet" })).toBeInTheDocument();
    await menu("Help", "About DC++...");
    expect(screen.getByRole("dialog", { name: "About DC++" })).toHaveTextContent("DC++ v0.401");
    await user.click(within(screen.getByRole("dialog", { name: "About DC++" })).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: "About DC++" })).toBeNull();
    await menu("View", "Finished Downloads");
  });

  it("renames you in Settings, removes a shared folder, cancels, and closes everything", async () => {
    const { advance } = renderDcpp();
    const user = userEvent.setup();
    await menu("File", "Settings...");
    let settings = within(screen.getByRole("dialog", { name: "Settings" }));
    const nick = settings.getByRole("textbox", { name: "Nick" });
    await user.clear(nick);
    await user.type(nick, "Neo");
    await user.click(settings.getByRole("button", { name: "Sharing" }));
    await user.click(settings.getByRole("button", { name: "Add folder" }));
    await user.click(within(screen.getByRole("dialog", { name: "Browse for Folder" })).getByRole("button", { name: "Cancel" }));
    await user.click(settings.getByRole("button", { name: "Add folder" }));
    await user.click(await screen.findByRole("button", { name: /^\(C:\)/ }));
    await user.click(settings.getByRole("button", { name: "Add folder" }));
    expect(screen.getByRole("button", { name: /^\(C:\)/ })).toBeDisabled();
    await user.click(within(screen.getByRole("dialog", { name: "Browse for Folder" })).getByRole("button", { name: "Cancel" }));
    await user.click(settings.getByText("C:\\"));
    await user.click(settings.getByRole("button", { name: "Remove" }));
    expect(settings.getByText("Total size: 0 B")).toBeInTheDocument();
    await user.click(settings.getByRole("button", { name: "General" }));
    await user.click(settings.getByRole("button", { name: "OK" }));
    fireEvent.doubleClick(row("Public hubs", "Chill Out Lounge"));
    advance(CONNECT_DELAY_MS);
    expect(grid("Users").getByText("Neo")).toBeInTheDocument();
    await user.click(toolbar("Settings"));
    settings = within(screen.getByRole("dialog", { name: "Settings" }));
    await user.click(settings.getByRole("button", { name: "Cancel" }));
    await user.click(toolbar("Settings"));
    await user.click(within(screen.getByRole("dialog", { name: "Settings" })).getByRole("button", { name: "Close" }));
    // The child's close box, then the last one, leaves an empty MDI area.
    await user.click(dcpp().getByRole("button", { name: "Close Chill Out Lounge" }));
    await user.click(dcpp().getByRole("button", { name: "Close Public Hubs" }));
    expect(dcpp().queryAllByRole("tab")).toEqual([]);
    await menu("File", "Exit");
    expect(screen.queryByTestId("dcpp")).toBeNull();
  });
});
