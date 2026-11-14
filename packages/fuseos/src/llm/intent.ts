import type { ChatBackend, ChatEngine, ReplyRequest } from "./llmChat";

/**
 * The rule-based assistant for browsers without WebGPU (and for a model that failed to load): a handful of
 * commands recognised by keywords, answered in Clippy's voice with the same tool markers a model would use, so the
 * desktop executes them through the one tool pipeline.
 */
export type IntentTarget = {
  /** What `[open:<id>]` takes. */
  id: string;
  name: string;
  /** Other words the user may call it, e.g. "settings" for the Control Panel. */
  aliases?: readonly string[];
};

export type IntentCatalog = {
  /** Everything that can be opened, Fuse games first so the games list reads naturally. */
  targets: readonly IntentTarget[];
  /** The Fuse games among the targets, for "which games are there". */
  gameNames: readonly string[];
};

export type MusicAction = "play" | "pause" | "stop" | "next" | "previous";

export type Intent =
  | { kind: "open"; target: IntentTarget }
  | { kind: "music"; action: MusicAction }
  /** Anything else the rules can do: what Clippy says and the marker of the tool that does it. */
  | { kind: "action"; say: string; marker: string; subject?: string }
  | { kind: "games" }
  | { kind: "help" }
  | { kind: "hello" }
  | { kind: "unknown" };

export const NO_WEBGPU_REASON =
  "This browser has no WebGPU, so Clippy follows simple commands instead of running a model. Chrome or Edge on a computer gives you the full Clippy.";

const HELP_TEXT =
  'I follow simple commands here: "open Fuseball", "play music", "next track", "open settings" or "which games are there". I can chain them too: "open Paint and maximize it", "close Winamp", "256 colors", "make the desktop red".';

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function has(normalized: string, phrase: string): boolean {
  return normalized.includes(` ${words(phrase).trim()} `);
}

function hasAny(normalized: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => has(normalized, phrase));
}

/** The target named in the text; the longest name wins so "Fuse Riders" beats "Fuse". */
export function findTarget(
  text: string,
  targets: readonly IntentTarget[],
): IntentTarget | undefined {
  const normalized = words(text);
  let best: { target: IntentTarget; length: number } | undefined;
  for (const target of targets) {
    for (const candidate of [
      target.name,
      target.id,
      ...(target.aliases ?? []),
    ]) {
      const phrase = words(candidate).trim();
      if (phrase === "" || !has(normalized, phrase)) continue;
      if (!best || phrase.length > best.length)
        best = { target, length: phrase.length };
    }
  }
  return best?.target;
}

const MUSIC_WORDS = ["music", "song", "songs", "track", "tunes", "soundtrack"];

function action(say: string, marker: string, subject?: string): Intent {
  return subject === undefined
    ? { kind: "action", say, marker }
    : { kind: "action", say, marker, subject };
}

const WINDOW_VERBS: readonly {
  phrases: readonly string[];
  tool: string;
  say: string;
}[] = [
  { phrases: ["close", "quit", "exit"], tool: "close_window", say: "Closing" },
  {
    phrases: ["minimize", "minimise", "hide"],
    tool: "minimize_window",
    say: "Minimizing",
  },
  {
    phrases: ["maximize", "maximise", "full screen", "fullscreen"],
    tool: "maximize_window",
    say: "Maximizing",
  },
  {
    phrases: ["focus", "switch to", "bring up"],
    tool: "focus_window",
    say: "Bringing up",
  },
];

const PRONOUNS = ["it", "that", "this", "them"];
/** Words around a window's name that are not part of it: "close the Paint window, please". */
const FILLER_WORDS = ["the", "window", "please", "app", "program", "game"];

/** "close paint", "maximize it" (the thing the clause before named), "minimize the notepad window". */
function windowIntent(
  normalized: string,
  text: string,
  catalog: IntentCatalog,
  subject: string | undefined,
): Intent | undefined {
  for (const verb of WINDOW_VERBS) {
    const phrase = verb.phrases.find((candidate) => has(normalized, candidate));
    if (!phrase) continue;
    const named = findTarget(text, catalog.targets)?.name;
    const rest = normalized
      .slice(normalized.indexOf(` ${phrase} `) + phrase.length + 1)
      .split(" ")
      .filter((word) => word !== "" && !FILLER_WORDS.includes(word))
      .join(" ");
    const target =
      named ?? (rest === "" || hasAny(` ${rest} `, PRONOUNS) ? subject : rest);
    if (!target) return undefined;
    return action(`${verb.say} ${target}.`, `[${verb.tool}:${target}]`, target);
  }
  return undefined;
}

function volumeIntent(normalized: string): Intent | undefined {
  if (has(normalized, "mute"))
    return action("Muting Winamp.", "[music:volume,0]");
  const mentioned = hasAny(normalized, ["volume", "louder", "quieter"]);
  if (!mentioned) return undefined;
  const level = / (\d{1,3}) /.exec(normalized)?.[1];
  if (level !== undefined)
    return action(
      `Setting the volume to ${Math.min(100, Number(level))}.`,
      `[music:volume,${Math.min(100, Number(level))}]`,
    );
  if (hasAny(normalized, ["louder", "volume up", "turn up", "turn it up"]))
    return action("Turning it up!", "[music:volume,85]");
  if (
    hasAny(normalized, ["quieter", "volume down", "turn down", "turn it down"])
  )
    return action("Turning it down.", "[music:volume,25]");
  return undefined;
}

const COLOR_MODE_PHRASES: readonly {
  phrases: readonly string[];
  mode: string;
}[] = [
  {
    phrases: ["monochrome", "black and white", "grayscale"],
    mode: "monochrome",
  },
  { phrases: ["16 colors", "16 colours"], mode: "16-colors" },
  { phrases: ["256 colors", "256 colours"], mode: "256-colors" },
  { phrases: ["high color", "high colour"], mode: "high-color" },
  {
    phrases: ["true color", "true colour", "full color", "full colour"],
    mode: "true-color",
  },
];

const SCHEME_PHRASES: readonly {
  phrase: string;
  id: string;
  needsHint: boolean;
}[] = [
  { phrase: "windows standard", id: "windows-standard", needsHint: false },
  { phrase: "rainy day", id: "rainy-day", needsHint: false },
  { phrase: "high contrast", id: "high-contrast", needsHint: false },
  { phrase: "hot dog stand", id: "hot-dog-stand", needsHint: false },
  { phrase: "fuse neon", id: "fuse-neon", needsHint: false },
  { phrase: "rose", id: "rose", needsHint: true },
  { phrase: "slate", id: "slate", needsHint: true },
];

const OFF_WORDS = ["off", "disable", "no", "without", "remove", "stop"];

/** Display Properties by voice: colour depth, resolution, scheme, the CRT monitor, large fonts. */
function displayIntent(normalized: string): Intent | undefined {
  const mode = COLOR_MODE_PHRASES.find((entry) =>
    hasAny(normalized, entry.phrases),
  );
  if (mode)
    return action(
      `Switching the display to ${mode.mode}.`,
      `[set_display:color_mode=${mode.mode}]`,
    );
  const resolution = / (640|800|1024) ?(?:x|by) ?(480|600|768) /.exec(
    normalized,
  );
  if (resolution)
    return action(
      `Setting the resolution to ${resolution[1]} by ${resolution[2]}.`,
      `[set_display:resolution=${resolution[1]}x${resolution[2]}]`,
    );
  if (hasAny(normalized, ["native resolution", "normal resolution"]))
    return action(
      "Back to the native resolution.",
      "[set_display:resolution=native]",
    );
  const hinted = hasAny(normalized, ["scheme", "theme", "appearance"]);
  const scheme = SCHEME_PHRASES.find(
    (entry) => has(normalized, entry.phrase) && (hinted || !entry.needsHint),
  );
  if (scheme)
    return action(
      `Switching to the ${scheme.phrase} colour scheme.`,
      `[set_display:scheme=${scheme.id}]`,
    );
  const off = hasAny(normalized, OFF_WORDS);
  if (hasAny(normalized, ["scanlines", "scan lines"]))
    return action(
      off ? "Scanlines off." : "Scanlines on!",
      `[set_display:crt=${off ? "off" : "scanlines"}]`,
    );
  if (hasAny(normalized, ["crt", "old monitor", "tube"]))
    return action(
      off ? "Switching the CRT monitor off." : "Warming up the CRT monitor!",
      `[set_display:crt=${off ? "off" : "full"}]`,
    );
  if (hasAny(normalized, ["large fonts", "big fonts", "bigger text"]))
    return action(
      off ? "Back to the normal font size." : "Large fonts on.",
      `[set_display:large_fonts=${off ? "false" : "true"}]`,
    );
  return undefined;
}

const COLOR_NAMES = [
  "teal",
  "black",
  "grey",
  "gray",
  "silver",
  "white",
  "maroon",
  "red",
  "olive",
  "yellow",
  "green",
  "lime",
  "cyan",
  "navy",
  "blue",
  "purple",
  "magenta",
  "pink",
  "violet",
  "brown",
];

function wallpaperIntent(normalized: string): Intent | undefined {
  if (!hasAny(normalized, ["background", "desktop", "wallpaper"]))
    return undefined;
  const color = COLOR_NAMES.find((name) => has(normalized, name));
  return color === undefined
    ? undefined
    : action(`Painting the desktop ${color}.`, `[set_wallpaper:${color}]`);
}

/** A drive path as typed: "C:", "C:\docs", "a:/porn/homework.txt". */
const PATH = /\b([a-zA-Z]:(?:[\\/][^\s,;"']*)?)/;

function diskIntent(normalized: string, text: string): Intent | undefined {
  const path = PATH.exec(text)?.[1]?.replace(/[.!?]+$/, "");
  if (path === undefined) return undefined;
  if (hasAny(normalized, ["read", "what does", "contents of"]))
    return action(`Reading ${path}.`, `[read_file:${path}]`);
  if (
    hasAny(normalized, [
      "list",
      "what is in",
      "what s in",
      "what is on",
      "what s on",
      "files in",
      "files on",
      "what files",
      "which files",
      "files are in",
      "files are on",
    ])
  )
    return action(`Looking in ${path}.`, `[list_dir:${path}]`);
  return action(`Opening ${path}.`, `[explorer_open:${path}]`);
}

/** One clause as one intent; `subject` is what the clause before it was about, for "maximize it". */
export function parseIntent(
  text: string,
  catalog: IntentCatalog,
  subject?: string,
): Intent {
  const normalized = words(text);
  if (normalized.trim() === "") return { kind: "unknown" };
  if (hasAny(normalized, ["next track", "next song", "skip"]))
    return { kind: "music", action: "next" };
  if (hasAny(normalized, ["previous track", "previous song", "last track"]))
    return { kind: "music", action: "previous" };
  if (hasAny(normalized, ["pause"])) return { kind: "music", action: "pause" };
  if (has(normalized, "stop") && hasAny(normalized, MUSIC_WORDS))
    return { kind: "music", action: "stop" };
  if (has(normalized, "play") && hasAny(normalized, MUSIC_WORDS))
    return { kind: "music", action: "play" };
  const settings = hasAny(normalized, ["settings", "options", "properties"]);
  const special =
    volumeIntent(normalized) ??
    // Before the windows: "switch to 16 colors" is about the display, not a window called "16 colors".
    (settings ? undefined : displayIntent(normalized)) ??
    windowIntent(normalized, text, catalog, subject) ??
    (has(normalized, "start menu")
      ? action("Opening the Start menu.", "[open_start_menu:]")
      : undefined) ??
    (settings ? undefined : wallpaperIntent(normalized)) ??
    (!settings && hasAny(normalized, ["screensaver", "screen saver"])
      ? action("Starting the screen saver!", "[screensaver_preview:]")
      : undefined) ??
    diskIntent(normalized, text) ??
    (hasAny(normalized, [
      "what is open",
      "what s open",
      "which windows",
      "what windows",
      "what is running",
      "what s running",
    ])
      ? action("Let me look at the desktop.", "[get_desktop_state:]")
      : undefined) ??
    (hasAny(normalized, ["undo"])
      ? action("Undoing the last edit.", "[undo_edit:]")
      : undefined);
  if (special) return special;
  const target = findTarget(text, catalog.targets);
  if (target) {
    const isGame = catalog.gameNames.includes(target.name);
    if (isGame && hasAny(normalized, ["tab", "new tab", "browser tab"]))
      return action(
        `Opening ${target.name} in a new tab!`,
        `[launch_game:${target.id},tab]`,
        target.name,
      );
    return { kind: "open", target };
  }
  if (
    hasAny(normalized, [
      "which games",
      "what games",
      "list games",
      "list the games",
      "what can i play",
      "games are there",
    ])
  )
    return { kind: "games" };
  if (
    hasAny(normalized, ["help", "what can you do", "tip", "tips", "commands"])
  )
    return { kind: "help" };
  if (
    hasAny(normalized, ["hello", "hi", "hey", "good morning", "good evening"])
  )
    return { kind: "hello" };
  return { kind: "unknown" };
}

/** What separates two requests in one sentence: "and", "then", "also", a comma, a full stop. */
const CLAUSE_BREAK =
  /\s*(?:[,;]|[.!?]+(?=\s|$)|\band then\b|\bafter that\b|\bthen\b|\band also\b|\balso\b|\band\b)\s*/i;

/** Phrases that carry an "and" of their own and must not be split: "black and white", a game called "Cops and Robbers". */
function protectedPhrases(catalog: IntentCatalog): string[] {
  return [
    "black and white",
    ...catalog.targets.flatMap((target) => [
      target.name,
      ...(target.aliases ?? []),
    ]),
  ].filter((phrase) => /\band\b/i.test(phrase));
}

const GLUE = "\u0000";

/**
 * Everything a sentence asks for, in order: "open Fuseball and play music" is two intents, "open Paint, then
 * maximize it" two more (the second about the first's target). A sentence that does not split into at least
 * two understood requests is read whole, so "rock and roll" stays one (unknown) request.
 */
export function parseIntents(text: string, catalog: IntentCatalog): Intent[] {
  return parseRequest(text, catalog).map((part) => part.intent);
}

/** `parseIntents` with the words each intent came from: the clause, or the whole sentence when it did not split. */
export function parseRequest(
  text: string,
  catalog: IntentCatalog,
): { clause: string; intent: Intent }[] {
  let guarded = text;
  for (const phrase of protectedPhrases(catalog)) {
    const pattern = new RegExp(
      phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    guarded = guarded.replace(pattern, (found) =>
      found.replace(/\band\b/gi, `a${GLUE}nd`),
    );
  }
  const clauses = guarded
    .split(CLAUSE_BREAK)
    .map((clause) => clause.replaceAll(GLUE, "").trim())
    .filter((clause) => clause !== "");
  if (clauses.length > 1) {
    let subject: string | undefined;
    const understood: { clause: string; intent: Intent }[] = [];
    for (const clause of clauses) {
      const intent = parseIntent(clause, catalog, subject);
      if (intent.kind === "unknown") continue;
      if (intent.kind === "open") subject = intent.target.name;
      else if (intent.kind === "action" && intent.subject !== undefined)
        subject = intent.subject;
      understood.push({ clause, intent });
    }
    if (understood.length > 1) return understood;
  }
  return [{ clause: text.trim(), intent: parseIntent(text, catalog) }];
}

/** The tools that would carry an intent out; none for one that only talks (the games list, help, hello). */
function intentTools(intent: Intent): readonly string[] {
  switch (intent.kind) {
    case "open":
      return ["open_app", "launch_game", "open", "explorer_open"];
    case "music":
      return ["music"];
    case "action": {
      const name = /^\[([A-Za-z0-9_-]+):/.exec(intent.marker)?.[1];
      // A game "in a new tab" is as well served by open_app as by launch_game.
      if (name === "launch_game") return ["launch_game", "open_app"];
      // Looking is optional: the model may know the answer from the desktop line of its prompt.
      if (name === undefined || name === "get_desktop_state") return [];
      return [name];
    }
    default:
      return [];
  }
}

/**
 * What a request asks to be done, part by part, as far as the rules can tell: the agent loop holds a model to
 * it (`AgentLoopOptions.checklist`). Empty unless the sentence splits into at least two understood requests:
 * that is where a small model drops a part, and a single request is better left to the model than to the
 * rules, which read an "open" into any sentence that names a program.
 */
export function requestChecklist(
  text: string,
  catalog: IntentCatalog,
): { part: string; tools: readonly string[] }[] {
  const parts = parseRequest(text, catalog);
  if (parts.length < 2) return [];
  return parts
    .map(({ clause, intent }) => ({ part: clause, tools: intentTools(intent) }))
    .filter((item) => item.tools.length > 0);
}

function intentParts(
  intent: Intent,
  catalog: IntentCatalog,
): { say: string; marker: string } {
  switch (intent.kind) {
    case "open":
      return {
        say: `Opening ${intent.target.name}!`,
        marker: `[open:${intent.target.id}]`,
      };
    case "music":
      return {
        say: {
          play: "Winamp coming right up!",
          pause: "Pausing the music.",
          stop: "Stopping the music.",
          next: "Skipping to the next track.",
          previous: "Back to the previous track.",
        }[intent.action],
        marker: `[music:${intent.action}]`,
      };
    case "action":
      return { say: intent.say, marker: intent.marker };
    case "games":
      return {
        say:
          catalog.gameNames.length === 0
            ? "No Fuse games are installed on this desktop yet."
            : `You can play ${catalog.gameNames.join(", ")}. Say "open" and a name and off we go!`,
        marker: "",
      };
    case "help":
      return { say: HELP_TEXT, marker: "" };
    case "hello":
      return {
        say: "Hi there! Ready to play? Tell me which game to open.",
        marker: "",
      };
    case "unknown":
      return { say: `I'm not sure what you mean. ${HELP_TEXT}`, marker: "" };
  }
}

/** Clippy's answer to an intent, markers included. */
export function intentReply(intent: Intent, catalog: IntentCatalog): string {
  return intentsReply([intent], catalog);
}

/** Clippy's answer to several intents: what he says for each, then their markers in order. */
export function intentsReply(
  intents: readonly Intent[],
  catalog: IntentCatalog,
): string {
  const parts = intents.map((intent) => intentParts(intent, catalog));
  return [
    ...parts.map((part) => part.say),
    ...parts.map((part) => part.marker).filter((marker) => marker !== ""),
  ].join(" ");
}

/** A chat engine that answers instantly from the rules; `reason` tells the balloon why there is no model. */
export function createIntentEngine(
  catalog: IntentCatalog,
  reason: string,
): ChatEngine {
  const backend: ChatBackend = { kind: "rules", reason };
  return {
    backend: () => backend,
    loopStyle: () => "markers",
    async *reply(request: ReplyRequest) {
      const last = [...request.messages]
        .reverse()
        .find((message) => message.role === "user");
      yield intentsReply(parseIntents(last?.content ?? "", catalog), catalog);
    },
    dispose: () => undefined,
  };
}
