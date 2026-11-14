import { screen } from "@testing-library/react";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { GAME_IFRAME_ALLOW } from "../windows/IframeGame";

import { RoomGameWindow } from "./RoomGameWindow";

describe(RoomGameWindow.name, () => {
  it("embeds the game's page joined to the room and remembers the room", () => {
    const { recentRooms } = renderWithProviders(
      <RoomGameWindow
        gameId="fuseball"
        code="AB42"
        active
        onActivate={() => undefined}
      />,
      { muted: true },
    );
    const frame = screen.getByTitle("Fuseball room AB42");
    expect(frame).toHaveAttribute(
      "src",
      "/fuse-riders/fuseball/?mute&room=AB42",
    );
    expect(frame).toHaveAttribute("allow", GAME_IFRAME_ALLOW);
    expect(frame.parentElement).toHaveStyle({
      backgroundImage: "url(/fuse-riders/gallery/fuseball.jpg)",
    });
    expect(recentRooms.list().map((room) => room.code)).toEqual(["AB42"]);
  });

  it("explains a game that is not installed", () => {
    renderWithProviders(
      <RoomGameWindow
        gameId="pong"
        code="AB42"
        active
        onActivate={() => undefined}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      'The game "pong" is not installed on this FuseOS, so room AB42 cannot be joined from here.',
    );
  });
});
