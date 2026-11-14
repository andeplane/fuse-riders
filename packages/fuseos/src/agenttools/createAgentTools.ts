import type { AgentOs } from "./agentOs";
import type { AgentTool } from "./agentTool";
import {
  createDesktopStateTool,
  createLaunchGameTool,
  createListGamesTool,
  createOpenAppTool,
} from "./appTools";
import type { AgentEditUndo } from "./diskTools";
import {
  createEditFileTools,
  createExplorerOpenTool,
  createListDirTool,
  createReadFileTool,
} from "./diskTools";
import {
  createRunTool,
  createScreenSaverTool,
  createSetDisplayTool,
  createSetWallpaperTool,
} from "./displayTools";
import { createMusicTool } from "./mediaTools";
import {
  createShowMessageTool,
  createStartMenuTool,
  createWindowTools,
} from "./windowTools";

/**
 * Every typed tool Clippy has over a desktop, in the order the prompt lists them: looking first, then
 * programs and windows, the disk, music, the display. `run` is offered only where the desktop has a Run dialog.
 */
export function createAgentTools(
  os: AgentOs,
  undo: { current: AgentEditUndo | undefined },
): AgentTool[] {
  return [
    createDesktopStateTool(os),
    createOpenAppTool(os),
    createLaunchGameTool(os),
    createListGamesTool(os),
    ...createWindowTools(os),
    createStartMenuTool(os),
    createExplorerOpenTool(os),
    createListDirTool(os),
    createReadFileTool(os),
    ...createEditFileTools(os, undo),
    createMusicTool(os),
    createSetDisplayTool(os),
    createSetWallpaperTool(os),
    createScreenSaverTool(os),
    ...(os.run ? [createRunTool(os.run)] : []),
    createShowMessageTool(os),
  ];
}
