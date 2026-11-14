import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import {
  FIXTURE_GAMES,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { HALL_OF_FAME_WINDOW_ID } from "../desktop/startMenuRegistry";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import type { HallOfFameEntry } from "./leaderboard";
import { MemoryLeaderboardService } from "./leaderboardService";
import { SERVER_NOT_RESPONDING } from "./useHallOfFameViewModel";

const FUSEBALL: HallOfFameEntry[] = [
  {
    rank: 1,
    name: "Zola",
    elo: 1180,
    games: 12,
    rounds: 12,
    publicId: "a".repeat(20),
  },
  { rank: 2, name: "amir", elo: 1060, games: 20, rounds: 18 },
  { rank: 3, name: "Bea", elo: 1010, games: 3 },
  { rank: 4, name: "Cy", elo: 940, games: 30, rounds: 30 },
];
const RIDERS: HallOfFameEntry[] = [
  { rank: 1, name: "Rider One", elo: 1500, games: 99, rounds: 99 },
];

function openState(gameId?: string): AppState {
  return {
    ...DEFAULT_STATE,
    windows: [
      {
        id: HALL_OF_FAME_WINDOW_ID,
        minimized: false,
        maximized: false,
        kind: "halloffame",
        ...(gameId ? { gameId } : {}),
      },
    ],
  };
}

function renderHallOfFame(
  service: MemoryLeaderboardService,
  options: Omit<ProviderOptions, "hallOfFameDeps"> = {},
) {
  return renderWithProviders(<Desktop />, {
    ...options,
    initialState: options.initialState ?? openState(),
    hallOfFameDeps: { leaderboards: service },
  });
}

const findWindow = () => screen.findByRole("dialog", { name: "Hall of Fame" });
/** Two windows carry the name: the app and its message box. The box is the one with OK. */
const findMessageBox = () =>
  waitFor(() => {
    const box = screen
      .getAllByRole("dialog", { name: "Hall of Fame" })
      .find((dialog) => within(dialog).queryByRole("button", { name: "OK" }));
    if (!box) throw new Error("no message box yet");
    return box;
  });
const findTable = async (name = "Fuseball leaderboard") =>
  within(await findWindow()).findByRole("table", { name });
const rowsOf = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent?.trim() ?? ""),
    );

describe("HallOfFameWindow", () => {
  it("lists the first game's board by rank with podium trophies and a player count", async () => {
    const service = new MemoryLeaderboardService({ fuseball: FUSEBALL });
    renderHallOfFame(service);
    const table = await findTable();
    expect(rowsOf(table)).toEqual([
      ["1", "Zola", "1180", "12", "12"],
      ["2", "amir", "1060", "18", "20"],
      ["3", "Bea", "1010", "0", "3"],
      ["4", "Cy", "940", "30", "30"],
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.slice(0, 3).map((row) => row.dataset.podium)).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect(rows[3]?.dataset.podium).toBe("false");
    expect(rows[0]?.querySelector("svg[data-icon='trophy']")).not.toBeNull();
    expect(rows[3]?.querySelector("svg[data-icon='trophy']")).toBeNull();
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "4 players",
    );
    expect(service.requests).toEqual(["fuseball"]);
    const picker = within(await findWindow()).getByRole("combobox", {
      name: "Game:",
    });
    expect(picker).toHaveValue("fuseball");
    expect(
      within(picker)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(FIXTURE_GAMES.map((game) => game.name));
    // The window's own icon is the trophy too.
    const dialog = await findWindow();
    expect(dialog.querySelector("svg[data-icon='trophy']")).not.toBeNull();
  });

  it("shows the hourglass while loading and the list once the board arrives", async () => {
    const service = new MemoryLeaderboardService({ fuseball: FUSEBALL });
    const release = service.hold();
    renderHallOfFame(service);
    const dialog = await findWindow();
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Loading the Hall of Fame...",
    );
    expect(dialog.querySelector("svg[data-icon='hourglass']")).not.toBeNull();
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "Loading...",
    );
    expect(within(dialog).queryByRole("table")).toBeNull();
    await act(async () => release());
    await findTable();
    expect(dialog.querySelector("svg[data-icon='hourglass']")).toBeNull();
  });

  it("sorts by a column on click, flips it on a second click and returns to rank order", async () => {
    const user = userEvent.setup();
    renderHallOfFame(new MemoryLeaderboardService({ fuseball: FUSEBALL }));
    const table = await findTable();
    const header = (name: string) =>
      within(table).getByRole("button", { name });
    expect(
      within(table).getByRole("columnheader", { name: "Rank" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await user.click(header("Matches"));
    expect(rowsOf(table).map((row) => row[1])).toEqual([
      "Cy",
      "amir",
      "Zola",
      "Bea",
    ]);
    expect(
      within(table).getByRole("columnheader", { name: "Matches" }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(
      within(table).getByRole("columnheader", { name: "Rank" }),
    ).toHaveAttribute("aria-sort", "none");
    await user.click(header("Matches"));
    expect(rowsOf(table).map((row) => row[1])).toEqual([
      "Bea",
      "Zola",
      "amir",
      "Cy",
    ]);
    await user.click(header("Player"));
    expect(rowsOf(table).map((row) => row[1])).toEqual([
      "amir",
      "Bea",
      "Cy",
      "Zola",
    ]);
    await user.click(header("Elo"));
    expect(rowsOf(table).map((row) => row[1])).toEqual([
      "Zola",
      "amir",
      "Bea",
      "Cy",
    ]);
    await user.click(header("Rounds"));
    expect(rowsOf(table).map((row) => row[1])).toEqual([
      "Cy",
      "amir",
      "Zola",
      "Bea",
    ]);
    await user.click(header("Rank"));
    expect(rowsOf(table).map((row) => row[1])).toEqual([
      "Zola",
      "amir",
      "Bea",
      "Cy",
    ]);
  });

  it("switches game from the picker, remembers it in the window state and keeps the sort", async () => {
    const user = userEvent.setup();
    const service = new MemoryLeaderboardService({
      fuseball: FUSEBALL,
      "fuse-riders": RIDERS,
    });
    const { store } = renderHallOfFame(service);
    const table = await findTable();
    await user.click(within(table).getByRole("button", { name: "Player" }));
    await user.selectOptions(
      within(await findWindow()).getByRole("combobox", { name: "Game:" }),
      "fuse-riders",
    );
    const riders = await findTable("Fuse Riders leaderboard");
    expect(rowsOf(riders)).toEqual([["1", "Rider One", "1500", "99", "99"]]);
    expect(
      within(riders).getByRole("columnheader", { name: "Player" }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "1 player",
    );
    expect(service.requests).toEqual(["fuseball", "fuse-riders"]);
    await waitFor(() =>
      expect(store.load().windows[0]).toMatchObject({
        kind: "halloffame",
        gameId: "fuse-riders",
      }),
    );
    // Picking the same game again is not a reload.
    await user.selectOptions(
      within(await findWindow()).getByRole("combobox", { name: "Game:" }),
      "fuse-riders",
    );
    expect(service.requests).toEqual(["fuseball", "fuse-riders"]);
  });

  it("opens on the remembered game, and on the first game when the remembered one is gone", async () => {
    const service = new MemoryLeaderboardService({
      fuseball: FUSEBALL,
      "fuse-riders": RIDERS,
    });
    const first = renderHallOfFame(service, {
      initialState: openState("fuse-riders"),
    });
    await findTable("Fuse Riders leaderboard");
    expect(service.requests).toEqual(["fuse-riders"]);
    first.unmount();
    renderHallOfFame(service, { initialState: openState("uninstalled-game") });
    await findTable("Fuseball leaderboard");
    expect(service.requests).toEqual(["fuse-riders", "fuseball"]);
  });

  it("says so when nobody is rated yet, and when no Fuse game is installed", async () => {
    const empty = new MemoryLeaderboardService({ fuseball: [] });
    const first = renderHallOfFame(empty);
    const dialog = await findWindow();
    expect(
      await within(dialog).findByText(
        /Nobody has played a rated round of Fuseball yet/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "No rated players yet",
    );
    first.unmount();
    renderHallOfFame(new MemoryLeaderboardService(), { games: [] });
    const bare = await findWindow();
    expect(
      await within(bare).findByText(/No Fuse games are installed/),
    ).toBeInTheDocument();
    expect(
      within(bare).getByRole("combobox", { name: "Game:" }),
    ).toBeDisabled();
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "No Fuse games installed",
    );
  });

  it("shows 'The server is not responding' in a message box and inline when the service is unreachable, and Retry loads", async () => {
    const user = userEvent.setup();
    const service = new MemoryLeaderboardService({ fuseball: FUSEBALL });
    service.failWith({ kind: "unreachable" });
    renderHallOfFame(service);
    const message = await findMessageBox();
    if (!message) throw new Error("no message box");
    expect(message).toHaveTextContent(SERVER_NOT_RESPONDING);
    expect(message).toHaveTextContent("Check that you are online");
    expect(message.querySelector("svg[data-icon='warning']")).not.toBeNull();
    await user.click(within(message).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("dialog", { name: "Hall of Fame" }),
      ).toHaveLength(1),
    );
    const app = screen.getByRole("dialog", { name: "Hall of Fame" });
    const alert = within(app).getByRole("alert");
    expect(alert).toHaveTextContent(SERVER_NOT_RESPONDING);
    expect(alert).toHaveTextContent("The leaderboard could not be loaded.");
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      SERVER_NOT_RESPONDING,
    );
    expect(within(app).queryByRole("table")).toBeNull();

    service.failWith(undefined);
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await findTable();
    expect(service.requests).toEqual(["fuseball", "fuseball"]);
  });

  it("words a refusing server, a rate limit and a game without a board differently", async () => {
    const user = userEvent.setup();
    const service = new MemoryLeaderboardService({ fuseball: FUSEBALL });
    service.failWith({ kind: "status", status: 500 });
    renderHallOfFame(service);
    const message = await findMessageBox();
    expect(message).toHaveTextContent("It answered with error 500");
    await user.click(within(message).getByRole("button", { name: "OK" }));

    service.failWith({ kind: "status", status: 429 });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    const limited = await findMessageBox();
    expect(limited).toHaveTextContent("Too many requests. Wait a moment");
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "Too many requests.",
    );
    await user.click(within(limited).getByRole("button", { name: "OK" }));

    service.failWith({ kind: "status", status: 404 });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This game has no Hall of Fame yet.");
    expect(alert).not.toHaveTextContent("could not be loaded");
    await user.click(
      within(await findMessageBox()).getByRole("button", { name: "OK" }),
    );

    service.failWith({ kind: "invalid" });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await findMessageBox()).toHaveTextContent("was not a leaderboard");
  });

  it("drops a board that is still loading when the game changes, and stops the load when the window closes", async () => {
    const user = userEvent.setup();
    const service = new MemoryLeaderboardService({
      fuseball: FUSEBALL,
      "fuse-riders": RIDERS,
    });
    const release = service.hold();
    renderHallOfFame(service);
    const dialog = await findWindow();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Game:" }),
      "fuse-riders",
    );
    expect(service.requests).toEqual(["fuseball", "fuse-riders"]);
    await act(async () => release());
    await findTable("Fuse Riders leaderboard");
    expect(
      within(dialog).queryByRole("table", { name: "Fuseball leaderboard" }),
    ).toBeNull();
    expect(screen.getByTestId("halloffame-status")).toHaveTextContent(
      "1 player",
    );

    // Closing mid-load: the request is aborted, so a failure answer after close opens no message box.
    const hold = service.hold();
    service.failWith({ kind: "unreachable" });
    await user.click(
      within(await findTable("Fuse Riders leaderboard")).getByRole("button", {
        name: "Rank",
      }),
    );
    const win = await findWindow();
    await user.selectOptions(
      within(win).getByRole("combobox", { name: "Game:" }),
      "fuseball",
    );
    await user.click(within(win).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Hall of Fame" })).toBeNull(),
    );
    await act(async () => hold());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog", { name: "Hall of Fame" })).toBeNull();
  });

  it("is reachable from Start > Programs and reuses its window", async () => {
    const user = userEvent.setup();
    const service = new MemoryLeaderboardService({ fuseball: FUSEBALL });
    renderWithProviders(<Desktop />, {
      hallOfFameDeps: { leaderboards: service },
    });
    const open = async () => {
      await user.click(screen.getByRole("button", { name: /Start/ }));
      const menu = await screen.findByRole("menu", { name: "Start menu" });
      await user.click(
        within(menu).getByRole("menuitem", { name: "Programs" }),
      );
      const programs = within(menu).getAllByRole("menu").at(-1);
      if (!programs) throw new Error("no Programs submenu");
      await user.click(
        within(programs).getByRole("menuitem", { name: "Hall of Fame" }),
      );
    };
    await open();
    await findTable();
    await open();
    expect(
      screen.getAllByRole("dialog", { name: "Hall of Fame" }),
    ).toHaveLength(1);
    expect(service.requests).toEqual(["fuseball"]);
  });
});
