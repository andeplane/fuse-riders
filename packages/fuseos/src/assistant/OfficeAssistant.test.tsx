import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createTestAssistantDeps,
  fakeMessage,
} from "../__mocks__/assistantDeps";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import {
  DEFAULT_ASSISTANT_OPTIONS,
  MemoryAssistantOptionsStore,
} from "./assistantOptionsStore";
import { ASSISTANT_TIPS, GREETING } from "./assistantState";
import { NO_CHAT_REASON } from "./useOfficeAssistantViewModel";

function clippy() {
  return screen.getByRole("button", { name: "Clippy" });
}

function sprite() {
  return screen.getByRole("img", { name: "Clippy, the Office Assistant" });
}

function balloon() {
  return screen.getByRole("region", { name: "Clippy balloon" });
}

/** A visit after the greeting was answered. */
function greetedStore() {
  return new MemoryAssistantOptionsStore({
    ...DEFAULT_ASSISTANT_OPTIONS,
    greeted: true,
  });
}

async function openStartMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Start/ }));
  return screen.getByRole("menu", { name: "Start menu" });
}

describe("OfficeAssistant", () => {
  it("greets on the first visit, plays Greeting and remembers the answer", async () => {
    const user = userEvent.setup();
    const { assistantOptions } = renderWithProviders(<Desktop />);
    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toBeInTheDocument();
    expect(balloon()).toHaveTextContent(GREETING);
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Greeting"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(
      within(balloon()).getByRole("button", { name: "No thanks" }),
    );
    expect(screen.queryByRole("region", { name: "Clippy balloon" })).toBeNull();
    expect(assistantOptions.get().greeted).toBe(true);
    // Clicking the character opens the balloon again, now without the greeting.
    await user.click(clippy());
    expect(balloon()).not.toHaveTextContent(GREETING);
    expect(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    ).toBeEnabled();
  });

  it("carries the first tip in the greeting and offers no Try this for tips without a question", () => {
    renderWithProviders(<Desktop />);
    expect(balloon()).toHaveTextContent(ASSISTANT_TIPS[0] ?? "");
    expect(
      within(balloon()).queryByRole("button", { name: "Try this" }),
    ).toBeNull();
  });

  it("shows tips on request and cycles through them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    // The greeting already shows the first tip; asking for one moves on to the second.
    expect(balloon()).toHaveTextContent(ASSISTANT_TIPS[0] ?? "");
    await user.click(
      within(balloon()).getByRole("button", { name: "Show me a tip" }),
    );
    expect(within(balloon()).getByRole("status")).toHaveTextContent(
      ASSISTANT_TIPS[1] ?? "",
    );
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "GetAttention"),
    );
    await user.click(
      within(balloon()).getByRole("button", { name: "Next tip" }),
    );
    expect(within(balloon()).getByRole("status")).toHaveTextContent(
      ASSISTANT_TIPS[2] ?? "",
    );
    await user.click(
      within(balloon()).getByRole("button", { name: "Close tip" }),
    );
    expect(within(balloon()).queryByRole("status")).toBeNull();
  });

  it("chats with Clippy through the injected hook, telling it about the desktop", async () => {
    const user = userEvent.setup();
    const { assistantDeps } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
    });
    await user.click(clippy());
    assistantDeps.chat.reply = async () => ({
      text: "Fuseball is on your desktop.",
    });
    await user.type(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
      "where is Fuseball{Enter}",
    );
    expect(assistantDeps.chat.sent).toEqual(["where is Fuseball"]);
    const appContext = assistantDeps.chat.lastOptions?.getAppContext();
    expect(appContext).toContain("FuseOS desktop");
    expect(appContext).toContain(
      "Games installed: Fuseball, Fuse Riders, Fuse Birds",
    );
    expect(appContext).toContain("Windows open: none");
    const log = await within(balloon()).findByRole("log", {
      name: "Conversation",
    });
    expect(log).toHaveTextContent("You: where is Fuseball");
    expect(log).toHaveTextContent("Fuseball is on your desktop.");
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Explain"),
    );
    await user.click(
      within(balloon()).getByRole("button", { name: "New chat" }),
    );
    expect(assistantDeps.chat.reset).toHaveBeenCalled();
  });

  it("tells the chat which windows are open and which games are installed", () => {
    const initialState: AppState = {
      ...DEFAULT_STATE,
      windows: [
        { id: "w1", minimized: false, maximized: false, kind: "paint" },
      ],
    };
    const { assistantDeps } = renderWithProviders(<Desktop />, {
      initialState,
      games: [],
    });
    const appContext = assistantDeps.chat.lastOptions?.getAppContext();
    expect(appContext).toContain("Games installed: none");
    expect(appContext).toContain("Windows open: paint");
  });

  it("shows the chat progress while Clippy works and locks the input until the answer arrives", async () => {
    const user = userEvent.setup();
    const { assistantDeps } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
    });
    await user.click(clippy());
    let finish: () => void = () => undefined;
    assistantDeps.chat.reply = () =>
      new Promise((resolve) => {
        finish = () => resolve({ text: "Done" });
      });
    await user.type(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
      "search{Enter}",
    );
    const log = within(balloon()).getByRole("log", { name: "Conversation" });
    expect(log).toHaveTextContent("Agent thinking...");
    expect(
      within(balloon()).getByRole("button", { name: "Stop" }),
    ).toBeInTheDocument();
    expect(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    ).toBeDisabled();
    await user.click(within(balloon()).getByRole("button", { name: "Stop" }));
    expect(assistantDeps.chat.abort).toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() =>
      expect(
        within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
      ).toBeEnabled(),
    );
    expect(log).toHaveTextContent("Done");
  });

  it("shows a chat error and an alert animation when the answer fails", async () => {
    const user = userEvent.setup();
    const { assistantDeps } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
    });
    await user.click(clippy());
    act(() => assistantDeps.chat.setStreaming(true));
    act(() => {
      assistantDeps.chat.setError("The model fell over");
      assistantDeps.chat.setStreaming(false);
    });
    expect(balloon()).toHaveTextContent("The model fell over");
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Alert"),
    );
  });

  it("turns the narration option off from Options in the right click menu", async () => {
    const user = userEvent.setup();
    const { assistantOptions } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
    });
    expect(assistantOptions.get().narrate).toBe(true);
    await user.pointer({ keys: "[MouseRight]", target: clippy() });
    await user.click(
      within(
        screen.getByRole("menu", { name: "Office Assistant menu" }),
      ).getByRole("menuitem", { name: "Options..." }),
    );
    const panel = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.click(
      within(panel).getByLabelText("Narrate what the assistant does"),
    );
    expect(assistantOptions.get().narrate).toBe(false);
  });

  it("hides from the right click menu after GoodBye, remembers it, and Start > Help brings it back", async () => {
    const user = userEvent.setup();
    const { store, assistantDeps } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
    });
    await user.pointer({ keys: "[MouseRight]", target: clippy() });
    await user.click(
      within(
        screen.getByRole("menu", { name: "Office Assistant menu" }),
      ).getByRole("menuitem", { name: "Hide" }),
    );
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "GoodBye"),
    );
    act(() => assistantDeps.flushTimers());
    expect(
      screen.queryByRole("complementary", { name: "Office Assistant" }),
    ).toBeNull();
    await waitFor(() => expect(store.load().assistantHidden).toBe(true));

    const menu = await openStartMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Help" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Office Assistant" }),
    );
    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Greeting"),
    );
    await waitFor(() => expect(store.load().assistantHidden).toBeFalsy());
  });

  it("stays hidden when the stored state says so and hides at once when animations are off", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      initialState: { ...DEFAULT_STATE, assistantHidden: true },
      assistantOptions: new MemoryAssistantOptionsStore({
        ...DEFAULT_ASSISTANT_OPTIONS,
        greeted: true,
        animate: false,
      }),
    });
    expect(
      screen.queryByRole("complementary", { name: "Office Assistant" }),
    ).toBeNull();
    const menu = await openStartMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Help" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Office Assistant" }),
    );
    expect(sprite()).toHaveAttribute("data-animation", "RestPose");
    await user.pointer({ keys: "[MouseRight]", target: clippy() });
    await user.click(
      within(
        screen.getByRole("menu", { name: "Office Assistant menu" }),
      ).getByRole("menuitem", { name: "Hide" }),
    );
    expect(
      screen.queryByRole("complementary", { name: "Office Assistant" }),
    ).toBeNull();
  });

  it("explains that it cannot answer questions yet when no chat is wired in", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, {
      assistantDeps: createTestAssistantDeps({ chatAvailable: false }),
      assistantOptions: greetedStore(),
    });
    await user.click(clippy());
    expect(balloon()).toHaveTextContent(NO_CHAT_REASON);
    expect(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    ).toBeDisabled();
  });

  it('answers "Yes, help me" with the unavailable reason when no chat is wired in', async () => {
    const user = userEvent.setup();
    const { assistantOptions } = renderWithProviders(<Desktop />, {
      assistantDeps: createTestAssistantDeps({ chatAvailable: false }),
    });
    await user.click(
      within(balloon()).getByRole("button", { name: "Yes, help me" }),
    );
    expect(assistantOptions.get().greeted).toBe(true);
    expect(within(balloon()).getByRole("status")).toHaveTextContent(
      NO_CHAT_REASON,
    );
  });

  it("waves when hovered and sits above the windows but below a dialog", async () => {
    const user = userEvent.setup();
    const { assistantDeps } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
      assistantDeps: createTestAssistantDeps(),
      initialState: {
        ...DEFAULT_STATE,
        windows: [
          {
            id: "w1",
            minimized: false,
            maximized: false,
            kind: "dialog",
            title: "Oops",
            message: "x",
            icon: "warning",
          },
        ],
      },
    });
    await user.hover(clippy());
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Wave"),
    );
    expect(
      screen.getByRole("complementary", { name: "Office Assistant" }),
    ).toHaveStyle({ zIndex: 9 });
    // Frames advance on the injected clock.
    expect(sprite()).toHaveAttribute("data-frame", "0");
    act(() => assistantDeps.flushTimers());
    expect(sprite()).toHaveAttribute("data-frame", "1");
  });

  it("shows a scripted conversation from the fake chat", async () => {
    const user = userEvent.setup();
    const { assistantDeps } = renderWithProviders(<Desktop />, {
      assistantOptions: greetedStore(),
    });
    await user.click(clippy());
    act(() =>
      assistantDeps.chat.setMessages([
        fakeMessage("user", "Which games are there?"),
        fakeMessage("assistant", "Three of them."),
      ]),
    );
    const log = within(balloon()).getByRole("log", { name: "Conversation" });
    expect(log).toHaveTextContent("You: Which games are there?");
    expect(log).toHaveTextContent("Three of them.");
  });
});
