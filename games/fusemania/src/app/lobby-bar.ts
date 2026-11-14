import { createOptionsMenu, type OptionsMenu } from "./options.js";

export interface LobbyBar {
  /** OPTIONS, with the speeds and a room's session in the panel under it. */
  menu: OptionsMenu;
  /** For the room's header, before Settings and START. */
  headerActions: readonly Node[];
  /** Under the players: the song select and what the session is at. Never the speeds. */
  modes: readonly Node[];
}

/**
 * What a Fusemania room hands the shared room layout. The rule it keeps: a room's top is Back, OPTIONS, Settings
 * and START, as the menu's own song select has them, and a player's speed lives behind OPTIONS. The speeds are
 * never a row in the lobby, and START is never under the song select.
 */
export function createLobbyBar(parts: {
  document: Document;
  /** The song select. */
  picker: HTMLElement;
  /** `createPlayOptions().element`: the speeds, and a host's session. */
  options: HTMLElement;
  /** Where a session is at: "SONG 2 OF 5". */
  session: HTMLElement;
}): LobbyBar {
  const menu = createOptionsMenu({
    document: parts.document,
    content: [parts.options],
  });
  return {
    menu,
    headerActions: [menu.element],
    modes: [parts.picker, parts.session],
  };
}
