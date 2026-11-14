import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestAssistantDeps } from "../__mocks__/assistantDeps";
import {
  renderWithProviders,
  TEST_SYSTEM_PROBE,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { CANCELLED_REPLY, CONFUSED_REPLY } from "../llm/agentLoop";
import { DEFAULT_MODEL_ID } from "../llm/modelCatalog";

import {
  DEFAULT_ASSISTANT_OPTIONS,
  MemoryAssistantOptionsStore,
} from "./assistantOptionsStore";
import { useClippyChat } from "./clippyChat";

const PRO = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

function balloon() {
  return screen.getByRole("region", { name: "Clippy balloon" });
}

function log() {
  return within(balloon()).getByRole("log", { name: "Conversation" });
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(
    within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    `${text}{Enter}`,
  );
}

function call(tool: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ tool, args });
}

/** The desktop with the real Clippy chat over the fake engine factory, the balloon open. */
async function renderClippy(
  options: { hasWebGpu?: boolean; model?: string } = {},
) {
  const user = userEvent.setup();
  const context = renderWithProviders(<Desktop />, {
    assistantDeps: createTestAssistantDeps({ useChat: useClippyChat }),
    assistantOptions: new MemoryAssistantOptionsStore({
      ...DEFAULT_ASSISTANT_OPTIONS,
      greeted: true,
      model: options.model ?? PRO,
    }),
    systemProbe: { ...TEST_SYSTEM_PROBE, hasWebGpu: options.hasWebGpu ?? true },
  });
  await user.click(screen.getByRole("button", { name: "Clippy" }));
  return { user, ...context };
}

function windows(context: Awaited<ReturnType<typeof renderClippy>>) {
  return context.store.load().windows;
}

describe("Clippy as an agent, on the desktop", () => {
  it("works through a request step by step with Clippy Pro and logs each step in the balloon", async () => {
    const context = await renderClippy();
    context.llmFactory.script = [
      call("open_app", { id: "paint" }),
      call("maximize_window", { window: "Paint" }),
      call("set_display", { color_mode: "256-colors" }),
      call("answer", { text: "Paint is open, maximized and in 256 colors!" }),
    ];
    await ask(context.user, "open paint, maximize it and switch to 256 colors");

    await waitFor(() =>
      expect(log()).toHaveTextContent(
        "Paint is open, maximized and in 256 colors!",
      ),
    );
    // The window the first step opened is the one the second maximized.
    expect(windows(context)).toMatchObject([
      { kind: "paint", maximized: true },
    ]);
    expect(context.displayPrefsStore.get().colorMode).toBe("256-colors");
    const steps = within(log())
      .getAllByRole("listitem")
      .filter((item) => item.dataset.phase !== undefined)
      .map((item) => `${item.dataset.phase}: ${item.textContent}`);
    expect(steps).toEqual([
      "finished: Opened Paint",
      "finished: Maximized untitled - Paint",
      "finished: Display set: colours 256-colors",
    ]);
    // One model load, four replies, each held to the tools' schema; the agent prompt, not the marker one.
    expect(context.llmFactory.loads.map((load) => load.modelId)).toEqual([PRO]);
    const completions = context.llmFactory.engines[0]?.completions ?? [];
    expect(completions).toHaveLength(4);
    expect(completions[0]?.jsonSchema).toContain('"const":"set_wallpaper"');
    expect(completions[0]?.messages[0]?.content).toContain(
      "- maximize_window(window)",
    );
    expect(completions[0]?.messages[0]?.content).toContain(
      "Current desktop: FuseOS desktop.",
    );
    expect(completions[3]?.messages.at(-1)?.content).toMatch(
      /^Result of set_display: Done: Display set: colours 256-colors/,
    );
  });

  it("shows the model coming in as a panel in the chat: what, how large, how far", async () => {
    const context = await renderClippy();
    let ready: () => void = () => undefined;
    context.llmFactory.loadGate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    context.llmFactory.script = [call("answer", { text: "Hello!" })];
    await ask(context.user, "hi");
    await waitFor(() => expect(context.llmFactory.loads).toHaveLength(1));
    const report = context.llmFactory.loads[0]?.onProgress;
    const panel = () =>
      within(balloon()).getByRole("status", { name: "Model download" });
    const bar = () =>
      within(panel()).getByRole("progressbar", {
        name: "Model download progress",
      });

    act(() => report?.({ progress: 0.42, text: "Fetching param cache[3/10]" }));
    await waitFor(() =>
      expect(panel()).toHaveTextContent("Downloading the model 42%..."),
    );
    expect(panel()).toHaveTextContent(
      "Clippy Pro (Qwen 2.5 1.5B), about 880 MB. It downloads once and then stays in this browser.",
    );
    expect(bar()).toHaveAttribute("aria-valuenow", "42");
    expect(bar().firstElementChild).toHaveStyle({ width: "42%" });

    act(() =>
      report?.({ progress: 0.8, text: "Loading model from cache[8/10]" }),
    );
    await waitFor(() => expect(bar()).toHaveAttribute("aria-valuenow", "80"));
    expect(panel()).toHaveTextContent(
      "Already downloaded: loading it from this browser.",
    );
    act(() => report?.({ progress: 0.1, text: "Start to fetch params" }));
    await waitFor(() =>
      expect(panel()).toHaveTextContent("Getting the model ready."),
    );
    act(() => report?.({ progress: 1, text: "Finish loading on WebGPU" }));
    await waitFor(() => expect(panel()).toHaveTextContent("Almost there."));
    expect(bar()).toHaveAttribute("aria-valuenow", "100");

    act(() => ready());
    await waitFor(() => expect(log()).toHaveTextContent("Hello!"));
    expect(
      within(balloon()).queryByRole("status", { name: "Model download" }),
    ).toBeNull();
  });

  it("does not let the model report a part of the request it never did", async () => {
    const context = await renderClippy();
    context.llmFactory.script = [
      call("open_app", { id: "paint" }),
      // What a small model does: one step, then a report of everything asked for.
      call("answer", { text: "Paint is open and maximized, in 256 colors." }),
      call("maximize_window", { window: "Paint" }),
      call("answer", { text: "Paint is open and maximized, in 256 colors." }),
      call("set_display", { color_mode: "256-colors" }),
      call("answer", { text: "All three done!" }),
    ];
    await ask(context.user, "open paint, maximize it and switch to 256 colors");
    await waitFor(() => expect(log()).toHaveTextContent("All three done!"));
    expect(windows(context)).toMatchObject([
      { kind: "paint", maximized: true },
    ]);
    expect(context.displayPrefsStore.get().colorMode).toBe("256-colors");
    const completions = context.llmFactory.engines[0]?.completions ?? [];
    expect(completions[2]?.messages.at(-1)?.content).toBe(
      'Not finished: you have not done "maximize it" yet. Call maximize_window for it now; answer comes after.',
    );
    expect(completions[4]?.messages.at(-1)?.content).toMatch(
      /you have not done "switch to 256 colors" yet\. Call set_display/,
    );
  });

  it("reads and edits a file on the C: drive, and undoes the edit on the next request", async () => {
    const context = await renderClippy();
    context.llmFactory.script = [
      call("read_file", { path: "C:/docs/notes.txt" }),
      call("edit_file", {
        path: "docs/notes.txt",
        content: "Clippy was here",
        mode: "append",
      }),
      call("answer", { text: "Added the line." }),
      call("undo_edit"),
      call("answer", { text: "Put it back." }),
    ];
    await ask(context.user, "add a line to the notes");
    await waitFor(() => expect(log()).toHaveTextContent("Added the line."));
    expect(await context.diskDeps.overlay.read("docs/notes.txt")).toBe(
      "plain notes\nClippy was here",
    );
    expect(windows(context)).toMatchObject([
      { kind: "notepadpp", activePath: "docs/notes.txt" },
    ]);
    const second = context.llmFactory.engines[0]?.completions[1];
    expect(second?.messages.at(-1)?.content).toContain(
      "notes.txt reads:\nplain notes",
    );

    await ask(context.user, "undo that");
    await waitFor(() => expect(log()).toHaveTextContent("Put it back."));
    expect(
      await context.diskDeps.overlay.read("docs/notes.txt"),
    ).toBeUndefined();
  });

  it("stops mid-request on Cancel and says what was done", async () => {
    const context = await renderClippy();
    let release: () => void = () => undefined;
    context.llmFactory.script = [call("open_app", { id: "paint" })];
    await ask(context.user, "open paint and then everything else");
    await waitFor(() => expect(log()).toHaveTextContent("Opened Paint"));
    // The second reply never comes: the gate holds it until the abort.
    context.llmFactory.completionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    context.llmFactory.script = [call("open_app", { id: "winamp" })];
    await ask(context.user, "now open winamp");
    await waitFor(() =>
      expect(
        within(balloon()).getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument(),
    );
    await context.user.click(
      within(balloon()).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(log()).toHaveTextContent(CANCELLED_REPLY));
    release();
    expect(windows(context).map((window) => window.kind)).toEqual(["paint"]);
    expect(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    ).toBeEnabled();
  });

  it("recovers from one malformed reply, and gives up gracefully after two", async () => {
    const context = await renderClippy();
    context.llmFactory.script = [
      '{"tool":"open_app","args":',
      call("open_app", { id: "paint" }),
      call("answer", { text: "Paint is open." }),
    ];
    await ask(context.user, "open paint");
    await waitFor(() => expect(log()).toHaveTextContent("Paint is open."));
    expect(windows(context).map((window) => window.kind)).toEqual(["paint"]);

    context.llmFactory.script = ["{{", "}}{"];
    await ask(context.user, "now something odd");
    await waitFor(() => expect(log()).toHaveTextContent(CONFUSED_REPLY));
    expect(within(balloon()).queryByText(/could not answer/)).toBeNull();
  });

  it("falls back to the rules, several requests in one sentence included, when the model cannot load", async () => {
    const context = await renderClippy();
    context.llmFactory.failLoad = new Error("Cannot find WebGPU adapter");
    await ask(context.user, "open paint and maximize it");
    await waitFor(() =>
      expect(windows(context)).toMatchObject([
        { kind: "paint", maximized: true },
      ]),
    );
    expect(log()).toHaveTextContent("Opening Paint! Maximizing Paint.");
    expect(
      within(balloon()).getByTestId("chat-backend-notice"),
    ).toHaveTextContent("could not start");
  });

  it("keeps the small default model on single-reply markers", async () => {
    const context = await renderClippy({ model: DEFAULT_MODEL_ID });
    context.llmFactory.reply = () => ["Here you go! [open:paint]"];
    await ask(context.user, "open paint");
    await waitFor(() =>
      expect(windows(context).map((window) => window.kind)).toEqual(["paint"]),
    );
    expect(context.llmFactory.engines[0]?.completions).toEqual([]);
    expect(context.llmFactory.engines[0]?.requests).toHaveLength(1);
    // The marker prompt lists two tools, not the agent's nineteen.
    const system = context.llmFactory.engines[0]?.requests[0]?.[0]?.content;
    expect(system).toContain("[open:<id>]");
    expect(system).toContain("[music:<play|pause|stop|next|previous>]");
    expect(system).not.toContain("set_display");
  });

  it("follows several commands in one sentence without WebGPU: games, music, display and windows", async () => {
    const context = await renderClippy({ hasWebGpu: false });
    await ask(context.user, "open fuseball and play music");
    await waitFor(() =>
      expect(windows(context).map((window) => window.kind)).toEqual([
        "fusegame",
        "winamp",
      ]),
    );
    expect(log()).toHaveTextContent(
      "Opening Fuseball! Winamp coming right up!",
    );
    expect(context.llmFactory.loads).toEqual([]);

    await ask(
      context.user,
      "minimize fuseball, switch to 256 colors and make the desktop red",
    );
    await waitFor(() =>
      expect(context.displayPrefsStore.get()).toMatchObject({
        colorMode: "256-colors",
        backgroundColor: "#ff0000",
      }),
    );
    expect(
      windows(context).find((window) => window.kind === "fusegame"),
    ).toMatchObject({ minimized: true });

    await ask(context.user, "close winamp and what is open?");
    await waitFor(() => expect(log()).toHaveTextContent("Open: Fuseball"));
    expect(windows(context).map((window) => window.kind)).toEqual(["fusegame"]);
    await act(async () => undefined);
  });
});
