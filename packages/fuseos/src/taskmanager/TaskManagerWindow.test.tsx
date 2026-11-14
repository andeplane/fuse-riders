import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState, WindowContent } from "../state/appState";

import { FakeTaskManagerDeps } from "./fakeTaskManagerDeps";
import { STALL_MS } from "./frameSampler";
import { TaskManagerDepsContext } from "./taskManagerDeps";
import {
  openTaskManager,
  TASK_MANAGER_REGISTRATION,
  TASK_MANAGER_WINDOW_ID,
} from "./taskManagerRegistration";
import { TaskManagerWindow } from "./TaskManagerWindow";
import { HISTORY_LENGTH } from "./useTaskManagerViewModel";

type User = ReturnType<typeof userEvent.setup>;

function stateWith(
  ...windows: Array<{ id: string; content: WindowContent; minimized?: boolean }>
): AppState {
  return {
    version: 1,
    windows: windows.map(({ id, content, minimized }) => ({
      id,
      minimized: minimized ?? false,
      maximized: false,
      ...content,
    })),
  };
}

const THREE_WINDOWS = stateWith(
  { id: "w1", content: { kind: "fusegame", gameId: "fuseball" } },
  { id: "w2", content: { kind: "paint" } },
  { id: TASK_MANAGER_WINDOW_ID, content: { kind: "taskmanager" } },
);

function renderTaskManager(
  initialState: AppState = THREE_WINDOWS,
  deps = new FakeTaskManagerDeps(),
) {
  const result = renderWithProviders(
    <TaskManagerDepsContext.Provider value={deps}>
      <TaskManagerWindow windowId={TASK_MANAGER_WINDOW_ID} />
    </TaskManagerDepsContext.Provider>,
    { initialState },
  );
  return { ...result, deps };
}

function tick(deps: FakeTaskManagerDeps, ms = 1000) {
  act(() => deps.tick(ms));
}

function taskRows() {
  return within(screen.getByRole("table", { name: "Tasks" }))
    .getAllByRole("row")
    .slice(1);
}

function rowFor(title: string) {
  const row = taskRows().find((entry) => entry.textContent?.includes(title));
  if (!row) throw new Error(`No task row for ${title}`);
  return row;
}

async function showPerformance(user: User) {
  await user.click(screen.getByRole("tab", { name: "Performance" }));
  return screen.getByRole("tabpanel", { name: "Performance" });
}

describe("TaskManagerWindow, Applications", () => {
  it("lists every open window with its title, Running and, for a page in an iframe, its frame rate", () => {
    const deps = new FakeTaskManagerDeps();
    const game = deps.addFrame("w1");
    renderTaskManager(THREE_WINDOWS, deps);
    expect(taskRows().map((row) => row.textContent)).toEqual([
      "FuseballRunning",
      "untitled - PaintRunning",
      "FuseOS Task ManagerRunning",
    ]);
    // The first tick finds the page and starts counting; the next one reads the count.
    tick(deps);
    expect(rowFor("Fuseball")).toHaveTextContent("Running");
    expect(rowFor("Fuseball")).not.toHaveTextContent(/\d/);
    game.paint(30);
    tick(deps);
    expect(rowFor("Fuseball")).toHaveTextContent("Running30");
    expect(rowFor("Paint")).not.toHaveTextContent(/\d/);
    expect(
      screen.getByRole("status", { name: "Task Manager status" }),
    ).toHaveTextContent(
      "Windows: 3Not responding: 0Desktop: 0 fpsMem usage: n/a",
    );
  });

  it("marks a page whose frames stop for more than two seconds Not Responding, and Running again when they resume", () => {
    const deps = new FakeTaskManagerDeps();
    const game = deps.addFrame("w1");
    renderTaskManager(THREE_WINDOWS, deps);
    tick(deps);
    game.paint();
    tick(deps);
    tick(deps, STALL_MS + 1);
    expect(rowFor("Fuseball")).toHaveTextContent("Not Responding0");
    expect(screen.getByRole("status")).toHaveTextContent("Not responding: 1");
    game.paint(5);
    tick(deps);
    expect(rowFor("Fuseball")).toHaveTextContent("Running5");
  });

  it("says so when no windows are open", () => {
    renderTaskManager(stateWith());
    expect(screen.getByRole("table", { name: "Tasks" })).toHaveTextContent(
      "No windows are open.",
    );
    expect(screen.getByRole("button", { name: "End Task" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch To" })).toBeDisabled();
  });

  it("End Task closes the selected window, which drops out of the list and from the sampling", async () => {
    const user = userEvent.setup();
    const deps = new FakeTaskManagerDeps();
    const game = deps.addFrame("w1");
    const { store } = renderTaskManager(THREE_WINDOWS, deps);
    tick(deps);
    expect(screen.getByRole("button", { name: "End Task" })).toBeDisabled();
    await user.click(rowFor("Fuseball"));
    expect(rowFor("Fuseball")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "End Task" }));
    expect(taskRows()).toHaveLength(2);
    expect(store.load().windows.map((window) => window.id)).toEqual([
      "w2",
      TASK_MANAGER_WINDOW_ID,
    ]);
    tick(deps);
    expect(game.pendingCount()).toBe(0);
    expect(screen.getByRole("button", { name: "End Task" })).toBeDisabled();
  });

  it("Switch To brings the selected window to the front and restores it when minimized; a double click does the same", async () => {
    const user = userEvent.setup();
    const { store } = renderTaskManager(
      stateWith(
        { id: "w2", content: { kind: "paint" }, minimized: true },
        { id: TASK_MANAGER_WINDOW_ID, content: { kind: "taskmanager" } },
      ),
    );
    await user.click(rowFor("Paint"));
    await user.click(screen.getByRole("button", { name: "Switch To" }));
    expect(store.load().windows.map((window) => window.id)).toEqual([
      TASK_MANAGER_WINDOW_ID,
      "w2",
    ]);
    expect(store.load().windows[1]?.minimized).toBe(false);
    await user.dblClick(rowFor("Task Manager"));
    expect(store.load().windows.map((window) => window.id)).toEqual([
      "w2",
      TASK_MANAGER_WINDOW_ID,
    ]);
  });

  it("offers Switch To and End Task from the Windows menu, closes from File and explains itself from Help", async () => {
    const user = userEvent.setup();
    const { store } = renderTaskManager();
    await user.click(screen.getByRole("menuitem", { name: "Windows" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "End Task" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(rowFor("Paint"));
    await user.click(screen.getByRole("menuitem", { name: "Windows" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "End Task" }),
    );
    expect(store.load().windows.map((window) => window.id)).toEqual([
      "w1",
      TASK_MANAGER_WINDOW_ID,
    ]);
    await user.click(rowFor("Fuseball"));
    await user.click(screen.getByRole("menuitem", { name: "Windows" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Switch To" }),
    );
    expect(store.load().windows.map((window) => window.id)).toEqual([
      TASK_MANAGER_WINDOW_ID,
      "w1",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "About Task Manager" }),
    );
    expect(
      store.load().windows.some((window) => window.kind === "dialog"),
    ).toBe(false);
    expect(taskRows().map((row) => row.textContent)).toContainEqual(
      expect.stringContaining("About Task Manager"),
    );
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Exit Task Manager" }),
    );
    expect(
      store.load().windows.some((window) => window.kind === "taskmanager"),
    ).toBe(false);
  });
});

describe("TaskManagerWindow, Performance", () => {
  it("graphs the desktop's frame rate and every page's, a column per tick, keeping a minute of history", async () => {
    const user = userEvent.setup();
    const deps = new FakeTaskManagerDeps();
    const game = deps.addFrame("w1");
    renderTaskManager(THREE_WINDOWS, deps);
    const panel = await showPerformance(user);
    expect(
      within(panel).getByRole("img", { name: "Desktop frame rate history" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("img", { name: "Fuseball frame rate history" }),
    ).toBeNull();
    tick(deps);
    deps.desktopFrame.paint(60);
    game.paint(45);
    tick(deps);
    expect(panel).toHaveTextContent("Desktop60 fps");
    expect(panel).toHaveTextContent("Fuseball45 fps");
    expect(
      within(panel).getByRole("img", { name: "Fuseball frame rate history" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("table", { name: "Totals" }),
    ).toHaveTextContent("Windows3Game pages1");
    for (let count = 0; count < HISTORY_LENGTH + 5; count += 1) {
      deps.desktopFrame.paint(count);
      tick(deps);
    }
    const trace = within(panel)
      .getByRole("img", { name: "Desktop frame rate history" })
      .querySelector("polyline");
    expect(trace?.getAttribute("points")?.split(" ")).toHaveLength(
      HISTORY_LENGTH,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `Desktop: ${HISTORY_LENGTH + 4} fps`,
    );
  });

  it("shows the JavaScript heap where the browser reports it, and says so where it does not", async () => {
    const user = userEvent.setup();
    const deps = new FakeTaskManagerDeps();
    renderTaskManager(THREE_WINDOWS, deps);
    const panel = await showPerformance(user);
    expect(panel).toHaveTextContent(
      "This browser does not report its JavaScript heap",
    );
    deps.heapSample = {
      usedBytes: 50 * 1024 * 1024,
      totalBytes: 200 * 1024 * 1024,
    };
    tick(deps);
    expect(panel).toHaveTextContent("JS heap usage50 MB of 200 MB");
    expect(
      within(panel).getByRole("img", { name: "JS heap usage history" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Mem usage: 50 MB");
    await user.click(screen.getByRole("tab", { name: "Applications" }));
    expect(
      screen.getByRole("tabpanel", { name: "Applications" }),
    ).toBeInTheDocument();
  });

  it("picks up a page that mounts later and lets go of one that navigates away, then stops sampling on close", () => {
    const deps = new FakeTaskManagerDeps();
    const { unmount } = renderTaskManager(THREE_WINDOWS, deps);
    tick(deps);
    expect(rowFor("Fuseball")).not.toHaveTextContent(/\d/);
    const first = deps.addFrame("w1");
    tick(deps);
    // The sampler starts on this tick: its first count is read on the next one.
    expect(rowFor("Fuseball")).not.toHaveTextContent(/\d/);
    first.paint(10);
    tick(deps);
    expect(rowFor("Fuseball")).toHaveTextContent("Running10");
    const second = deps.addFrame("w1");
    tick(deps);
    expect(first.pendingCount()).toBe(0);
    expect(second.pendingCount()).toBe(1);
    deps.frames.delete("w1");
    tick(deps);
    expect(second.pendingCount()).toBe(0);
    expect(rowFor("Fuseball")).toHaveTextContent("Running");
    expect(deps.subscriberCount()).toBe(1);
    unmount();
    expect(deps.subscriberCount()).toBe(0);
    expect(deps.desktopFrame.pendingCount()).toBe(0);
  });
});

describe("Task Manager on the desktop", () => {
  it("opens from Start > Programs > Accessories, once, and comes to the front when chosen again", async () => {
    const user = userEvent.setup();
    const deps = new FakeTaskManagerDeps();
    const { store } = renderWithProviders(
      <TaskManagerDepsContext.Provider value={deps}>
        <Desktop />
      </TaskManagerDepsContext.Provider>,
    );
    expect(TASK_MANAGER_REGISTRATION.open).toBe(openTaskManager);
    for (let round = 0; round < 2; round += 1) {
      await user.click(screen.getByRole("button", { name: /Start/ }));
      const menu = screen.getByRole("menu", { name: "Start menu" });
      await user.click(
        within(menu).getByRole("menuitem", { name: "Programs" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", { name: "Accessories" }),
      );
      await user.click(
        within(menu).getByRole("menuitem", { name: "Task Manager" }),
      );
    }
    expect(
      screen.getByRole("dialog", { name: "FuseOS Task Manager" }),
    ).toBeInTheDocument();
    expect(
      store.load().windows.filter((window) => window.kind === "taskmanager"),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole("table", { name: "Tasks" })).getByText(
        "FuseOS Task Manager",
      ),
    ).toBeInTheDocument();
  });

  it("opens with Ctrl+Shift+Esc and leaves Ctrl+Esc to the Start menu", async () => {
    const user = userEvent.setup();
    const deps = new FakeTaskManagerDeps();
    renderWithProviders(
      <TaskManagerDepsContext.Provider value={deps}>
        <Desktop />
      </TaskManagerDepsContext.Provider>,
    );
    await user.keyboard("{Control>}{Escape}{/Control}");
    expect(
      screen.queryByRole("dialog", { name: "FuseOS Task Manager" }),
    ).toBeNull();
    await user.keyboard("{Escape}");
    await user.keyboard("{Control>}{Shift>}{Escape}{/Shift}{/Control}");
    expect(
      screen.getByRole("dialog", { name: "FuseOS Task Manager" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Start menu" })).toBeNull();
  });
});
