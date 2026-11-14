import { useCallback, useContext, useMemo, useState } from "react";

import { DesktopDepsContext } from "../desktop/desktopDepsContext";
import { MY_COMPUTER } from "../disk/diskPath";
import { FuseGamesContext } from "../fusegames/registry";
import { useFuseGameLauncher } from "../fusegames/useFuseGameLauncher";
import { useDesktopBsod } from "../system32/desktopBsod";
import { useSystem32 } from "../system32/System32Provider";
import { useWindowCommands } from "../windows/useWindowCommands";

import {
  resolveRunCommand,
  RUN_NOT_FOUND_TITLE,
  runNotFoundMessage,
  runSuggestions,
} from "./runCommand";

export type RunViewModel = {
  text: string;
  setText: (text: string) => void;
  /** Names the Open box offers. */
  suggestions: string[];
  /** OK: runs the line and closes the dialog; a name nothing answers to leaves it open under an error box. */
  run: () => void;
  /** Browse...: My Computer, to look for the program by hand. */
  browse: () => void;
  cancel: () => void;
};

/** Start > Run...: one line, opened as a program, a game, a folder, a web address or the blue screen. */
export function useRunViewModel(windowId: string): RunViewModel {
  const games = useContext(FuseGamesContext);
  const { openExternal } = useContext(DesktopDepsContext);
  const commands = useWindowCommands();
  const { launch } = useFuseGameLauncher();
  // The desktop's Blue Screen of Death where the build has one (D1), else the SYSTEM32 gag's own.
  const desktopBsod = useDesktopBsod();
  const { crash } = useSystem32();
  const [text, setText] = useState("");

  const cancel = useCallback(
    () => commands.close(windowId),
    [commands, windowId],
  );

  const run = useCallback(() => {
    const target = resolveRunCommand(text, games);
    switch (target.type) {
      case "empty":
        return;
      case "notFound":
        commands.showError(
          RUN_NOT_FOUND_TITLE,
          runNotFoundMessage(target.text),
        );
        return;
      case "open":
        commands.close(windowId);
        commands.open(target.content);
        return;
      case "fusegame":
        commands.close(windowId);
        launch(target.gameId);
        return;
      case "url":
        commands.close(windowId);
        openExternal(target.url);
        return;
      case "bsod":
        commands.close(windowId);
        if (desktopBsod) void desktopBsod();
        else crash();
        return;
    }
  }, [
    text,
    games,
    commands,
    windowId,
    launch,
    openExternal,
    desktopBsod,
    crash,
  ]);

  const browse = useCallback(() => {
    commands.close(windowId);
    commands.open({ kind: "explorer", location: MY_COMPUTER });
  }, [commands, windowId]);

  const suggestions = useMemo(
    () => runSuggestions(games.games.map((game) => game.id)),
    [games],
  );

  return { text, setText, suggestions, run, browse, cancel };
}
