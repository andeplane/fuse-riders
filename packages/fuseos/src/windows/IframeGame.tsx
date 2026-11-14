import { useEffect, useRef } from "react";

export type IframeGameProps = {
  name: string;
  url: string;
  active: boolean;
  onActivate: () => void;
  /** Shown behind the frame until the page paints, so the window is not black while a game loads. */
  backdropUrl?: string;
};

/** What a game page inside the OS may do; everything the Fuse games use (fullscreen, audio, voice, gamepads, copying invites). */
export const GAME_IFRAME_ALLOW =
  "fullscreen; autoplay; microphone; camera; gamepad; clipboard-write";

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
}: IframeGameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
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
        ref={frame}
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
