import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TestNapsterDeps } from "../__mocks__/napsterDeps";
import { createTestNapsterDeps } from "../__mocks__/napsterDeps";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { WindowContent } from "../state/appState";
import { fuseSoundtrack } from "../winamp/fuseTracks";

import { METALLICA_DECOY } from "./napsterCatalog";
import { NapsterDepsContext } from "./napsterDeps";
import { NAPSTER_TITLE } from "./napsterFacts";
import { CONNECT_MS } from "./napsterSession";
import { COURT_ORDER_MESSAGE } from "./useNapsterViewModel";

const NAPSTER: WindowContent = { kind: "napster" };

function renderNapster(
  overrides: Parameters<typeof createTestNapsterDeps>[0] = {},
  initialOpen: readonly WindowContent[] = [NAPSTER],
) {
  const deps = createTestNapsterDeps(overrides);
  const view = renderWithProviders(
    <NapsterDepsContext.Provider value={deps}>
      <Desktop />
    </NapsterDepsContext.Provider>,
    { initialOpen },
  );
  return { deps, ...view, user: userEvent.setup() };
}

function advance(deps: TestNapsterDeps, ms: number) {
  act(() => deps.clock.advance(ms));
}

function napster() {
  return within(screen.getByRole("dialog", { name: NAPSTER_TITLE }));
}

function rows(grid: string) {
  return within(screen.getByRole("grid", { name: grid }))
    .getAllByRole("row")
    .filter((row) => row.hasAttribute("aria-selected"));
}

async function menu(
  user: ReturnType<typeof userEvent.setup>,
  bar: string,
  item: string,
) {
  await user.click(napster().getByRole("menuitem", { name: bar }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: item }));
}

async function connectAndSearch(
  user: ReturnType<typeof userEvent.setup>,
  deps: TestNapsterDeps,
  artist: string,
) {
  advance(deps, CONNECT_MS);
  await user.type(napster().getByLabelText("Artist:"), artist);
  await user.click(napster().getByRole("button", { name: "Find It!" }));
  advance(deps, 2000);
}

/** What this desktop shares: every track of the Fuse soundtrack, however many the games have added. */
const SHARED_FILES = fuseSoundtrack("/fuse-riders/").length;

describe("NapsterWindow", () => {
  it("opens from its desktop icon and connects with the network totals in the status bar", async () => {
    const { deps, user } = renderNapster({}, []);
    await user.dblClick(
      within(screen.getByRole("list", { name: "Desktop icons" })).getByRole(
        "button",
        { name: "Napster" },
      ),
    );
    expect(screen.getByTestId("napster-status-left")).toHaveTextContent(
      "Connecting to server...",
    );
    expect(napster().getByRole("status")).toHaveTextContent("Not connected.");
    advance(deps, CONNECT_MS);
    expect(screen.getByTestId("napster-status-left")).toHaveTextContent(
      `Online (fuse_rider98): Sharing ${SHARED_FILES} files.`,
    );
    expect(screen.getByTestId("napster-status-right")).toHaveTextContent(
      /^Currently [\d,]+ files \([\d,]+ gigabytes\) available in [\d,]+ libraries\.$/,
    );
    expect(deps.chimes()).toBe(1);
    expect(napster().getByRole("status")).toHaveTextContent("Ready.");
  });

  it("searches, downloads, and adds the sharer to the Hot List", async () => {
    const { deps, user } = renderNapster();
    advance(deps, CONNECT_MS);
    await user.type(napster().getByLabelText("Artist:"), "metallica");
    await user.click(napster().getByRole("button", { name: "Find It!" }));
    expect(napster().getByRole("status")).toHaveTextContent("Searching...");
    advance(deps, 2000);
    const results = rows("Search results");
    expect(napster().getByRole("status")).toHaveTextContent(
      `Returned ${results.length} results.`,
    );
    expect(results[0]).toHaveTextContent(METALLICA_DECOY.filename);
    expect(
      within(results[0] as HTMLElement).getByRole("img", { name: /line$/ }),
    ).toBeInTheDocument();

    await user.dblClick(results[0] as HTMLElement);
    fireEvent.mouseDown(results[1] as HTMLElement);
    fireEvent.mouseDown(results[3] as HTMLElement, { shiftKey: true });
    expect(
      rows("Search results").filter(
        (row) => row.getAttribute("aria-selected") === "true",
      ),
    ).toHaveLength(3);
    fireEvent.mouseDown(results[2] as HTMLElement, { ctrlKey: true });
    fireEvent.mouseDown(results[5] as HTMLElement, { metaKey: true });
    expect(
      rows("Search results").filter(
        (row) => row.getAttribute("aria-selected") === "true",
      ),
    ).toHaveLength(3);
    await user.click(
      napster().getByRole("button", { name: "Add Selected User to Hot List" }),
    );
    await user.click(
      napster().getByRole("button", { name: "Get Selected Song(s)" }),
    );

    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    expect(rows("Downloads")).toHaveLength(4);
    expect(rows("Downloads")[0]).toHaveTextContent("Getting Info...");
    expect(napster().getByText("Concurrent Downloads: 4")).toBeInTheDocument();

    await user.click(napster().getByRole("tab", { name: "Hot List" }));
    expect(
      within(screen.getByRole("list", { name: "Online" })).getAllByRole(
        "listitem",
      ).length +
        within(screen.getByRole("list", { name: "Offline" })).getAllByRole(
          "listitem",
        ).length,
    ).toBeGreaterThan(2);
  });

  it("sorts results by a column header, and Enter downloads the focused row", async () => {
    const { deps, user } = renderNapster();
    await connectAndSearch(user, deps, "fuse");
    const header = napster().getByRole("columnheader", { name: "Filesize" });
    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    const sizes = () =>
      rows("Search results").map((row) =>
        Number((row.children[1]?.textContent ?? "").replace(/,/g, "")),
      );
    const ascending = sizes();
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    await user.click(header);
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(sizes()).toEqual([...ascending].reverse());
    await user.click(napster().getByRole("columnheader", { name: "Ping" }));
    await user.click(
      napster().getByRole("columnheader", { name: "Line Speed" }),
    );
    fireEvent.keyDown(rows("Search results")[0] as HTMLElement, {
      key: "Enter",
    });
    fireEvent.keyDown(rows("Search results")[0] as HTMLElement, { key: "a" });
    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    expect(rows("Downloads")).toHaveLength(1);
  });

  it("filters with the Advanced fields and clears everything with Clear Fields", async () => {
    const { deps, user } = renderNapster();
    advance(deps, CONNECT_MS);
    const pane = napster();
    await user.selectOptions(
      pane.getByLabelText("Bitrate must be: comparison"),
      "at least",
    );
    await user.selectOptions(
      pane.getByLabelText("Bitrate must be: value"),
      "192",
    );
    await user.selectOptions(
      pane.getByLabelText("Line Speed must be: comparison"),
      "equal to",
    );
    await user.selectOptions(
      pane.getByLabelText("Line Speed must be: value"),
      "T1",
    );
    await user.selectOptions(
      pane.getByLabelText("Frequency must be: comparison"),
      "at best",
    );
    await user.selectOptions(
      pane.getByLabelText("Ping Time must be: value"),
      "500",
    );
    await user.clear(pane.getByLabelText("Max Results:"));
    await user.type(pane.getByLabelText("Max Results:"), "abc");
    await user.type(pane.getByLabelText("Song Title:"), "pixel");
    await user.type(pane.getByLabelText("Artist:"), "fuse");
    await user.click(pane.getByRole("button", { name: "Find It!" }));
    advance(deps, 2000);
    for (const row of rows("Search results")) {
      expect(Number(row.children[2]?.textContent)).toBeGreaterThanOrEqual(192);
      expect(row.children[6]).toHaveTextContent("T1");
    }
    await user.selectOptions(
      pane.getByLabelText("Bitrate must be: comparison"),
      "",
    );
    await user.click(pane.getByRole("button", { name: "Clear Fields" }));
    expect(pane.getByLabelText("Artist:")).toHaveValue("");
    expect(pane.getByLabelText("Max Results:")).toHaveValue("100");
    expect(pane.getByLabelText("Line Speed must be: value")).toHaveValue("");
    expect(pane.getByRole("status")).toHaveTextContent("Ready.");
  });

  it("says when a search finds nothing at all", async () => {
    const { deps, user } = renderNapster();
    advance(deps, CONNECT_MS);
    await user.selectOptions(
      napster().getByLabelText("Ping Time must be: comparison"),
      "at best",
    );
    await user.selectOptions(
      napster().getByLabelText("Ping Time must be: value"),
      "50",
    );
    await user.selectOptions(
      napster().getByLabelText("Bitrate must be: comparison"),
      "equal to",
    );
    await user.selectOptions(
      napster().getByLabelText("Bitrate must be: value"),
      "64",
    );
    await user.selectOptions(
      napster().getByLabelText("Frequency must be: comparison"),
      "equal to",
    );
    await user.selectOptions(
      napster().getByLabelText("Frequency must be: value"),
      "22050",
    );
    await user.type(napster().getByLabelText("Artist:"), "blur");
    await user.click(napster().getByRole("button", { name: "Find It!" }));
    advance(deps, 2000);
    expect(
      napster().getByText("No songs matched your search."),
    ).toBeInTheDocument();
    expect(napster().getByRole("status")).toHaveTextContent(
      "Returned 0 results.",
    );
  });

  it("delivers the Metallica decoy, which only lectures you", async () => {
    const { deps, user, winampPlayers } = renderNapster();
    await connectAndSearch(user, deps, "metallica");
    await user.dblClick(rows("Search results")[0] as HTMLElement);
    advance(deps, 120_000);
    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    const done = rows("Downloads")[0] as HTMLElement;
    expect(done).toHaveTextContent("File Complete!");
    await user.dblClick(done);
    expect(
      within(
        screen.getByRole("dialog", { name: METALLICA_DECOY.warningTitle }),
      ).getByText(METALLICA_DECOY.warning),
    ).toBeInTheDocument();
    expect(winampPlayers).toHaveLength(0);
    await user.click(napster().getByRole("button", { name: "Clear Finished" }));
    expect(rows("Downloads")).toHaveLength(0);
  });

  it("cancels a selected transfer", async () => {
    const { deps, user } = renderNapster();
    await connectAndSearch(user, deps, "blur");
    await user.dblClick(rows("Search results")[0] as HTMLElement);
    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    const cancel = napster().getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.mouseDown(rows("Downloads")[0] as HTMLElement);
    await user.click(cancel);
    expect(rows("Downloads")[0]).toHaveTextContent("Cancelled");
    await user.dblClick(rows("Downloads")[0] as HTMLElement);
  });

  it("shows progress bars and uploads while files move", async () => {
    // 0.03 starts an upload on the first tick; the downloads all get Fuse files.
    const { deps, user } = renderNapster({ random: () => 0.03 });
    await connectAndSearch(user, deps, "fuse");
    await user.dblClick(rows("Search results")[0] as HTMLElement);
    advance(deps, 8000);
    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    expect(rows("Uploads").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("plays the shared soundtrack and finished downloads in Winamp under their Napster names", async () => {
    const { deps, user, winampPlayers } = renderNapster({ random: () => 0.03 });
    advance(deps, CONNECT_MS);
    await user.click(napster().getByRole("tab", { name: "Library" }));
    const library = rows("Library");
    expect(library).toHaveLength(SHARED_FILES);
    await user.dblClick(library[0] as HTMLElement);
    await waitFor(() =>
      expect(winampPlayers[0]?.getMediaStatus()).toBe("PLAYING"),
    );
    const player = winampPlayers[0];
    const last = player?.tracks.at(-1);
    expect(last?.defaultName).toBe("Fuse Radio - Pixel Sax Parade");
    expect(last?.url).toMatch(/music\/pixel-sax-parade\.m4a#napster-1$/);

    // Winamp is running now: the CD buttons drive it and Play queues straight into it.
    await user.click(napster().getByRole("button", { name: "Stop" }));
    expect(player?.getMediaStatus()).toBe("STOPPED");
    await user.click(napster().getByRole("button", { name: "Next" }));
    await user.click(napster().getByRole("button", { name: "Previous" }));
    fireEvent.mouseDown(library[1] as HTMLElement);
    await user.click(napster().getByRole("button", { name: "Play" }));
    expect(player?.tracks.at(-1)?.defaultName).toBe(
      "Fuse Radio - Coin Op Swing",
    );
  });

  it("plays a mislabelled download and admits what it really is", async () => {
    const { deps, user, winampPlayers } = renderNapster({ random: () => 0.9 });
    await connectAndSearch(user, deps, "eminem");
    await user.dblClick(rows("Search results")[0] as HTMLElement);
    advance(deps, 600_000);
    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    expect(rows("Downloads")[0]).toHaveTextContent("File Complete!");
    await user.dblClick(rows("Downloads")[0] as HTMLElement);
    await waitFor(() =>
      expect(winampPlayers[0]?.tracks.at(-1)?.defaultName).toMatch(
        /\(really: .+\)$/,
      ),
    );
  });

  it("builds a playlist and plays it in order or shuffled", async () => {
    const { deps, user, winampPlayers } = renderNapster();
    advance(deps, CONNECT_MS);
    await user.click(napster().getByRole("tab", { name: "Library" }));
    const library = rows("Library");
    fireEvent.mouseDown(library[0] as HTMLElement);
    fireEvent.mouseDown(library[2] as HTMLElement, { shiftKey: true });
    await user.click(napster().getByRole("button", { name: "Add" }));
    const playlist = within(screen.getByRole("list", { name: "Playlist" }));
    expect(playlist.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.mouseDown(playlist.getAllByRole("listitem")[1] as HTMLElement);
    await user.click(napster().getByRole("button", { name: "Delete" }));
    expect(playlist.getAllByRole("listitem")).toHaveLength(2);
    await user.click(
      napster().getByRole("button", { name: "Continuous Play" }),
    );
    await waitFor(() =>
      expect(winampPlayers[0]?.getMediaStatus()).toBe("PLAYING"),
    );
    await user.click(napster().getByRole("button", { name: "Random Play" }));
    fireEvent.mouseDown(library[0] as HTMLElement, { ctrlKey: true });
    await user.click(napster().getByRole("button", { name: "Play" }));
    await user.click(napster().getByRole("button", { name: "Clear" }));
    expect(playlist.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("browses a Hot List friend, downloads from them and manages the list", async () => {
    const { deps, user } = renderNapster();
    advance(deps, CONNECT_MS);
    await user.click(napster().getByRole("tab", { name: "Hot List" }));
    fireEvent.mouseDown(
      within(screen.getByRole("list", { name: "Online" })).getByText(
        "dialup_dan",
      ),
    );
    const files = rows("dialup_dan's files");
    expect(files.length).toBeGreaterThan(0);
    expect(napster().getByText("Number Shared:")).toHaveTextContent(
      String(files.length),
    );
    await user.dblClick(files[0] as HTMLElement);
    fireEvent.mouseDown(files[1] as HTMLElement);
    await user.click(
      napster().getByRole("button", { name: "Download Selected Song(s)" }),
    );
    await user.click(
      napster().getByRole("button", { name: "Refresh Visible List" }),
    );

    await user.click(napster().getByRole("button", { name: "Add User" }));
    await user.type(napster().getByLabelText("User to add"), "dsl_dave");
    await user.click(napster().getByRole("button", { name: "OK" }));
    expect(
      within(screen.getByRole("list", { name: "Online" })).getByText(
        "dsl_dave",
      ),
    ).toBeInTheDocument();
    await user.click(napster().getByRole("button", { name: "Add User" }));
    await user.click(napster().getByRole("button", { name: "OK" }));

    fireEvent.mouseDown(
      within(screen.getByRole("list", { name: "Offline" })).getByText(
        "bitrate_betty",
      ),
    );
    expect(
      napster().getByText("bitrate_betty is not online."),
    ).toBeInTheDocument();
    await user.click(napster().getByRole("button", { name: "Remove User" }));
    expect(screen.queryByText("bitrate_betty")).not.toBeInTheDocument();
    expect(
      napster().getByRole("button", { name: "Remove User" }),
    ).toBeDisabled();

    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    expect(rows("Downloads")).toHaveLength(2);
  });

  it("chats in #napster, joins another channel and leaves", async () => {
    const { deps, user } = renderNapster({ random: () => 0.9 });
    advance(deps, CONNECT_MS);
    await user.click(napster().getByRole("tab", { name: "Chat" }));
    expect(napster().getByRole("heading")).toHaveTextContent(
      "#napster: Welcome to Napster! Be nice. No spam.",
    );
    await user.type(
      napster().getByLabelText("Message"),
      "anyone got sandstorm{Enter}",
    );
    expect(
      within(screen.getByRole("log", { name: "Chat" })).getByText(
        "anyone got sandstorm",
        { exact: false },
      ),
    ).toBeInTheDocument();
    advance(deps, 4000);
    expect(napster().getByText(/users in channel\.$/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("grid", { name: "Users in channel" })).getByText(
        "fuse_rider98",
      ),
    ).toBeInTheDocument();

    await user.click(napster().getByRole("button", { name: "Join" }));
    const list = within(screen.getByRole("dialog", { name: "Join Channel" }));
    await user.click(list.getByRole("button", { name: "#metal" }));
    expect(napster().getByRole("button", { name: "metal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(napster().getByRole("button", { name: "Join" }));
    await user.dblClick(
      within(screen.getByRole("dialog", { name: "Join Channel" })).getByText(
        "turn it up. no fakes.",
      ),
    );
    await user.click(napster().getByRole("button", { name: "Join" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Join Channel" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    await user.click(napster().getByRole("button", { name: "napster" }));
    expect(napster().getByRole("heading")).toHaveTextContent("#napster:");
    await user.click(napster().getByRole("button", { name: "Leave" }));
    await user.click(napster().getByRole("button", { name: "Leave" }));
    expect(napster().getByRole("heading")).toHaveTextContent(
      "Join a channel to chat.",
    );
  });

  it("disconnects and reconnects from the File menu, and Exit closes it", async () => {
    const { deps, user } = renderNapster();
    advance(deps, CONNECT_MS);
    await menu(user, "File", "Disconnect");
    expect(screen.getByTestId("napster-status-left")).toHaveTextContent(
      "Offline",
    );
    expect(screen.getByTestId("napster-status-right")).toHaveTextContent(
      "Not connected to the Napster network.",
    );
    await user.click(napster().getByRole("tab", { name: "Chat" }));
    expect(napster().getByRole("heading")).toHaveTextContent("Not connected.");
    await user.click(napster().getByRole("tab", { name: "Home" }));
    expect(
      napster().getByText("Not connected. Choose File, Connect."),
    ).toBeInTheDocument();
    await menu(user, "File", "Connect");
    expect(
      napster().getByText("Connecting to the Napster network..."),
    ).toBeInTheDocument();
    advance(deps, CONNECT_MS);
    expect(
      napster().getByText("Connected to the Napster network."),
    ).toBeInTheDocument();
    await menu(user, "File", "Exit");
    expect(
      screen.queryByRole("dialog", { name: NAPSTER_TITLE }),
    ).not.toBeInTheDocument();
  });

  it("gets shut down by the court order, with the notice", () => {
    const { deps } = renderNapster({ shutdownChance: 1 });
    advance(deps, CONNECT_MS + 1000);
    expect(screen.getByText(COURT_ORDER_MESSAGE)).toBeInTheDocument();
    expect(screen.getByTestId("napster-status-right")).toHaveTextContent(
      "court order",
    );
  });

  it("shows the court order on Home after a shutdown too", async () => {
    const { deps, user } = renderNapster({ shutdownChance: 1 });
    advance(deps, CONNECT_MS + 1000);
    await user.click(napster().getByRole("tab", { name: "Home" }));
    expect(
      napster().getByText(/^Disconnected: .* court order\.$/),
    ).toBeInTheDocument();
  });

  it("has Home, Discover, Help, the Actions menu and an About box", async () => {
    const { deps, user } = renderNapster();
    advance(deps, CONNECT_MS);
    await menu(user, "Actions", "Join Channel");
    expect(napster().getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await menu(user, "Actions", "Search");
    expect(napster().getByRole("tab", { name: "Search" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await menu(user, "Actions", "Clear Finished Transfers");
    await menu(user, "Help", "Help Topics");
    expect(
      napster().getByText("What does Remotely Queued mean?"),
    ).toBeInTheDocument();
    await user.click(napster().getByRole("tab", { name: "Discover" }));
    expect(
      napster().getByText("People who share songs like yours also share:"),
    ).toBeInTheDocument();
    expect(napster().getByLabelText("Banner")).toHaveTextContent(
      "Want Your Ad Here?",
    );
    await user.click(napster().getByRole("tab", { name: "Home" }));
    expect(napster().getByText("Napster News")).toBeInTheDocument();
    await menu(user, "Help", "About Napster...");
    expect(
      screen.getByRole("dialog", { name: "About Napster" }),
    ).toHaveTextContent("Due to a court order");
    await user.click(napster().getByRole("tab", { name: "Transfer" }));
    expect(napster().getByLabelText("Banner")).toHaveTextContent(
      "www.fusegames.ai",
    );
  });
});
