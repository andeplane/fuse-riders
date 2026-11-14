import {
  installPlaytestGameFocus,
  playtestFocusGame,
  PLAYTEST_GAME_FOCUS,
} from "fuse-ui/playtest-focus";
import { installBrowserPlaytest } from "fuse-ui/playtest";

describe("recording game focus", () => {
  it("accepts desktop focus, checks frame origin/source/game, and returns to FuseOS on close", () => {
    const doc = document.implementation.createHTMLDocument();
    const changes: string[] = [];
    const focus = installPlaytestGameFocus({
      document: doc,
      window,
      gameId: "fuseos",
      knownGames: new Set(["fuseos", "fuse-riders", "fuse-birds"]),
      changed: (game) => changes.push(game),
    });
    const received = (
      gameId: string,
      source: Window | null,
      origin = window.location.origin,
    ) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: PLAYTEST_GAME_FOCUS, gameId },
          source,
          origin,
        }),
      );
    };
    received("fuse-riders", window, "https://other.example");
    received("unknown", window);
    received("fuse-riders", null);
    expect(changes).toEqual([]);
    received("fuse-riders", window); // Window titlebar / keyboard activation.
    expect(focus.current()).toBe("fuse-riders");
    received("fuse-birds", window);
    received("fuseos", window); // Closing/minimizing the last focused game.
    expect(changes).toEqual(["fuse-riders", "fuse-birds", "fuseos"]);
  });

  it("accepts only the current frame source with its actual same-origin game identity", () => {
    const source = new MessageChannel().port1;
    const origin = window.location.origin;
    const event = {
      source,
      origin,
      data: { type: PLAYTEST_GAME_FOCUS, gameId: "fuse-riders" },
    };
    const frames = [{ source, origin, gameId: "fuse-riders" }];
    const known = new Set(["fuse-riders", "fuse-birds"]);
    expect(playtestFocusGame(event, origin, window, frames, known)).toBe(
      "fuse-riders",
    );
    expect(
      playtestFocusGame(
        { ...event, source: null },
        origin,
        window,
        frames,
        known,
      ),
    ).toBeUndefined();
    expect(
      playtestFocusGame(
        { ...event, data: { ...event.data, gameId: "fuse-birds" } },
        origin,
        window,
        frames,
        known,
      ),
    ).toBeUndefined();
    expect(
      playtestFocusGame(
        event,
        origin,
        window,
        [{ ...frames[0]!, origin: "https://other.example" }],
        known,
      ),
    ).toBeUndefined();
    expect(playtestFocusGame(event, origin, window, [], known)).toBeUndefined(); // Removed iframe.
    source.close();
  });

  it("keeps report styling under a persistent scope outside a replaced game root", () => {
    const doc = document.implementation.createHTMLDocument();
    const app = doc.createElement("main");
    doc.body.append(app);
    installBrowserPlaytest({ document: doc, window, gameId: "fuse-riders" });
    app.replaceChildren(doc.createElement("canvas"));
    const dialog = doc.querySelector("dialog.fui-playtest-report");
    expect(dialog?.parentElement?.classList.contains("fui-app")).toBe(true);
    expect(dialog?.parentElement?.dataset.fuiPlaytest).toBe("overlays");
    expect(dialog?.parentElement?.style.display).toBe("contents");
    expect(dialog?.isConnected).toBe(true);
    expect(app.contains(dialog)).toBe(false);
  });
});
