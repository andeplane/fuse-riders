import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createManualTimers,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { FRIENDS_WINDOW_ID } from "../desktop/startMenuRegistry";
import type { AppState, WindowState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import {
  createDemoPresenceService,
  DEMO_BUDDIES,
  DEMO_ME,
} from "./demoPresenceService";
import type { PresenceService } from "./presenceService";
import { createNullPresenceService } from "./presenceService";
import { createSwitchablePresenceService } from "./switchablePresenceService";

const friendsWindow: WindowState = {
  id: FRIENDS_WINDOW_ID,
  minimized: false,
  maximized: false,
  kind: "friends",
};
const withWindows = (...windows: WindowState[]): AppState => ({
  ...DEFAULT_STATE,
  windows,
});

function renderFriends(
  options: {
    presence?: PresenceService;
    signedIn?: boolean;
    windows?: WindowState[];
  } = {},
) {
  const timers = createManualTimers();
  const presence =
    options.presence ??
    createDemoPresenceService({
      schedule: timers.schedule,
      signedIn: options.signedIn ?? true,
    });
  const result = renderWithProviders(<Desktop />, {
    initialState: withWindows(...(options.windows ?? [friendsWindow])),
    presence,
    friendsDeps: { schedule: timers.schedule },
  });
  return { ...result, presence, timers, user: userEvent.setup() };
}

const dialog = () => screen.findByRole("dialog", { name: "Fuse Messenger" });

describe("FriendsWindow", () => {
  it("shows the buddy list grouped by state with the player's own id, and joins a buddy's game", async () => {
    const { user } = renderFriends();
    const window = await dialog();
    expect(within(window).getByText(DEMO_ME.name)).toBeInTheDocument();
    expect(within(window).getByTestId("my-public-id")).toHaveTextContent(
      DEMO_ME.publicId,
    );
    expect(within(window).getByText("Playing (1)")).toBeInTheDocument();
    expect(within(window).getByText("Online (2)")).toBeInTheDocument();
    expect(within(window).getByText("Away (1)")).toBeInTheDocument();
    expect(within(window).getByText("Offline (2)")).toBeInTheDocument();
    expect(
      within(window).getByText("Playing Fuseball · room AB42"),
    ).toBeInTheDocument();
    expect(
      within(window).getByText("4 of 6 buddies online"),
    ).toBeInTheDocument();
    expect(within(window).getAllByRole("img", { name: "Online" })).toHaveLength(
      3, // two buddies and the player's own status
    );

    await user.click(within(window).getByRole("button", { name: "Join game" }));
    const game = await screen.findByRole("dialog", { name: "Fuseball" });
    expect(within(game).getByTitle("Fuseball")).toHaveAttribute(
      "src",
      "/fuse-riders/fuseball/?room=AB42",
    );
    // Joining the same room again brings that window forward rather than opening another.
    await user.click(within(window).getByRole("button", { name: "Join game" }));
    expect(screen.getAllByRole("dialog", { name: "Fuseball" })).toHaveLength(1);
  });

  it("offers sign-in when signed out and lists buddies once signed in", async () => {
    const { user, presence } = renderFriends({ signedIn: false });
    const window = await dialog();
    expect(within(window).getByText("Signed out")).toBeInTheDocument();
    expect(screen.getByTestId("friends-tray")).toHaveAccessibleName(
      "Fuse Messenger: signed out",
    );
    await user.click(
      within(window).getByRole("button", { name: "Sign in with Google" }),
    );
    expect(await within(window).findByText("Playing (1)")).toBeInTheDocument();
    expect(presence.snapshot().account.kind).toBe("signed-in");
    expect(screen.getByTestId("friends-tray")).toHaveAccessibleName(
      "Fuse Messenger: 4 buddies online",
    );

    await user.click(within(window).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(window).getByRole("menuitemcheckbox", { name: "Sign out" }),
    );
    expect(
      await within(window).findByRole("button", {
        name: "Sign in with Google",
      }),
    ).toBeInTheDocument();
  });

  it("validates a player id before adding, then shows the request waiting", async () => {
    const { user } = renderFriends();
    const window = await dialog();
    const input = within(window).getByLabelText("Add:");
    const add = within(window).getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.type(input, "not-an-id");
    await user.click(add);
    expect(within(window).getByRole("alert")).toHaveTextContent(
      "A player id is 20 letters and digits",
    );
    expect(input).toHaveValue("not-an-id");
    await user.clear(input);
    await user.type(input, " ABCDEFABCDEFABCDEF12 ");
    await user.keyboard("{Enter}");
    expect(
      await within(window).findByText("Player abcdef"),
    ).toBeInTheDocument();
    expect(within(window).queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
    await user.click(
      within(window).getByRole("button", {
        name: "Cancel request to Player abcdef",
      }),
    );
    expect(within(window).queryByText("Player abcdef")).not.toBeInTheDocument();
  });

  it("accepts or declines a request, and shows and dismisses an invite", async () => {
    const { user, timers } = renderFriends();
    const window = await dialog();
    for (let i = 0; i < 4; i++) timers.fire(5_000);
    expect(
      await within(window).findByText("wants to be your friend", {
        exact: false,
      }),
    ).toBeInTheDocument();
    await user.click(
      within(window).getByRole("button", { name: "Accept PigChampion" }),
    );
    expect(within(window).queryByText("Requests")).not.toBeInTheDocument();
    expect(within(window).getByText("Online (3)")).toBeInTheDocument();

    const invites = within(window).getByRole("list", { name: "Invites" });
    expect(invites).toHaveTextContent("invited you to fuse-volley (VB77)");
    await user.click(
      within(invites).getByRole("button", {
        name: "Dismiss invite from xXx_RocketMan_xXx",
      }),
    );
    expect(
      within(window).queryByRole("list", { name: "Invites" }),
    ).not.toBeInTheDocument();
  });

  it("explains when a friend's game is not installed on this desktop", async () => {
    const { user, timers } = renderFriends();
    const window = await dialog();
    timers.fire(5_000);
    timers.fire(5_000);
    timers.fire(5_000);
    const invites = await within(window).findByRole("list", {
      name: "Invites",
    });
    await user.click(within(invites).getByRole("button", { name: "Join" }));
    expect(
      await screen.findByRole("dialog", { name: "Join game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"fuse-volley" is not installed/),
    ).toBeInTheDocument();
  });

  it("removes a friend from the context menu and joins from it", async () => {
    const { user } = renderFriends();
    const window = await dialog();
    const slayer = within(window).getByTestId(
      `buddy-${DEMO_BUDDIES[0]!.publicId}`,
    );
    await user.pointer({ keys: "[MouseRight]", target: slayer });
    const menu = await screen.findByRole("menu", {
      name: "DoomSlayer_1993 menu",
    });
    await user.click(within(menu).getByText("Join game"));
    expect(
      await screen.findByRole("dialog", { name: "Fuseball" }),
    ).toBeInTheDocument();

    const offline = within(window).getByTestId(
      `buddy-${DEMO_BUDDIES[5]!.publicId}`,
    );
    await user.pointer({ keys: "[MouseRight]", target: offline });
    const menu2 = await screen.findByRole("menu", {
      name: "LAN_party_Lars menu",
    });
    await user.click(within(menu2).getByText("Remove friend"));
    expect(
      within(window).queryByText("LAN_party_Lars"),
    ).not.toBeInTheDocument();
    expect(within(window).getByText("Offline (1)")).toBeInTheDocument();
  });

  it("pauses while a game window is open and says so", async () => {
    const { presence } = renderFriends({
      windows: [
        friendsWindow,
        {
          id: "w2",
          minimized: false,
          maximized: false,
          kind: "fusegame",
          gameId: "fuseball",
        },
      ],
    });
    const window = await dialog();
    expect(presence.snapshot().suspended).toBe(true);
    expect(within(window).getByRole("status")).toHaveTextContent(
      "A game window is open",
    );
    expect(within(window).getByText("In a game · demo")).toBeInTheDocument();
  });

  it("switches to the demo buddies and back from the sign-in screen and the File menu", async () => {
    const timers = createManualTimers();
    const presence = createSwitchablePresenceService(
      createNullPresenceService(),
      () => createDemoPresenceService({ schedule: timers.schedule }),
    );
    const { user } = renderFriends({ presence });
    const window = await dialog();
    await user.click(
      within(window).getByRole("button", {
        name: "No account? Try the demo buddy list",
      }),
    );
    expect(
      await within(window).findByText("Online · demo"),
    ).toBeInTheDocument();
    await user.click(within(window).getByRole("menuitem", { name: "File" }));
    const demoItem = within(window).getByRole("menuitemcheckbox", {
      name: "Demo buddies",
    });
    expect(demoItem).toHaveAttribute("aria-checked", "true");
    await user.click(demoItem);
    expect(
      await within(window).findByRole("button", {
        name: "Sign in with Google",
      }),
    ).toBeInTheDocument();
    // The live service here cannot sign in; its message reaches the window.
    await user.click(
      within(window).getByRole("button", { name: "Sign in with Google" }),
    );
    expect(await within(window).findByRole("alert")).toHaveTextContent(
      "Sign-in is not available here.",
    );
  });

  it("copies the player's id, joins on a double click and declines a request", async () => {
    const { user, timers, friendsDeps } = renderFriends();
    const window = await dialog();
    await user.click(
      within(window).getByRole("button", { name: "Copy your player id" }),
    );
    expect(friendsDeps.copyText).toHaveBeenCalledWith(DEMO_ME.publicId);

    await user.dblClick(
      within(window).getByTestId(`buddy-${DEMO_BUDDIES[0]!.publicId}`),
    );
    expect(
      await screen.findByRole("dialog", { name: "Fuseball" }),
    ).toBeInTheDocument();
    // An offline buddy has no game to join; a double click there does nothing.
    await user.dblClick(
      within(window).getByTestId(`buddy-${DEMO_BUDDIES[5]!.publicId}`),
    );
    expect(screen.getAllByRole("dialog", { name: "Fuseball" })).toHaveLength(1);

    for (let i = 0; i < 4; i++) timers.fire(5_000);
    await user.click(
      await within(window).findByRole("button", {
        name: "Decline PigChampion",
      }),
    );
    expect(within(window).queryByText("Requests")).not.toBeInTheDocument();
    expect(within(window).getByText("Online (2)")).toBeInTheDocument();
  });

  it("has Help > About and File > Close", async () => {
    const { user } = renderFriends();
    const window = await dialog();
    await user.click(within(window).getByRole("menuitem", { name: "Help" }));
    await user.click(
      within(window).getByRole("menuitemcheckbox", {
        name: "About Fuse Messenger",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "About Fuse Messenger" }),
    ).toBeInTheDocument();
    await user.click(within(window).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(window).getByRole("menuitemcheckbox", { name: "Close" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Fuse Messenger" }),
    ).not.toBeInTheDocument();
  });
});
