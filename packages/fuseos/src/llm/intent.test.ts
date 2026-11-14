import type { IntentCatalog, IntentTarget } from "./intent";
import {
  createIntentEngine,
  findTarget,
  intentReply,
  NO_WEBGPU_REASON,
  parseIntent,
} from "./intent";

const FUSEBALL: IntentTarget = { id: "fuseball", name: "Fuseball" };
const DOOM: IntentTarget = { id: "doom", name: "DOOM" };
const WINAMP: IntentTarget = { id: "winamp", name: "Winamp" };
const TARGETS: readonly IntentTarget[] = [
  FUSEBALL,
  { id: "fuse-riders", name: "Fuse Riders" },
  DOOM,
  { id: "keen1", name: "Commander Keen 1", aliases: ["keen"] },
  { id: "settings", name: "Control Panel", aliases: ["settings", "options"] },
  WINAMP,
];

const CATALOG: IntentCatalog = {
  targets: TARGETS,
  gameNames: ["Fuseball", "Fuse Riders"],
};

describe(findTarget.name, () => {
  it("matches by name, id or alias, ignoring case and punctuation", () => {
    expect(findTarget("Open FUSEBALL please", TARGETS)?.id).toBe("fuseball");
    expect(findTarget("start fuse-riders", TARGETS)?.id).toBe("fuse-riders");
    expect(findTarget("I want to play keen!", TARGETS)?.id).toBe("keen1");
    expect(findTarget("show me the options", TARGETS)?.id).toBe("settings");
  });

  it("prefers the longest name so a game beats a word inside it, and needs whole words", () => {
    expect(findTarget("open fuse riders", TARGETS)?.id).toBe("fuse-riders");
    expect(findTarget("doomsday", TARGETS)).toBeUndefined();
    expect(findTarget("", TARGETS)).toBeUndefined();
  });
});

describe(parseIntent.name, () => {
  it("opens whatever is named", () => {
    expect(parseIntent("Open Fuseball", CATALOG)).toEqual({
      kind: "open",
      target: FUSEBALL,
    });
    expect(parseIntent("doom", CATALOG)).toEqual({
      kind: "open",
      target: DOOM,
    });
  });

  it("drives the music", () => {
    expect(parseIntent("play some music", CATALOG)).toEqual({
      kind: "music",
      action: "play",
    });
    expect(parseIntent("Play a song!", CATALOG)).toEqual({
      kind: "music",
      action: "play",
    });
    expect(parseIntent("pause", CATALOG)).toEqual({
      kind: "music",
      action: "pause",
    });
    expect(parseIntent("stop the music", CATALOG)).toEqual({
      kind: "music",
      action: "stop",
    });
    expect(parseIntent("next track", CATALOG)).toEqual({
      kind: "music",
      action: "next",
    });
    expect(parseIntent("skip", CATALOG)).toEqual({
      kind: "music",
      action: "next",
    });
    expect(parseIntent("previous song", CATALOG)).toEqual({
      kind: "music",
      action: "previous",
    });
    // "play Winamp" opens the player rather than failing on the missing music word.
    expect(parseIntent("play winamp", CATALOG)).toEqual({
      kind: "open",
      target: WINAMP,
    });
  });

  it("lists the games, helps, greets, and gives up gracefully", () => {
    expect(parseIntent("Which games are there?", CATALOG)).toEqual({
      kind: "games",
    });
    expect(parseIntent("what can I play", CATALOG)).toEqual({ kind: "games" });
    expect(parseIntent("help", CATALOG)).toEqual({ kind: "help" });
    expect(parseIntent("what can you do?", CATALOG)).toEqual({ kind: "help" });
    expect(parseIntent("Hello Clippy", CATALOG)).toEqual({ kind: "hello" });
    expect(parseIntent("tell me a joke", CATALOG)).toEqual({ kind: "unknown" });
    expect(parseIntent("   ", CATALOG)).toEqual({ kind: "unknown" });
  });
});

describe(intentReply.name, () => {
  it("answers in Clippy's voice with the markers the tools execute", () => {
    expect(intentReply({ kind: "open", target: FUSEBALL }, CATALOG)).toBe(
      "Opening Fuseball! [open:fuseball]",
    );
    expect(intentReply({ kind: "music", action: "play" }, CATALOG)).toBe(
      "Winamp coming right up! [music:play]",
    );
    expect(intentReply({ kind: "music", action: "next" }, CATALOG)).toContain(
      "[music:next]",
    );
    expect(intentReply({ kind: "games" }, CATALOG)).toContain(
      "Fuseball, Fuse Riders",
    );
    expect(
      intentReply({ kind: "games" }, { targets: [], gameNames: [] }),
    ).toContain("No Fuse games");
    expect(intentReply({ kind: "help" }, CATALOG)).toContain("open Fuseball");
    expect(intentReply({ kind: "hello" }, CATALOG)).toContain("Hi there");
    expect(intentReply({ kind: "unknown" }, CATALOG)).toContain(
      "not sure what you mean",
    );
  });
});

describe(createIntentEngine.name, () => {
  it("answers the last user line at once and reports the rules as its backend", async () => {
    const engine = createIntentEngine(CATALOG, NO_WEBGPU_REASON);
    expect(engine.backend()).toEqual({
      kind: "rules",
      reason: NO_WEBGPU_REASON,
    });
    const pieces: string[] = [];
    for await (const piece of engine.reply({
      system: "ignored",
      messages: [
        { role: "user", content: "open doom" },
        { role: "assistant", content: "Opening DOOM! [open:doom]" },
        { role: "user", content: "play music" },
      ],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    }))
      pieces.push(piece);
    expect(pieces).toEqual(["Winamp coming right up! [music:play]"]);
    engine.dispose();
  });

  it("treats a conversation without a user line as nothing said", async () => {
    const engine = createIntentEngine(CATALOG, "why");
    const pieces: string[] = [];
    for await (const piece of engine.reply({
      system: "",
      messages: [],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    }))
      pieces.push(piece);
    expect(pieces[0]).toContain("not sure");
  });
});
