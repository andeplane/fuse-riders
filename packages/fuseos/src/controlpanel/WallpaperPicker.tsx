import { useContext, useEffect, useId, useRef, useState } from "react";

import type { WallpaperSource } from "../desktop/wallpaperStore";
import { WIN98_PALETTE, capitalizedColorName } from "../paint/palette";

import { MediaDepsContext } from "./mediaDepsContext";

export type WallpaperPickerProps = {
  wallpaper: string | undefined;
  onChangeWallpaper: (
    dataUrl: string | undefined,
    source: WallpaperSource,
  ) => void;
  /** The solid desktop colour behind the wallpaper (and shown instead of it once cleared). */
  backgroundColor: string;
  /** Picking a colour clears the wallpaper; the caller (DesktopUiProvider) does that. */
  onChangeColor: (hex: string) => void;
};

/** Control Panel, Display > Background: a wallpaper picture (file or camera) or, as an alternative, a solid Windows 98 palette colour. */
export function WallpaperPicker({
  wallpaper,
  onChangeWallpaper,
  backgroundColor,
  onChangeColor,
}: WallpaperPickerProps) {
  const media = useContext(MediaDepsContext);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const colorLabelId = useId();
  const currentStream = useRef<MediaStream | null>(null);
  const cameraRequest = useRef(0);
  const imageRequest = useRef(0);

  useEffect(
    () => () => {
      cameraRequest.current += 1;
      imageRequest.current += 1;
      currentStream.current
        ?.getTracks()
        .forEach((track: MediaStreamTrack) => track.stop());
      currentStream.current = null;
    },
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.srcObject = stream;
    } catch {
      // Environments without media support (tests) cannot attach a stream.
    }
    return () => {
      video.srcObject = null;
    };
  }, [stream, cameraOpen]);

  const openCamera = async () => {
    const request = ++cameraRequest.current;
    imageRequest.current += 1;
    setError(undefined);
    setCameraOpen(true);
    try {
      const opened = await media.openCamera();
      if (request !== cameraRequest.current) {
        opened.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        return;
      }
      currentStream.current = opened;
      setStream(opened);
    } catch (cause) {
      if (request !== cameraRequest.current) return;
      setCameraOpen(false);
      setError(
        `Could not open the camera: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  const closeCamera = () => {
    cameraRequest.current += 1;
    currentStream.current
      ?.getTracks()
      .forEach((track: MediaStreamTrack) => track.stop());
    currentStream.current = null;
    setStream(null);
    setCapturing(false);
    setCameraOpen(false);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !currentStream.current || capturing) return;
    const request = cameraRequest.current;
    setError(undefined);
    setCapturing(true);
    try {
      const photo = await media.captureFrame(video);
      if (request !== cameraRequest.current) return;
      onChangeWallpaper(photo, "camera");
      closeCamera();
    } catch (cause) {
      if (request !== cameraRequest.current) return;
      setCapturing(false);
      setError(
        `Could not capture a photo: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3"
      style={{ minInlineSize: 0 }}
    >
      <legend>Background</legend>
      {/* A tiny Win98 "Display Properties" style monitor: a raised bezel around the sunken screen, on a stand. */}
      {!cameraOpen ? (
        <>
          <div className="mx-auto flex flex-col items-center">
            <div className="raised bg-[silver] p-2">
              <div
                className="sunken-panel flex h-24 w-32 items-center justify-center overflow-hidden"
                style={{ background: wallpaper ? undefined : backgroundColor }}
                aria-label="Wallpaper preview"
              >
                {wallpaper ? (
                  <img
                    src={wallpaper}
                    alt="Current wallpaper"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span
                    className="text-xs text-white"
                    style={{ textShadow: "1px 1px #000" }}
                  >
                    (None)
                  </span>
                )}
              </div>
            </div>
            <div className="h-2 w-10 bg-[silver]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex" htmlFor={fileId}>
              <span className="sr-only">Browse for an image</span>
            </label>
            <input
              ref={fileRef}
              id={fileId}
              type="file"
              accept="image/*"
              aria-label="Browse..."
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                const request = ++imageRequest.current;
                setError(undefined);
                // The read's outcome lands through state; nothing awaits the handler itself.
                void media
                  .readImageFile(file)
                  .then((image) => {
                    if (request === imageRequest.current)
                      onChangeWallpaper(image, "file");
                  })
                  .catch((cause: unknown) => {
                    if (request === imageRequest.current)
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      );
                  });
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()}>
              Browse...
            </button>
            <button
              type="button"
              disabled={!media.cameraAvailable() || cameraOpen}
              onClick={() => void openCamera()}
            >
              Camera...
            </button>
            <button
              type="button"
              disabled={!wallpaper}
              onClick={() => {
                imageRequest.current += 1;
                onChangeWallpaper(undefined, "none");
              }}
            >
              None
            </button>
          </div>
        </>
      ) : null}
      {cameraOpen ? (
        <div
          className="flex min-w-0 flex-col gap-2"
          role="group"
          aria-label="Camera"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="sunken-panel w-full bg-black"
            style={{
              display: "block",
              width: "100%",
              height: "160px",
              maxHeight: "160px",
              objectFit: "contain",
            }}
            data-testid="camera-preview"
          />
          {!stream ? <p role="status">Starting camera...</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="default"
              disabled={!stream || capturing}
              onClick={() => void capture()}
            >
              Capture
            </button>
            <button type="button" onClick={closeCamera}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-col gap-1">
        <span id={colorLabelId}>
          Background colour (an alternative to the wallpaper)
        </span>
        {/* The Windows 98 palette, reused from Paint (paint/palette.ts) rather than a second one; it already includes the classic teal. */}
        <div
          className="grid grid-flow-col grid-rows-2 gap-0.5"
          role="group"
          aria-labelledby={colorLabelId}
        >
          {WIN98_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={capitalizedColorName(color)}
              aria-pressed={!wallpaper && backgroundColor === color}
              className="h-4 w-4 border border-[grey] p-0"
              style={{
                background: color,
                minWidth: 0,
                minHeight: 0,
                boxShadow: "none",
              }}
              onClick={() => {
                imageRequest.current += 1;
                closeCamera();
                onChangeColor(color);
              }}
            />
          ))}
        </div>
      </div>
      <p className="text-[grey]">
        The wallpaper and background colour are kept in this browser only.
      </p>
    </fieldset>
  );
}
