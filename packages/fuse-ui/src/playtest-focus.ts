/** Explicit focus transitions, shared by FuseOS and the recorder. No timer samples activeElement. */
export const PLAYTEST_GAME_FOCUS = "fuse-playtest-game-focus";

export function announcePlaytestGame(win: Window, gameId: string): void {
  (win.top ?? win).postMessage(
    { type: PLAYTEST_GAME_FOCUS, gameId },
    win.location.origin,
  );
}

export interface PlaytestGameFocusOptions {
  document: Document;
  window: Window;
  gameId: string;
  knownGames: ReadonlySet<string>;
  changed(gameId: string): void;
}

export interface PlaytestFocusSource {
  source: MessageEventSource | null;
  origin: string;
  gameId: string;
}

/** Validate the untrusted cross-window message before changing capture context. */
export function playtestFocusGame(
  event: Pick<MessageEvent<unknown>, "source" | "origin" | "data">,
  origin: string,
  desktop: Window,
  frames: readonly PlaytestFocusSource[],
  knownGames: ReadonlySet<string>,
): string | undefined {
  if (
    event.origin !== origin ||
    !event.source ||
    !event.data ||
    typeof event.data !== "object"
  )
    return;
  const data = event.data as { type?: unknown; gameId?: unknown };
  if (
    data.type !== PLAYTEST_GAME_FOCUS ||
    typeof data.gameId !== "string" ||
    !knownGames.has(data.gameId)
  )
    return;
  if (
    event.source === desktop ||
    frames.some(
      (frame) =>
        frame.source === event.source &&
        frame.origin === origin &&
        frame.gameId === data.gameId,
    )
  )
    return data.gameId;
  return;
}

/** Only the desktop itself or a current same-origin game frame may change attribution. */
export function installPlaytestGameFocus(options: PlaytestGameFocusOptions): {
  current(): string;
  subscribe(changed: (gameId: string) => void): () => void;
} {
  const { document: doc, window: win, gameId, knownGames } = options;
  let current = gameId;
  const listeners = new Set<(gameId: string) => void>();
  const isOwner = win.top === win.self;
  if (isOwner) {
    win.addEventListener("message", (event: MessageEvent<unknown>) => {
      const frames: PlaytestFocusSource[] = [];
      for (const frame of doc.querySelectorAll("iframe")) {
        try {
          const location = frame.contentWindow?.location;
          if (location)
            frames.push({
              source: frame.contentWindow,
              origin: location.origin,
              gameId: location.pathname.split("/").filter(Boolean).at(-1) ?? "",
            });
        } catch {
          // An embedded third-party page has no trusted game identity.
        }
      }
      const game = playtestFocusGame(
        event,
        win.location.origin,
        win,
        frames,
        knownGames,
      );
      if (!game || current === game) return;
      current = game;
      options.changed(current);
      for (const listener of listeners) listener(current);
    });
  } else {
    const announce = () => announcePlaytestGame(win, gameId);
    // Input within an iframe does not bubble to FuseOS. Include keyboard focus
    // and pointer focus, even when a frame was already the browser activeElement.
    doc.addEventListener("pointerdown", announce, true);
    doc.addEventListener("keydown", announce, true);
    win.addEventListener("focus", announce);
  }
  return {
    current: () => current,
    subscribe(changed) {
      listeners.add(changed);
      return () => {
        listeners.delete(changed);
      };
    },
  };
}
