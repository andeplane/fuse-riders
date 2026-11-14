import { useCallback, useContext, useMemo, useState } from "react";

import { MY_COMPUTER } from "../disk/diskPath";
import { FuseGamesContext } from "../fusegames/registry";
import { useDialUpCommands } from "../sounds/dialup/useDialUpCommands";

import {
  resolveRunCommand,
  RUN_NOT_FOUND_TITLE,
  runNotFoundMessage,
  runSuggestions,
} from "./runCommand";
import { useRunExecutor } from "./useRunExecutor";

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
  const commands = useDialUpCommands();
  const execute = useRunExecutor();
  const [text, setText] = useState("");

  const cancel = useCallback(
    () => commands.close(windowId),
    [commands, windowId],
  );

  const run = useCallback(() => {
    const target = resolveRunCommand(text, games);
    if (target.type === "empty") return;
    if (target.type === "notFound") {
      commands.showError(RUN_NOT_FOUND_TITLE, runNotFoundMessage(target.text));
      return;
    }
    commands.close(windowId);
    execute(target);
  }, [text, games, commands, windowId, execute]);

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
