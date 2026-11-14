import type { ColorMode, DesktopArea } from "../desktop/displayModes";
import { COLOR_MODES, DESKTOP_AREAS } from "../desktop/displayModes";
import type { ColorSchemeId } from "../display/effects/colorSchemes";
import { COLOR_SCHEMES } from "../display/effects/colorSchemes";
import type { CrtMode } from "../display/effects/effectsStore";
import { CRT_MODES } from "../display/effects/effectsStore";

import type { AgentOs } from "./agentOs";
import type { AgentTool, ToolArgs } from "./agentTool";
import { booleanArg, stringArg } from "./agentTool";

/** The resolution names a model writes; "native" is the browser window's own size. */
const RESOLUTIONS = ["native", "640x480", "800x600", "1024x768"] as const;

function areaOf(resolution: string): DesktopArea | undefined {
  if (resolution === "native") return "current";
  return DESKTOP_AREAS.find((area) => area.value === resolution)?.value;
}

function option<T extends string>(
  args: ToolArgs,
  name: string,
  values: readonly { value: T }[] | readonly { id: T }[],
): T | undefined {
  const wanted = stringArg(args, name);
  for (const entry of values) {
    const value = "value" in entry ? entry.value : entry.id;
    if (value === wanted) return value;
  }
  return undefined;
}

/**
 * Display Properties without the dialog: the colour depth and resolution (Settings), the colour scheme
 * (Appearance) and the CRT monitor (Effects). Every parameter is optional; only the ones given change.
 */
export function createSetDisplayTool(os: Pick<AgentOs, "display">): AgentTool {
  return {
    name: "set_display",
    description:
      "Changes display settings: colour depth, resolution, colour scheme, CRT monitor effect, tube curvature, large fonts. Give only what should change.",
    parameters: [
      {
        name: "color_mode",
        type: "string",
        description: "",
        options: COLOR_MODES.map((mode) => mode.value),
        aliases: {
          "256": "256-colors",
          "16": "16-colors",
          mono: "monochrome",
          "black-and-white": "monochrome",
          "true-colour": "true-color",
        },
      },
      {
        name: "resolution",
        type: "string",
        description: "",
        options: RESOLUTIONS,
        aliases: { current: "native", "640": "640x480", "800": "800x600" },
      },
      {
        name: "scheme",
        type: "string",
        description: "",
        options: COLOR_SCHEMES.map((scheme) => scheme.id),
      },
      {
        name: "crt",
        type: "string",
        description: "full is the whole old-monitor effect",
        options: CRT_MODES.map((mode) => mode.value),
        aliases: { on: "full", true: "full", false: "off", none: "off" },
      },
      { name: "curvature", type: "boolean", description: "" },
      { name: "large_fonts", type: "boolean", description: "" },
    ],
    sentence: () => "Changing the display",
    run: (args) => {
      const changed: string[] = [];
      const colorMode = option<ColorMode>(args, "color_mode", COLOR_MODES);
      if (colorMode) {
        os.display.setColorMode(colorMode);
        changed.push(`colours ${colorMode}`);
      }
      const area = areaOf(stringArg(args, "resolution") ?? "");
      if (area) {
        os.display.setResolution(area);
        changed.push(`resolution ${area === "current" ? "native" : area}`);
      }
      const scheme = option<ColorSchemeId>(args, "scheme", COLOR_SCHEMES);
      if (scheme) {
        os.display.setScheme(scheme);
        changed.push(`scheme ${scheme}`);
      }
      const crt = option<CrtMode>(args, "crt", CRT_MODES);
      if (crt) {
        os.display.setCrt(crt);
        changed.push(`CRT ${crt}`);
      }
      const curvature = booleanArg(args, "curvature");
      if (curvature !== undefined) {
        // The tube only bends with the whole CRT on, as the Effects tab has it.
        if (curvature && (crt ?? os.display.get().crt) !== "full") {
          os.display.setCrt("full");
          changed.push("CRT full");
        }
        os.display.setCurvature(curvature);
        changed.push(`curvature ${curvature ? "on" : "off"}`);
      }
      const largeFonts = booleanArg(args, "large_fonts");
      if (largeFonts !== undefined) {
        os.display.setLargeFonts(largeFonts);
        changed.push(`large fonts ${largeFonts ? "on" : "off"}`);
      }
      return changed.length === 0
        ? {
            ok: false,
            sentence: "Nothing to change on the display",
            observation:
              "set_display needs at least one of color_mode, resolution, scheme, crt, curvature, large_fonts.",
          }
        : { ok: true, sentence: `Display set: ${changed.join(", ")}` };
    },
  };
}

/** The Windows 98 palette by name, for "make the desktop red". */
export const BACKGROUND_COLORS: Readonly<Record<string, string>> = {
  teal: "#008080",
  black: "#000000",
  grey: "#808080",
  silver: "#c0c0c0",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  olive: "#808000",
  yellow: "#ffff00",
  green: "#008000",
  lime: "#00ff00",
  cyan: "#00ffff",
  navy: "#000080",
  blue: "#0000ff",
  purple: "#800080",
  magenta: "#ff00ff",
  violet: "#8000ff",
  brown: "#804000",
};

/** The desktop background as a solid colour; a picture is something only the user's own file dialog can pick. */
export function createSetWallpaperTool(
  os: Pick<AgentOs, "wallpaper">,
): AgentTool {
  const color = (args: ToolArgs) => stringArg(args, "color") ?? "teal";
  return {
    name: "set_wallpaper",
    description:
      "Sets the desktop background to a solid colour (this removes a wallpaper picture).",
    parameters: [
      {
        name: "color",
        type: "string",
        description: "",
        required: true,
        options: Object.keys(BACKGROUND_COLORS),
        aliases: {
          gray: "grey",
          aqua: "cyan",
          pink: "magenta",
          default: "teal",
        },
      },
    ],
    sentence: (args) => `Painting the desktop ${color(args)}`,
    run: (args) => {
      const hex = BACKGROUND_COLORS[color(args)];
      // `coerceArgs` only lets the listed colours through.
      if (!hex)
        return {
          ok: false,
          sentence: `${color(args)} is not a desktop colour`,
        };
      os.wallpaper.setColor(hex);
      return { ok: true, sentence: `The desktop is ${color(args)} now` };
    },
  };
}

/** Display Properties, Screen Saver, Preview. */
export function createScreenSaverTool(
  os: Pick<AgentOs, "screenSaver">,
): AgentTool {
  return {
    name: "screensaver_preview",
    description:
      "Starts the screen saver now; it stops when the user moves the mouse.",
    parameters: [],
    sentence: () => "Starting the screen saver",
    run: () => {
      try {
        os.screenSaver.preview();
      } catch (error) {
        return {
          ok: false,
          sentence:
            error instanceof Error
              ? error.message
              : "The screen saver could not start",
        };
      }
      return { ok: true, sentence: "The screen saver is on" };
    },
  };
}

/** Start, Run; offered only where the desktop has the dialog (`AgentOs.run`). */
export function createRunTool(run: NonNullable<AgentOs["run"]>): AgentTool {
  const command = (args: ToolArgs) => stringArg(args, "command") ?? "";
  return {
    name: "run",
    description: "Types a command into Start, Run.",
    parameters: [
      {
        name: "command",
        type: "string",
        description: "a program name or a path",
        required: true,
      },
    ],
    sentence: (args) => `Running ${command(args)}`,
    run: async (args) => {
      const result = await run.run(command(args));
      return { ok: result.ok, sentence: result.message };
    },
  };
}
