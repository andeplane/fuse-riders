import { render, screen } from "@testing-library/react";

import type { GameFrame } from "./IframeGame";
import { GAME_IFRAME_ALLOW, IframeGame, liveFrameUrl } from "./IframeGame";

describe(IframeGame.name, () => {
  it("hands the frame element to the caller on mount and null on unmount", () => {
    const frames: (HTMLIFrameElement | null)[] = [];
    const { unmount } = render(
      <IframeGame
        name="Doom"
        url="/fuseos/retro/doom.html"
        active
        onActivate={() => undefined}
        onFrame={(frame) => frames.push(frame)}
      />,
    );
    const frame = screen.getByTitle("Doom");
    expect(frames).toEqual([frame]);
    expect(frame).toHaveAttribute("allow", GAME_IFRAME_ALLOW);
    unmount();
    expect(frames).toEqual([frame, null]);
  });
});

describe(liveFrameUrl.name, () => {
  const fallback = "/fuse-riders/fuseball/";

  it("reads the page's current address, which carries the room it entered", () => {
    const frame: GameFrame = {
      contentWindow: {
        location: { href: "https://fuse.test/fuseball/?room=AB42" },
      },
    };
    expect(liveFrameUrl(frame, fallback)).toBe(
      "https://fuse.test/fuseball/?room=AB42",
    );
  });

  it("falls back to the address it was given when there is nothing to read", () => {
    expect(liveFrameUrl(null, fallback)).toBe(fallback);
    expect(liveFrameUrl(undefined, fallback)).toBe(fallback);
    expect(liveFrameUrl({ contentWindow: null }, fallback)).toBe(fallback);
    expect(
      liveFrameUrl(
        { contentWindow: { location: { href: "about:blank" } } },
        fallback,
      ),
    ).toBe(fallback);
    const crossOrigin: GameFrame = {
      contentWindow: {
        get location(): { href: string } {
          throw new DOMException("Blocked a frame", "SecurityError");
        },
      },
    };
    expect(liveFrameUrl(crossOrigin, fallback)).toBe(fallback);
  });
});
