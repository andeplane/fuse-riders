import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { scriptedRandom } from "../__mocks__/seededRandom";
import { Desktop } from "../desktop/Desktop";
import { MY_COMPUTER } from "../disk/diskPath";
import { createManualTimers } from "../display/effects/effectsDeps";
import type { AppState, WindowState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";
import type { WinampControls } from "../winamp/winampControls";

import type { DefragDeps } from "./defragDepsContext";
import {
  createDefragSessions,
  DefragDepsContext,
  DefragSessionsContext,
} from "./defragDepsContext";
import {
  ANOTHER_PROGRAM_WROTE,
  CHECK_TICKS,
  CLUSTERS,
  CONTENTS_CHANGED,
  GRID_COLUMNS,
  GRID_ROWS,
  REDUCED_TICK_MS,
  TICK_MS,
} from "./defragSession";
import { LEGEND } from "./DefragWindow";
import type { DefragWindowContent } from "./defragWindowContent";

type Setup = ProviderOptions & {
  content?: Omit<DefragWindowContent, "kind">;
  minimized?: boolean;
  random?: readonly number[];
  reduced?: boolean;
  /** Open nothing: the test opens Disk Defragmenter itself. */
  closed?: boolean;
};

function renderDefrag({
  content = {},
  minimized = false,
  random = [0.99, 0],
  reduced = false,
  closed = false,
  ...options
}: Setup = {}) {
  const timers = createManualTimers();
  const deps: DefragDeps = {
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    random: scriptedRandom(random),
    reducedMotion: () => reduced,
  };
  const sessions = createDefragSessions();
  const state: AppState = {
    ...DEFAULT_STATE,
    windows: closed
      ? []
      : [
          {
            id: "w1",
            minimized,
            maximized: false,
            kind: "defrag",
            ...content,
          },
        ],
  };
  const result = renderWithProviders(
    <DefragDepsContext.Provider value={deps}>
      <DefragSessionsContext.Provider value={sessions}>
        <Desktop />
      </DefragSessionsContext.Provider>
    </DefragDepsContext.Provider>,
    { initialState: state, ...options },
  );
  const advance = (ms: number) => act(() => timers.advance(ms));
  /** Lets the manifest promise land. */
  const settle = () => act(async () => undefined);
  return { ...result, timers, sessions, advance, settle };
}

const defragWindows = (store: { load: () => AppState }): WindowState[] =>
  store.load().windows.filter((window) => window.kind === "defrag");

const percentShown = () =>
  Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

describe("Disk Defragmenter: choosing a drive", () => {
  it("opens on Select Drive with the repo drive, the floppy and All Hard Drives", async () => {
    const { settle } = renderDefrag();
    await settle();
    const dialog = screen.getByRole("dialog", { name: "Select Drive" });
    const drive = within(dialog).getByRole("combobox", {
      name: "Which drive do you want to defragment?",
    });
    expect(drive).toHaveValue("C");
    expect(
      within(drive)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Fuse Riders (C:)", "3½ Floppy (A:)", "All Hard Drives"]);
    expect(within(dialog).getByRole("button", { name: "OK" })).toHaveFocus();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("keeps the settings OK saves and forgets the ones Cancel leaves", async () => {
    const user = userEvent.setup();
    const { settle, advance } = renderDefrag();
    await settle();
    await user.click(screen.getByRole("button", { name: "Settings..." }));
    const settings = screen.getByRole("dialog", {
      name: "Disk Defragmenter Settings",
    });
    const rearrange = within(settings).getByRole("checkbox", {
      name: "Rearrange program files so my programs start faster.",
    });
    const check = within(settings).getByRole("checkbox", {
      name: "Check the drive for errors.",
    });
    expect(rearrange).toBeChecked();
    expect(check).toBeChecked();
    expect(
      within(settings).getByRole("radio", {
        name: "Every time I defragment my hard drive.",
      }),
    ).toBeChecked();
    await user.click(check);
    await user.click(
      within(settings).getByRole("radio", { name: "This time only." }),
    );
    await user.click(within(settings).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Settings..." }));
    expect(
      screen.getByRole("checkbox", { name: "Check the drive for errors." }),
    ).toBeChecked();
    await user.click(
      screen.getByRole("checkbox", { name: "Check the drive for errors." }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Rearrange program files so my programs start faster.",
      }),
    );
    await user.click(screen.getByRole("radio", { name: "This time only." }));
    await user.click(
      screen.getByRole("radio", {
        name: "Every time I defragment my hard drive.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    await user.click(screen.getByRole("button", { name: "Settings..." }));
    expect(
      screen.getByRole("checkbox", { name: "Check the drive for errors." }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "OK" }));

    // No error check, no rearranging: the first beat already names a file.
    await user.click(screen.getByRole("button", { name: "OK" }));
    advance(TICK_MS);
    expect(screen.getByText(/^Defragmenting file: /)).toBeInTheDocument();
  });

  it("closes the window on Exit", async () => {
    const user = userEvent.setup();
    const { settle, store, sessions } = renderDefrag();
    await settle();
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(screen.queryByRole("dialog", { name: "Select Drive" })).toBeNull();
    expect(defragWindows(store)).toEqual([]);
    expect(sessions.get("w1")).toBeUndefined();
  });

  it("grinds the floppy when asked to defragment A:", async () => {
    const user = userEvent.setup();
    const { settle, diskDeps, advance } = renderDefrag();
    await settle();
    await user.selectOptions(screen.getByRole("combobox"), "A");
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(
      screen.getByRole("dialog", { name: "0% - Defragmenting Drive A" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Defragmenting Drive A")).toBeInTheDocument();
    expect(diskDeps.seeks).toBe(1);
    advance(TICK_MS * (CHECK_TICKS + 2));
    expect(
      screen.getByText("Defragmenting file: slackbacup.zip"),
    ).toBeInTheDocument();
  });

  it("survives a floppy drive that cannot make its noise", async () => {
    const { settle } = renderDefrag({
      content: { drive: "A", stage: "running" },
      disk: { floppySeek: () => Promise.reject(new Error("no audio")) },
    });
    await settle();
    expect(
      screen.getByRole("dialog", { name: "0% - Defragmenting Drive A" }),
    ).toBeInTheDocument();
  });
});

describe("Disk Defragmenter: a run", () => {
  it("shows progress, pauses and resumes, and opens the cluster grid and its legend", async () => {
    const user = userEvent.setup();
    const { settle, advance, store } = renderDefrag();
    await settle();
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(
      screen.getByRole("dialog", { name: "0% - Defragmenting Drive C" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Defragmenting Drive C")).toBeInTheDocument();
    expect(screen.getByText("0% Complete")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Disk clusters/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Legend" })).toBeNull();

    advance(TICK_MS);
    expect(
      screen.getByText("Checking drive for errors..."),
    ).toBeInTheDocument();
    advance(TICK_MS * (CHECK_TICKS + 120));
    const reached = percentShown();
    expect(reached).toBeGreaterThan(0);
    expect(screen.getByText(`${reached}% Complete`)).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", {
        name: `${reached}% - Defragmenting Drive C`,
      }),
    ).toBeInTheDocument();
    expect(defragWindows(store)[0]).toMatchObject({
      stage: "running",
      drive: "C",
      details: false,
      percent: reached,
    });

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Paused")).toBeInTheDocument();
    advance(TICK_MS * 100);
    expect(percentShown()).toBe(reached);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    advance(TICK_MS * 100);
    expect(percentShown()).toBeGreaterThan(reached);

    await user.click(screen.getByRole("button", { name: "Show Details" }));
    const grid = screen.getByRole("img", {
      name: /Disk clusters, \d+% defragmented/,
    });
    const cells = grid.querySelectorAll("i");
    expect(cells).toHaveLength(CLUSTERS);
    expect(grid.children).toHaveLength(GRID_ROWS);
    expect(grid.firstElementChild?.children).toHaveLength(GRID_COLUMNS);
    const states = new Set(
      [...cells].map((cell) => cell.getAttribute("data-state")),
    );
    expect(states).toContain("optimized");
    expect(states).toContain("free");
    expect(states).toContain("fixed");
    expect(defragWindows(store)[0]).toMatchObject({ details: true });
    // The first row of the drive is already in order.
    expect(cells[0]).toHaveAttribute("data-state", "optimized");
    // The head shows up as it reads and writes.
    const head = new Set<string | null>();
    for (let beat = 0; beat < 12; beat += 1) {
      advance(TICK_MS);
      grid
        .querySelectorAll('[data-state="reading"], [data-state="writing"]')
        .forEach((cell) => head.add(cell.getAttribute("data-state")));
    }
    expect(head).toEqual(new Set(["reading", "writing"]));

    await user.click(screen.getByRole("button", { name: "Legend" }));
    const legend = screen.getByRole("alertdialog", { name: "Defrag Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Unoptimized data that:", ...LEGEND.map((line) => line.label)]);
    expect(
      [...legend.querySelectorAll(".defrag-swatch")].map((swatch) =>
        swatch.getAttribute("data-state"),
      ),
    ).toEqual(LEGEND.map((line) => line.state));
    expect(
      within(legend).getByText("Each box represents one disk cluster."),
    ).toBeInTheDocument();
    await user.click(within(legend).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Hide Details" }));
    expect(screen.queryByRole("img", { name: /Disk clusters/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show Details" }),
    ).toBeInTheDocument();
  });

  it("asks before stopping, and closes the window on Yes", async () => {
    const user = userEvent.setup();
    const { settle, advance, store } = renderDefrag({
      content: { drive: "C", stage: "running" },
    });
    await settle();
    advance(TICK_MS * 5);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    const question = screen.getByRole("alertdialog", { name: "Are you sure?" });
    expect(
      within(question).getByText(
        "Are you sure you want to stop defragmenting drive C?",
      ),
    ).toBeInTheDocument();
    await user.click(within(question).getByRole("button", { name: "No" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(defragWindows(store)).toEqual([]);
  });

  it("finds the drive's contents changed, restarts, and finishes with the question everyone remembers", async () => {
    const user = userEvent.setup();
    const { settle, advance, store } = renderDefrag({
      content: { drive: "C", stage: "running" },
      random: [0, 0],
      reduced: true,
    });
    await settle();
    for (
      let beat = 0;
      beat < 400 && !screen.queryByRole("alertdialog");
      beat += 1
    )
      advance(REDUCED_TICK_MS);
    const notice = screen.getByRole("alertdialog", {
      name: "Disk Defragmenter",
    });
    expect(within(notice).getByText(CONTENTS_CHANGED("C"))).toBeInTheDocument();
    expect(
      within(notice).getByText("(Clippy saved a tip you did not ask for.)"),
    ).toBeInTheDocument();
    expect(percentShown()).toBe(0);
    await user.click(within(notice).getByRole("button", { name: "OK" }));

    for (
      let beat = 0;
      beat < 400 && !screen.queryByRole("alertdialog");
      beat += 1
    )
      advance(REDUCED_TICK_MS);
    const done = screen.getByRole("alertdialog", { name: "Disk Defragmenter" });
    expect(done).toHaveTextContent(
      "Defragmentation of drive C is complete.Do you want to quit Disk Defragmenter?",
    );
    expect(percentShown()).toBe(100);
    expect(
      screen.getByRole("dialog", { name: "100% - Defragmenting Drive C" }),
    ).toBeInTheDocument();

    // No: back to Select Drive, ready for another go.
    await user.click(within(done).getByRole("button", { name: "No" }));
    expect(
      screen.getByRole("dialog", { name: "Select Drive" }),
    ).toBeInTheDocument();
    expect(defragWindows(store)[0]).toMatchObject({ stage: "select" });

    await user.click(screen.getByRole("button", { name: "OK" }));
    for (
      let beat = 0;
      beat < 400 && !screen.queryByRole("alertdialog");
      beat += 1
    )
      advance(REDUCED_TICK_MS);
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(defragWindows(store)).toEqual([]);
  });

  it("blames Winamp for writing to the disk while it plays", async () => {
    const { settle, advance, winampRegistry } = renderDefrag({
      content: { drive: "C", stage: "running" },
      reduced: true,
    });
    const playing = { value: true };
    const controls: WinampControls = {
      status: () => ({
        trackCount: 1,
        tracks: ["Fuseball Theme (Fuseball)"],
        currentTrack: "Fuseball Theme (Fuseball)",
        playing: playing.value,
      }),
      play: () => undefined,
      pause: () => undefined,
      stop: () => undefined,
      next: () => undefined,
      previous: () => undefined,
    };
    winampRegistry.set("w9", controls);
    await settle();
    for (
      let beat = 0;
      beat < 400 && !screen.queryByRole("alertdialog");
      beat += 1
    )
      advance(REDUCED_TICK_MS);
    const notice = screen.getByRole("alertdialog");
    expect(within(notice).getByText(ANOTHER_PROGRAM_WROTE)).toBeInTheDocument();
    expect(
      within(notice).getByText(
        "(Winamp is playing Fuseball Theme (Fuseball).)",
      ),
    ).toBeInTheDocument();
    // The notice goes away by itself.
    advance(60_000);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("blames Winamp even when it cannot name the track, and leaves a paused Winamp alone", async () => {
    const { settle, advance, winampRegistry } = renderDefrag({
      content: { drive: "C", stage: "running" },
      reduced: true,
    });
    const state = { playing: true };
    winampRegistry.set("w9", {
      status: () => ({
        trackCount: 0,
        tracks: [],
        currentTrack: undefined,
        playing: state.playing,
      }),
      play: () => undefined,
      pause: () => undefined,
      stop: () => undefined,
      next: () => undefined,
      previous: () => undefined,
    });
    await settle();
    for (
      let beat = 0;
      beat < 400 && !screen.queryByRole("alertdialog");
      beat += 1
    )
      advance(REDUCED_TICK_MS);
    expect(screen.getByText("(Winamp is playing a song.)")).toBeInTheDocument();
    state.playing = false;
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    for (
      let beat = 0;
      beat < 400 && !screen.queryByRole("alertdialog");
      beat += 1
    )
      advance(REDUCED_TICK_MS);
    // The next notice is the once-a-sitting one, not Winamp's.
    expect(screen.getByText(CONTENTS_CHANGED("C"))).toBeInTheDocument();
  });

  it("keeps running while minimized, with the percent on its taskbar button", async () => {
    const user = userEvent.setup();
    const { settle, advance } = renderDefrag({
      content: { drive: "C", stage: "running" },
    });
    await settle();
    await user.click(
      within(
        screen.getByRole("dialog", { name: "0% - Defragmenting Drive C" }),
      ).getByRole("button", { name: "Minimize" }),
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    advance(TICK_MS * (CHECK_TICKS + 200));
    const taskbar = within(screen.getByRole("toolbar", { name: "Taskbar" }));
    const button = taskbar.getByRole("button", {
      name: /^\d+% - Defragmenting Drive C$/,
    });
    const minimizedPercent = Number.parseInt(button.textContent ?? "", 10);
    expect(minimizedPercent).toBeGreaterThan(0);
    await user.click(button);
    expect(percentShown()).toBe(minimizedPercent);
  });

  it("defragments a familiar drive when the manifest cannot be read", async () => {
    const { settle, advance } = renderDefrag({
      content: { drive: "C", stage: "running" },
      disk: { source: { manifestFailures: 5 } },
    });
    expect(
      screen.getByText("Reading drive information..."),
    ).toBeInTheDocument();
    await settle();
    advance(TICK_MS * (CHECK_TICKS + 2));
    expect(
      screen.getByText("Rearranging program file: GAMES/DOOM/DOOM.WAD"),
    ).toBeInTheDocument();
  });

  it("drops a manifest that arrives after the window has gone", async () => {
    const { store, unmount } = renderDefrag({
      content: { drive: "C", stage: "running" },
    });
    unmount();
    await act(async () => undefined);
    expect(defragWindows(store)).toHaveLength(1);
    const failing = renderDefrag({
      content: { drive: "C", stage: "running" },
      disk: { source: { manifestFailures: 5 } },
    });
    failing.unmount();
    await act(async () => undefined);
    expect(failing.sessions.get("w1")).toBeUndefined();
  });
});

describe("Disk Defragmenter: where it lives", () => {
  it("is under Start > Programs > Accessories > System Tools, and opens once", async () => {
    const user = userEvent.setup();
    const { settle, store } = renderDefrag({ closed: true });
    for (let round = 0; round < 2; round += 1) {
      await user.click(screen.getByRole("button", { name: "Start" }));
      const menu = screen.getByRole("menu", { name: "Start menu" });
      await user.click(
        within(menu).getByRole("menuitem", { name: "Programs" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", { name: "Accessories" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", { name: "System Tools" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", { name: "Disk Defragmenter" }),
      );
      await settle();
    }
    expect(
      screen.getByRole("dialog", { name: "Select Drive" }),
    ).toBeInTheDocument();
    expect(defragWindows(store)).toHaveLength(1);
  });

  it("starts at once from a drive's Defragment Now... in My Computer", async () => {
    const user = userEvent.setup();
    const { settle, store } = renderDefrag({
      closed: true,
      initialOpen: [{ kind: "explorer", location: MY_COMPUTER }],
    });
    await settle();
    const contents = within(screen.getByLabelText("Folder contents"));
    fireEvent.contextMenu(
      contents.getByRole("option", { name: /Fuse Riders \(C:\)/ }),
      {
        clientX: 10,
        clientY: 10,
      },
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Defragment Now..." }),
    );
    await settle();
    expect(
      screen.getByRole("dialog", { name: "0% - Defragmenting Drive C" }),
    ).toBeInTheDocument();
    expect(defragWindows(store)[0]).toMatchObject({
      drive: "C",
      stage: "running",
    });
  });
});
