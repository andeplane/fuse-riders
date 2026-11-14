import type { Intent, IntentCatalog } from "./intent";
import {
  createIntentEngine,
  intentsReply,
  parseIntent,
  parseIntents,
  parseRequest,
  requestChecklist,
} from "./intent";

const catalog: IntentCatalog = {
  targets: [
    { id: "fuseball", name: "Fuseball" },
    { id: "fuse-riders", name: "Fuse Riders" },
    { id: "cops", name: "Cops and Robbers" },
    { id: "paint", name: "Paint", aliases: ["mspaint"] },
    { id: "winamp", name: "Winamp" },
    {
      id: "display",
      name: "Display Properties",
      aliases: ["wallpaper", "background", "display settings"],
    },
    {
      id: "screensaver",
      name: "Screen Saver settings",
      aliases: ["screen saver settings", "screensaver settings"],
    },
  ],
  gameNames: ["Fuseball", "Fuse Riders", "Cops and Robbers"],
};

function markers(text: string): string[] {
  return parseIntents(text, catalog).map((intent) => {
    switch (intent.kind) {
      case "open":
        return `[open:${intent.target.id}]`;
      case "music":
        return `[music:${intent.action}]`;
      case "action":
        return intent.marker;
      default:
        return intent.kind;
    }
  });
}

describe(parseIntents.name, () => {
  it("splits a sentence into its requests, in order", () => {
    expect(markers("open fuseball and play music")).toEqual([
      "[open:fuseball]",
      "[music:play]",
    ]);
    expect(
      markers("Open Paint, then play some music; also open Fuse Riders."),
    ).toEqual(["[open:paint]", "[music:play]", "[open:fuse-riders]"]);
    expect(markers("pause the music. After that open winamp!")).toEqual([
      "[music:pause]",
      "[open:winamp]",
    ]);
  });

  it("carries what one request was about into the next: 'maximize it'", () => {
    expect(markers("open paint and maximize it")).toEqual([
      "[open:paint]",
      "[maximize_window:Paint]",
    ]);
    expect(markers("minimize fuseball, then close it")).toEqual([
      "[minimize_window:Fuseball]",
      "[close_window:Fuseball]",
    ]);
    expect(
      markers("open fuseball in a new tab and then focus the window"),
    ).toEqual(["[launch_game:fuseball,tab]", "[focus_window:Fuseball]"]);
  });

  it("reads a sentence whole when it does not split into two understood requests", () => {
    expect(markers("rock and roll")).toEqual(["unknown"]);
    expect(markers("open fuseball and have fun")).toEqual(["[open:fuseball]"]);
    expect(markers("open Cops and Robbers")).toEqual(["[open:cops]"]);
    expect(markers("make it black and white")).toEqual([
      "[set_display:color_mode=monochrome]",
    ]);
    expect(markers("open cops and robbers and play music")).toEqual([
      "[open:cops]",
      "[music:play]",
    ]);
    expect(markers("")).toEqual(["unknown"]);
  });

  it("answers several requests with what Clippy says for each, then their markers in order", () => {
    expect(
      intentsReply(
        parseIntents("open fuseball and play music", catalog),
        catalog,
      ),
    ).toBe(
      "Opening Fuseball! Winamp coming right up! [open:fuseball] [music:play]",
    );
    const mixed: Intent[] = [{ kind: "hello" }, { kind: "games" }];
    expect(intentsReply(mixed, catalog)).toBe(
      'Hi there! Ready to play? Tell me which game to open. You can play Fuseball, Fuse Riders, Cops and Robbers. Say "open" and a name and off we go!',
    );
  });

  it("is what the rules engine answers with", async () => {
    const engine = createIntentEngine(catalog, "no WebGPU");
    let reply = "";
    for await (const piece of engine.reply({
      system: "",
      messages: [{ role: "user", content: "close paint and open winamp" }],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    }))
      reply += piece;
    expect(reply).toBe(
      "Closing Paint. Opening Winamp! [close_window:Paint] [open:winamp]",
    );
  });
});

describe(requestChecklist.name, () => {
  it("lists the parts of a request with the tools that would do each", () => {
    expect(
      requestChecklist(
        "Open Fuseball, play some music and switch to 256 colors",
        catalog,
      ),
    ).toEqual([
      {
        part: "Open Fuseball",
        tools: ["open_app", "launch_game", "open", "explorer_open"],
      },
      { part: "play some music", tools: ["music"] },
      { part: "switch to 256 colors", tools: ["set_display"] },
    ]);
    expect(
      requestChecklist("open fuseball in a new tab and close paint", catalog),
    ).toEqual([
      {
        part: "open fuseball in a new tab",
        tools: ["launch_game", "open_app"],
      },
      { part: "close paint", tools: ["close_window"] },
    ]);
  });

  it("leaves out the parts that only talk or look, and a request that is one thing", () => {
    expect(
      requestChecklist("hello, which games are there and open paint", catalog),
    ).toEqual([
      {
        part: "open paint",
        tools: ["open_app", "launch_game", "open", "explorer_open"],
      },
    ]);
    expect(requestChecklist("close paint and what is open?", catalog)).toEqual([
      { part: "close paint", tools: ["close_window"] },
    ]);
    // One request, or one the rules do not follow: the model is on its own.
    expect(requestChecklist("open paint", catalog)).toEqual([]);
    expect(requestChecklist("set the volume to 30", catalog)).toEqual([]);
    expect(
      requestChecklist("tell me a joke about paperclips", catalog),
    ).toEqual([]);
    expect(parseRequest("  open paint  ", catalog)).toEqual([
      {
        clause: "open paint",
        intent: { kind: "open", target: catalog.targets[3] },
      },
    ]);
  });
});

describe("the rules beyond open and music", () => {
  const marker = (text: string, subject?: string) => {
    const intent = parseIntent(text, catalog, subject);
    return intent.kind === "action" ? intent.marker : intent.kind;
  };

  it("closes, minimizes, maximizes and focuses a window by name, or the one just spoken of", () => {
    expect(marker("close paint")).toBe("[close_window:Paint]");
    expect(marker("please quit the notepad window")).toBe(
      "[close_window:notepad]",
    );
    expect(marker("minimise Fuse Riders")).toBe(
      "[minimize_window:Fuse Riders]",
    );
    expect(marker("make it full screen", "Paint")).toBe(
      "[maximize_window:Paint]",
    );
    expect(marker("maximize", "Paint")).toBe("[maximize_window:Paint]");
    expect(marker("switch to winamp")).toBe("[focus_window:Winamp]");
    // Nothing to close: no name, and nothing spoken of before.
    expect(marker("close it")).toBe("unknown");
    expect(parseIntent("close paint", catalog)).toEqual({
      kind: "action",
      say: "Closing Paint.",
      marker: "[close_window:Paint]",
      subject: "Paint",
    });
  });

  it("sets the volume from a number or a direction", () => {
    expect(marker("set the volume to 30")).toBe("[music:volume,30]");
    expect(marker("volume 250%")).toBe("[music:volume,100]");
    expect(marker("louder!")).toBe("[music:volume,85]");
    expect(marker("turn the volume down")).toBe("[music:volume,25]");
    expect(marker("quieter please")).toBe("[music:volume,25]");
    expect(marker("mute")).toBe("[music:volume,0]");
    expect(marker("what is the volume")).toBe("unknown");
  });

  it("changes the display: colour depth, resolution, scheme, CRT, large fonts", () => {
    expect(marker("256 colours please")).toBe(
      "[set_display:color_mode=256-colors]",
    );
    expect(marker("switch to 16 colors")).toBe(
      "[set_display:color_mode=16-colors]",
    );
    expect(marker("high color")).toBe("[set_display:color_mode=high-color]");
    expect(marker("back to true color")).toBe(
      "[set_display:color_mode=true-color]",
    );
    expect(marker("set the resolution to 800x600")).toBe(
      "[set_display:resolution=800x600]",
    );
    expect(marker("640 by 480")).toBe("[set_display:resolution=640x480]");
    expect(marker("native resolution")).toBe("[set_display:resolution=native]");
    expect(marker("hot dog stand")).toBe("[set_display:scheme=hot-dog-stand]");
    expect(marker("use the rose theme")).toBe("[set_display:scheme=rose]");
    // A rose is not a colour scheme unless the sentence says so.
    expect(marker("a rose by any other name")).toBe("unknown");
    expect(marker("turn on the crt")).toBe("[set_display:crt=full]");
    expect(marker("crt off")).toBe("[set_display:crt=off]");
    expect(marker("scanlines")).toBe("[set_display:crt=scanlines]");
    expect(marker("no scan lines")).toBe("[set_display:crt=off]");
    expect(marker("large fonts")).toBe("[set_display:large_fonts=true]");
    expect(marker("turn off big fonts")).toBe(
      "[set_display:large_fonts=false]",
    );
  });

  it("paints the desktop, starts the screen saver and presses Start", () => {
    expect(marker("make the desktop red")).toBe("[set_wallpaper:red]");
    expect(marker("blue background")).toBe("[set_wallpaper:blue]");
    expect(marker("start the screen saver")).toBe("[screensaver_preview:]");
    expect(marker("open the start menu")).toBe("[open_start_menu:]");
    // Asking for the settings opens them instead of changing anything.
    expect(parseIntent("open the screensaver settings", catalog)).toMatchObject(
      {
        kind: "open",
        target: { id: "screensaver" },
      },
    );
    expect(parseIntent("change the wallpaper", catalog)).toMatchObject({
      kind: "open",
      target: { id: "display" },
    });
    expect(parseIntent("red display settings", catalog)).toMatchObject({
      kind: "open",
    });
  });

  it("reads, lists and opens a path on a drive, looks at the desktop and undoes an edit", () => {
    expect(marker("read C:/README.md")).toBe("[read_file:C:/README.md]");
    expect(marker("what is in C:\\docs?")).toBe("[list_dir:C:\\docs]");
    expect(marker("list the files on a:")).toBe("[list_dir:a:]");
    expect(marker("what files are in C:/docs?")).toBe("[list_dir:C:/docs]");
    expect(marker("open C:/docs.")).toBe("[explorer_open:C:/docs]");
    expect(marker("what windows are there")).toBe("[get_desktop_state:]");
    expect(marker("what's open?")).toBe("[get_desktop_state:]");
    expect(marker("undo that")).toBe("[undo_edit:]");
  });

  it("opens a Fuse game in a browser tab when asked to, and only a game", () => {
    expect(marker("open fuseball in a new tab")).toBe(
      "[launch_game:fuseball,tab]",
    );
    expect(parseIntent("open paint in a tab", catalog)).toMatchObject({
      kind: "open",
      target: { id: "paint" },
    });
  });
});
