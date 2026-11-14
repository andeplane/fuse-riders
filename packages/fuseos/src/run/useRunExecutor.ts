import { useCallback, useContext } from "react";

import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import { FuseGamesContext } from "../fusegames/registry";
import { useFuseGameLauncher } from "../fusegames/useFuseGameLauncher";
import { useDialUpCommands } from "../sounds/dialup/useDialUpCommands";
import { useDesktopBsod } from "../system32/desktopBsod";
import { useSystem32 } from "../system32/System32Provider";

import type { RunTarget } from "./runCommand";
import { resolveRunCommand, runNotFoundMessage } from "./runCommand";

/** A target that runs something: what is left once the empty line and the unknown name are answered. */
export type RunnableTarget = Exclude<
  RunTarget,
  { type: "empty" } | { type: "notFound" }
>;

export type RunOutcome = { ok: boolean; message: string };

export const RUN_EMPTY_MESSAGE =
  "Type the name of a program, folder, document or Internet resource.";

/**
 * Carries out what a Run line resolved to: a program or folder (Network Neighborhood and Fuse Messenger dial
 * in first, as from the Start menu), a Fuse game through the games launcher, a web address in a tab, or the
 * blue screen (the desktop's own where the build has D1, else the SYSTEM32 gag's).
 */
export function useRunExecutor(): (target: RunnableTarget) => void {
  const { openExternal } = useContext(DesktopDepsContext);
  const commands = useDialUpCommands();
  const { launch } = useFuseGameLauncher();
  const desktopBsod = useDesktopBsod();
  const { crash } = useSystem32();
  return useCallback(
    (target: RunnableTarget) => {
      switch (target.type) {
        case "open":
          commands.open(target.content);
          return;
        case "fusegame":
          launch(target.gameId);
          return;
        case "url":
          openExternal(target.url);
          return;
        case "bsod":
          if (desktopBsod) void desktopBsod();
          else crash();
          return;
      }
    },
    [commands, launch, openExternal, desktopBsod, crash],
  );
}

/** What a typed line ran, in words, for a caller with no dialog to show (Clippy's `run` tool). */
export function describeRun(target: RunnableTarget, typed: string): string {
  switch (target.type) {
    case "fusegame":
      return `Started ${target.gameId}`;
    case "url":
      return `Opened ${target.url} in a new tab`;
    case "bsod":
      return "Raised the Blue Screen of Death";
    case "open":
      return `Ran ${typed.trim()}`;
  }
}

/** Resolves and runs one line, answering the way the Run dialog would; for Clippy's agent (`AgentRunContext`). */
export function useRunCommand(): (text: string) => RunOutcome {
  const games = useContext(FuseGamesContext);
  const execute = useRunExecutor();
  return useCallback(
    (text: string) => {
      const target = resolveRunCommand(text, games);
      if (target.type === "empty")
        return { ok: false, message: RUN_EMPTY_MESSAGE };
      if (target.type === "notFound")
        return { ok: false, message: runNotFoundMessage(target.text) };
      execute(target);
      return { ok: true, message: describeRun(target, text) };
    },
    [games, execute],
  );
}
