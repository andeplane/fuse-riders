import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import { BSOD_HEADLINE } from "./BlueScreen";
import { SYSTEM32_FOLDER, useSystem32Folder } from "./explorerContract";
import { System32DepsContext, MemoryScheduler } from "./system32Deps";
import type { System32Deps } from "./system32Deps";
import {
  BSOD_MS,
  CONFIRMATIONS,
  CRASH_AFTER_LAST_STAGE_MS,
  FOLD_STAGES,
  RESTART_MS,
} from "./system32Machine";
import {
  idleSystem32Handle,
  System32Provider,
  useSystem32,
  useSystem32Title,
} from "./System32Provider";

/** What an Explorer would render: the folder while present, and its Delete. */
function FakeExplorer() {
  const folder = useSystem32Folder();
  const { state } = useSystem32();
  return (
    <div>
      <span data-testid="phase">{state.phase}</span>
      {folder.present ? (
        <div role="listitem" aria-label={folder.entry.name}>
          {folder.entry.parentPath}\{folder.entry.name}
          <button type="button" onClick={folder.remove}>
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Probe({ title }: { title: string }) {
  return <span data-testid="title">{useSystem32Title(title)}</span>;
}

function root(): HTMLElement {
  const element = document.querySelector(".s32-root");
  if (!(element instanceof HTMLElement)) throw new Error("no s32 root");
  return element;
}

function renderGag(deps: Partial<System32Deps> = {}) {
  const scheduler = new MemoryScheduler();
  const utils = renderWithProviders(
    <>
      <Desktop />
      <FakeExplorer />
      <Probe title="Control Panel" />
    </>,
    { system32Deps: { scheduler, ...deps } },
  );
  const advance = (ms: number) => act(() => scheduler.advance(ms));
  // One stage per step: the next timer is armed by an effect after each state change, not inside the callback.
  const foldAllStages = () => {
    for (const stage of FOLD_STAGES) advance(stage.delayMs);
  };
  return { ...utils, scheduler, advance, foldAllStages };
}

async function sayYesThreeTimes() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  for (const question of CONFIRMATIONS) {
    const dialog = screen.getByRole("alertdialog", { name: question.title });
    expect(dialog).toHaveTextContent(question.message);
    await user.click(screen.getByRole("button", { name: "Yes" }));
  }
}

describe(System32Provider.name, () => {
  it("lists the fake folder and does nothing until Explorer removes it", () => {
    renderGag();
    expect(SYSTEM32_FOLDER.name).toBe("SYSTEM32");
    expect(
      screen.getByRole("listitem", { name: "SYSTEM32" }),
    ).toHaveTextContent("C:\\WINDOWS\\SYSTEM32");
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(root().className).toBe("s32-root");
    expect(root()).toHaveAttribute("data-system32", "idle");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks the three questions in order; No or Escape on any of them keeps the folder", async () => {
    const user = userEvent.setup();
    renderGag();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Are you sure you want to remove the folder 'SYSTEM32'",
    );
    await user.click(screen.getByRole("button", { name: "No" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "SYSTEM32" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "FuseOS really likes this folder. Really?",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "OK, you asked for it.",
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(root().className).toBe("s32-root");
  });

  it("folds stage by stage on the scheduler, misspells titles, crashes, restarts and restores everything", async () => {
    const { advance, scheduler } = renderGag();
    await sayYesThreeTimes();

    expect(
      screen.queryByRole("listitem", { name: "SYSTEM32" }),
    ).not.toBeInTheDocument();
    expect(root()).toHaveClass("s32-folding");
    expect(screen.getByTestId("title")).toHaveTextContent("Control Panel");
    expect(screen.queryByTestId("s32-caption")).not.toBeInTheDocument();

    const titlesIndex = FOLD_STAGES.findIndex((stage) => stage.id === "titles");
    FOLD_STAGES.forEach((stage, index) => {
      advance(stage.delayMs - 1);
      expect(root()).not.toHaveClass(stage.className);
      advance(1);
      expect(root()).toHaveClass(stage.className);
      expect(screen.getByTestId("s32-caption")).toHaveTextContent(
        stage.caption,
      );
      expect(screen.getByTestId("title")).toHaveTextContent(
        index >= titlesIndex ? "Cntorl Panle" : "Control Panel",
      );
    });
    // The Control Panel window the desktop could open would show the same misspelling through WindowChrome.
    expect(root().className.split(" ")).toEqual([
      "s32-root",
      "s32-folding",
      ...FOLD_STAGES.map((stage) => stage.className),
    ]);

    advance(CRASH_AFTER_LAST_STAGE_MS);
    expect(root()).toHaveClass("s32-crashed");
    expect(root()).not.toHaveClass("s32-folding");
    const bsod = screen.getByRole("alert", { name: "FuseOS has crashed" });
    expect(bsod).toHaveTextContent(BSOD_HEADLINE);
    expect(bsod).toHaveFocus();
    expect(screen.getByTestId("title")).toHaveTextContent("Control Panel");

    // Any key restarts without waiting out the blue screen.
    await userEvent.keyboard("x");
    expect(
      screen.getByRole("status", { name: "FuseOS is restarting" }),
    ).toBeInTheDocument();
    expect(root()).toHaveClass("s32-restarting");

    advance(RESTART_MS);
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(root().className).toBe("s32-root");
    expect(
      screen.getByRole("listitem", { name: "SYSTEM32" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("s32-caption")).not.toBeInTheDocument();
    expect(scheduler.pending).toBe(0);
  });

  it("restarts by itself when nobody presses a key on the blue screen, and on a click", async () => {
    const { advance, foldAllStages } = renderGag();
    await sayYesThreeTimes();
    foldAllStages();
    advance(CRASH_AFTER_LAST_STAGE_MS);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    advance(BSOD_MS);
    expect(root()).toHaveClass("s32-restarting");
    advance(RESTART_MS);
    expect(root().className).toBe("s32-root");

    await sayYesThreeTimes();
    foldAllStages();
    advance(CRASH_AFTER_LAST_STAGE_MS);
    await userEvent.click(screen.getByRole("alert"));
    expect(root()).toHaveClass("s32-restarting");
  });

  it("drops its timer when unmounted mid-fold", async () => {
    const { advance, scheduler, unmount } = renderGag();
    await sayYesThreeTimes();
    advance(1_000);
    expect(scheduler.pending).toBe(1);
    unmount();
    expect(scheduler.pending).toBe(0);
  });

  it("hands the blue screen to the host when one is injected, and restarts once it resolves", async () => {
    let finish: () => void = () => undefined;
    const showBsod = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { advance, scheduler, foldAllStages } = renderGag({ showBsod });
    await sayYesThreeTimes();
    foldAllStages();
    advance(CRASH_AFTER_LAST_STAGE_MS);
    expect(showBsod).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(root()).toHaveClass("s32-crashed");
    expect(scheduler.pending).toBe(0);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(root()).toHaveClass("s32-restarting");
  });

  it("restarts after the usual hold when the host's blue screen does not say when it is done, or fails", async () => {
    const showBsod = vi.fn(() => undefined);
    const { advance, foldAllStages } = renderGag({ showBsod });
    await sayYesThreeTimes();
    foldAllStages();
    advance(CRASH_AFTER_LAST_STAGE_MS);
    expect(showBsod).toHaveBeenCalledTimes(1);
    advance(BSOD_MS - 1);
    expect(root()).toHaveClass("s32-crashed");
    advance(1);
    expect(root()).toHaveClass("s32-restarting");
  });

  it("restarts when the host's blue screen rejects, and ignores a resolution after unmount", async () => {
    let fail: (reason: Error) => void = () => undefined;
    const showBsod = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const { advance, unmount, foldAllStages } = renderGag({ showBsod });
    await sayYesThreeTimes();
    foldAllStages();
    advance(CRASH_AFTER_LAST_STAGE_MS);
    await act(async () => {
      fail(new Error("no blue screen today"));
      await Promise.resolve();
    });
    expect(root()).toHaveClass("s32-restarting");
    unmount();
  });

  it("starts at the first question for ?fold=now", () => {
    renderGag({ demo: { kind: "now" } });
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      CONFIRMATIONS[0]?.message ?? "",
    );
  });

  it("lands on a stage for ?fold=stage:N and holds it there for a screenshot", () => {
    const { advance, scheduler } = renderGag({
      demo: { kind: "stage", stage: 4 },
    });
    expect(root().className.split(" ")).toEqual([
      "s32-root",
      "s32-folding",
      ...FOLD_STAGES.slice(0, 4).map((stage) => stage.className),
    ]);
    expect(screen.getByTestId("s32-caption")).toHaveTextContent(
      FOLD_STAGES[3]?.caption ?? "",
    );
    expect(scheduler.pending).toBe(0);
    advance(600_000);
    expect(root()).not.toHaveClass("s32-titles");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("holds the last stage for ?fold=stage:99 too", () => {
    const { advance } = renderGag({ demo: { kind: "stage", stage: 99 } });
    expect(root()).toHaveClass(
      FOLD_STAGES[FOLD_STAGES.length - 1]?.className ?? "",
    );
    advance(600_000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes straight to the blue screen for ?fold=bsod, then restarts and is healthy", () => {
    const { advance } = renderGag({ demo: { kind: "bsod" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    advance(BSOD_MS);
    advance(RESTART_MS);
    expect(root().className).toBe("s32-root");
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
  });

  it("is inert outside a provider: the plain title, a folder that stays, no-op callbacks", () => {
    render(
      <System32DepsContext.Provider
        value={{ scheduler: new MemoryScheduler() }}
      >
        <FakeExplorer />
        <Probe title="Paint" />
      </System32DepsContext.Provider>,
    );
    expect(screen.getByTestId("title")).toHaveTextContent("Paint");
    expect(screen.getByTestId("phase")).toHaveTextContent("idle");
    expect(idleSystem32Handle.folderGone).toBe(false);
    expect(() => {
      idleSystem32Handle.removeSystem32();
      idleSystem32Handle.confirm();
      idleSystem32Handle.cancel();
      idleSystem32Handle.restart();
    }).not.toThrow();
  });
});
