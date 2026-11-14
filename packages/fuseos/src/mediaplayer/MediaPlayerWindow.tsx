import { Win98Icon } from "../ui/icons";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";

import type { MediaPlayerOptions } from "./useMediaPlayerViewModel";
import { useMediaPlayerViewModel } from "./useMediaPlayerViewModel";

export type MediaPlayerWindowProps = MediaPlayerOptions;

const TRANSPORT: { label: string; glyph: string }[] = [
  { label: "Previous", glyph: "⏮" },
  { label: "Rewind", glyph: "◀◀" },
  { label: "Fast forward", glyph: "▶▶" },
  { label: "Next", glyph: "⏭" },
];

/**
 * A Windows Media Player 6.4 lookalike: menu bar, a black screen that only ever shows the
 * buffering percentage, a seek bar that never moves and the transport buttons. The codec
 * error is a box over the screen, as the real one was.
 */
export function MediaPlayerWindow(props: MediaPlayerWindowProps) {
  const vm = useMediaPlayerViewModel(props);
  const buffering = vm.playback.phase === "buffering";
  const progress = vm.playback.phase === "buffering" ? vm.playback.progress : 0;
  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "Open...", disabled: true },
        { label: "Properties", disabled: true },
        { separator: true },
        { label: "Close", onSelect: vm.close },
      ],
    },
    {
      label: "Play",
      items: [
        { label: "Play", onSelect: vm.play, disabled: buffering },
        { label: "Stop", onSelect: vm.stop, disabled: !buffering },
        { separator: true },
        { label: "Repeat", disabled: true, checked: false },
      ],
    },
    {
      label: "Help",
      items: [{ label: "About Windows Media Player", onSelect: vm.about }],
    },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MenuBar menus={menus} />
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1">
        <div
          className="sunken flex min-h-0 flex-1 items-center justify-center bg-black text-white"
          role="img"
          aria-label={`Video: ${vm.status}`}
        >
          {vm.stream && vm.playback.phase === "playing" ? (
            <iframe
              className="h-full w-full border-0"
              title={vm.stream.title}
              src={vm.stream.embedUrl}
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <span className="font-mono text-sm">
              {buffering
                ? vm.status
                : vm.playback.phase === "playing"
                  ? "▶"
                  : ""}
            </span>
          )}
        </div>
        {vm.stream && vm.playback.phase === "playing" ? (
          <p className="text-right">
            Not playing?{" "}
            <a
              href={vm.stream.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on YouTube
            </a>
          </p>
        ) : null}
        <div
          className="sunken flex h-3 w-full bg-white"
          role="progressbar"
          aria-label="Buffered"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="h-full bg-[navy]" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="min-w-0 px-2"
            aria-label="Play"
            disabled={buffering}
            onClick={vm.play}
          >
            ▶
          </button>
          <button
            type="button"
            className="min-w-0 px-2"
            aria-label="Pause"
            disabled
          >
            ❚❚
          </button>
          <button
            type="button"
            className="min-w-0 px-2"
            aria-label="Stop"
            disabled={!buffering}
            onClick={vm.stop}
          >
            ■
          </button>
          <span className="mx-1 h-5 w-px bg-[grey]" aria-hidden />
          {TRANSPORT.map((button) => (
            <button
              key={button.label}
              type="button"
              className="min-w-0 px-2"
              aria-label={button.label}
              disabled
            >
              {button.glyph}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-[grey]" aria-hidden />
          <button
            type="button"
            className="min-w-0 px-2"
            aria-label="Mute"
            disabled
          >
            🔈
          </button>
        </div>
      </div>
      <footer className="status-bar shrink-0">
        <p className="status-bar-field">{vm.status}</p>
        <p className="status-bar-field w-2/5 text-right">{vm.time}</p>
      </footer>
      {vm.playback.phase === "error" ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/10"
          role="dialog"
          aria-modal="true"
          aria-label="Windows Media Player"
        >
          <div className="window" style={{ width: 300 }}>
            <div className="title-bar">
              <div className="title-bar-text">Windows Media Player</div>
            </div>
            <div className="window-body flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <Win98Icon name="warning" size={32} />
                <p className="whitespace-pre-wrap">{vm.playback.message}</p>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  className="default"
                  onClick={vm.dismissError}
                  autoFocus
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
