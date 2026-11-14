import type { AgentOs } from "./agentOs";
import type { AgentTool, ToolArgs } from "./agentTool";
import { numberArg, stringArg } from "./agentTool";

export const MUSIC_ACTIONS = [
  "play",
  "pause",
  "stop",
  "next",
  "previous",
  "volume",
] as const;
export type MusicToolAction = (typeof MUSIC_ACTIONS)[number];

/** What a model or a person may write for an action: "prev", "skip", "resume". */
export const MUSIC_ALIASES: Readonly<Record<string, MusicToolAction>> = {
  prev: "previous",
  back: "previous",
  skip: "next",
  resume: "play",
  start: "play",
};

const SENTENCES: Record<Exclude<MusicToolAction, "volume">, string> = {
  play: "Playing music in Winamp",
  pause: "Pausing Winamp",
  stop: "Stopping Winamp",
  next: "Skipping to the next track",
  previous: "Going back a track",
};

/** The volume Winamp gets when asked for one without a number. */
export const DEFAULT_VOLUME = 50;

function actionOf(args: ToolArgs): MusicToolAction {
  const wanted = stringArg(args, "action");
  // `coerceArgs` only lets the listed actions through; "play" covers a caller that skipped it.
  return MUSIC_ACTIONS.find((action) => action === wanted) ?? "play";
}

function levelOf(args: ToolArgs): number {
  const level = numberArg(args, "level") ?? DEFAULT_VOLUME;
  return Math.round(Math.min(100, Math.max(0, level)));
}

/**
 * Winamp's transport and volume, over the buttons a user sees. With no Winamp open, `play` opens one and
 * presses Play the moment it has loaded, so the Fuse soundtrack starts from the top; the other actions say so.
 */
export function createMusicTool(os: Pick<AgentOs, "music">): AgentTool {
  return {
    name: "music",
    description:
      "Controls Winamp, the music player; play starts it when it is closed. level is the volume, 0 to 100.",
    parameters: [
      {
        name: "action",
        type: "string",
        description: "",
        required: true,
        options: MUSIC_ACTIONS,
        aliases: MUSIC_ALIASES,
      },
      { name: "level", type: "number", description: "" },
    ],
    sentence: (args) => {
      const action = actionOf(args);
      return action === "volume"
        ? `Setting the volume to ${levelOf(args)}`
        : SENTENCES[action];
    },
    run: (args) => {
      const action = actionOf(args);
      const controls = os.music.controls();
      if (!controls) {
        if (action !== "play")
          return { ok: false, sentence: "Winamp is not open" };
        os.music.openAndPlay();
        return {
          ok: true,
          sentence: "Starting Winamp with the Fuse soundtrack",
        };
      }
      if (action === "volume") {
        if (!controls.setVolume)
          return { ok: false, sentence: "This Winamp has no volume control" };
        controls.setVolume(levelOf(args));
        return { ok: true, sentence: `Volume set to ${levelOf(args)}` };
      }
      controls[action]();
      return { ok: true, sentence: SENTENCES[action] };
    },
  };
}
