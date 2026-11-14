import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createFriendsTimers,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";

import { createDemoPresenceService, DEMO_BUDDIES } from "./demoPresenceService";
import { toastText, TOAST_MS } from "./FriendsTray";
import type { PresenceEvent } from "./presenceEvents";

const BEAT_MS = TOAST_MS + 1_000;

function renderTray() {
  const timers = createFriendsTimers();
  // The script's beat is longer than a toast's life, so a test can let a toast expire without a new step.
  const presence = createDemoPresenceService({
    schedule: timers.schedule,
    beatMs: BEAT_MS,
  });
  const result = renderWithProviders(<Desktop />, {
    presence,
    friendsDeps: { schedule: timers.schedule },
  });
  return { ...result, presence, timers, user: userEvent.setup() };
}

const notifications = () =>
  screen.queryByRole("region", { name: "Fuse Messenger notifications" });

describe("FriendsTray", () => {
  it("shows the online count and opens Fuse Messenger on click", async () => {
    const { user } = renderTray();
    const tray = screen.getByTestId("friends-tray");
    expect(tray).toHaveAccessibleName("Fuse Messenger: 4 buddies online");
    expect(tray).toHaveTextContent("4");
    await user.click(tray);
    expect(
      await screen.findByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
    await user.click(tray);
    expect(
      screen.getAllByRole("dialog", { name: "Fuse Messenger" }),
    ).toHaveLength(1);
  });

  it("toasts a buddy signing in and starting a game, with the uh-oh, and lets you join from the toast", async () => {
    const { user, timers, friendsDeps } = renderTray();
    expect(notifications()).not.toBeInTheDocument();
    timers.fire(BEAT_MS);
    const region = await screen.findByRole("region", {
      name: "Fuse Messenger notifications",
    });
    expect(
      within(region).getByTestId("friends-toast-signed-in"),
    ).toHaveTextContent("xXx_RocketMan_xXx has just signed in.");
    expect(friendsDeps.playAlert).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("friends-tray")).toHaveAccessibleName(
      "Fuse Messenger: 5 buddies online",
    );

    timers.fire(BEAT_MS);
    const playing = await within(region).findByTestId("friends-toast-playing");
    expect(playing).toHaveTextContent(
      "xXx_RocketMan_xXx is playing fuse-volley.",
    );
    expect(friendsDeps.playAlert).toHaveBeenCalledTimes(2);
    await user.click(within(playing).getByRole("button", { name: "Join" }));
    // fuse-volley is not among the fixture games: the join explains rather than opening a window.
    expect(
      await screen.findByText(/"fuse-volley" is not installed/),
    ).toBeInTheDocument();
    expect(
      within(region).queryByTestId("friends-toast-playing"),
    ).not.toBeInTheDocument();
  });

  it("drops the oldest toast after its time, dismisses on the cross and opens the window from the text", async () => {
    const { user, timers } = renderTray();
    timers.fire(BEAT_MS);
    const region = await screen.findByRole("region", {
      name: "Fuse Messenger notifications",
    });
    expect(timers.pending()).toBe(2); // the next demo beat and the toast's timer
    timers.fire(TOAST_MS);
    await waitFor(() => expect(notifications()).not.toBeInTheDocument());

    timers.fire(BEAT_MS);
    timers.fire(BEAT_MS);
    const invite = await screen.findByTestId("friends-toast-invite");
    expect(invite).toHaveTextContent(
      "xXx_RocketMan_xXx invited you to fuse-volley (room VB77).",
    );
    await user.click(
      within(invite).getByRole("button", { name: "Dismiss notification" }),
    );
    expect(
      screen.queryByTestId("friends-toast-invite"),
    ).not.toBeInTheDocument();

    timers.fire(BEAT_MS);
    const request = await screen.findByTestId("friends-toast-request");
    expect(request).toHaveTextContent("PigChampion wants to be your friend.");
    await user.click(
      within(request).getByText("PigChampion wants to be your friend."),
    );
    expect(
      await screen.findByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("friends-toast-request"),
    ).not.toBeInTheDocument();
    expect(region).not.toBeInTheDocument();
  });

  it("pauses presence while a Fuse game window is open and resumes when it closes", async () => {
    const { user, presence } = renderTray();
    expect(presence.snapshot().suspended).toBe(false);
    await user.dblClick(screen.getByRole("button", { name: "Fuseball" }));
    const game = await screen.findByRole("dialog", { name: "Fuseball" });
    expect(presence.snapshot().suspended).toBe(true);
    await user.click(within(game).getByRole("button", { name: "Close" }));
    expect(presence.snapshot().suspended).toBe(false);
  });

  it("words every event with the game's desktop name", () => {
    const rocket = DEMO_BUDDIES[4]!;
    const name = (id: string) => (id === "fuseball" ? "Fuseball" : id);
    const events: PresenceEvent[] = [
      { type: "signed-in", buddy: rocket },
      {
        type: "playing",
        buddy: {
          ...rocket,
          status: "playing",
          room: { code: "AB42", gameId: "fuseball" },
        },
      },
      { type: "playing", buddy: { ...rocket, status: "playing" } },
      {
        type: "invite",
        invite: {
          id: "i",
          from: rocket,
          code: "AB42",
          gameId: "fuseball",
          at: 1,
        },
      },
      { type: "request", from: rocket },
    ];
    expect(events.map((e) => toastText(e, name))).toEqual([
      "xXx_RocketMan_xXx has just signed in.",
      "xXx_RocketMan_xXx is playing Fuseball.",
      "xXx_RocketMan_xXx is playing .",
      "xXx_RocketMan_xXx invited you to Fuseball (room AB42).",
      "xXx_RocketMan_xXx wants to be your friend.",
    ]);
  });
});
