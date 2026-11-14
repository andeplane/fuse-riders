import { useEffect, useRef } from "react";

export type IframeGameProps = {
  name: string;
  url: string;
  active: boolean;
  onActivate: () => void;
  /** Shown behind the frame until the page paints, so the window is not black while a game loads. */
  backdropUrl?: string;
  /** Called with the frame element when it mounts and `null` when it unmounts, for a caller that reads where the page has navigated to (Pop out). */
  onFrame?: (frame: HTMLIFrameElement | null) => void;
};

/** What a game page inside the OS may do; everything the Fuse games use (fullscreen, audio, voice, gamepads, copying invites). */
export const GAME_IFRAME_ALLOW =
  "fullscreen; autoplay; microphone; camera; gamepad; clipboard-write";

/** The slice of an iframe `liveFrameUrl` reads; an `HTMLIFrameElement`, or a plain object in a test. */
export type GameFrame = {
  readonly contentWindow: {
    readonly location: { readonly href: string };
  } | null;
};

/**
 * The address a same-origin frame is showing now (a game that has entered a room carries `?room=`), or the
 * address it was given when the page cannot be read: not loaded yet, a cross-origin page, or no frame at all.
 */
export function liveFrameUrl(
  frame: GameFrame | null | undefined,
  fallback: string,
): string {
  try {
    const href = frame?.contentWindow?.location.href;
    return href && href !== "about:blank" ? href : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A game page from our own origin inside the window. While the window is inactive a transparent shield sits
 * over the frame so the first click brings the window to the front (like Windows 98) and window dragging is
 * not swallowed by the frame. An active window hands keyboard focus to the frame, so a game answers keys at once.
 */
export function IframeGame({
  name,
  url,
  active,
  onActivate,
  backdropUrl,
  onFrame,
}: IframeGameProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (active) frame.current?.focus();
  }, [active]);
  return (
    <div
      className="relative min-h-0 flex-1 bg-black"
      style={
        backdropUrl
          ? {
              backgroundImage: `url(${backdropUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      <iframe
        ref={(element) => {
          frame.current = element;
          onFrame?.(element);
        }}
        title={name}
        src={url}
        className="block h-full w-full border-0"
        allow={GAME_IFRAME_ALLOW}
        allowFullScreen
      />
      {active ? null : (
        <button
          type="button"
          aria-label={`Activate ${name}`}
          className="absolute inset-0 cursor-default bg-transparent"
          style={{ minWidth: 0, boxShadow: "none" }}
          onMouseDown={onActivate}
        />
      )}
    </div>
  );
}
