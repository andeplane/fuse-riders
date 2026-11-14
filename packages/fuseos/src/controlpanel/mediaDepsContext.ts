import { createContext } from "react";

export const MAX_WALLPAPER_EDGE = 1600;

/** Browser media access for the wallpaper picker, injected so tests never touch the camera or canvas. */
export type MediaDeps = {
  /** Reads a picked image file and returns a downscaled JPEG data url. */
  readImageFile: (file: Blob) => Promise<string>;
  /** Opens the camera; the caller stops the tracks when done. */
  openCamera: () => Promise<MediaStream>;
  /** Grabs the current frame of a playing video as a downscaled JPEG data url. */
  captureFrame: (video: HTMLVideoElement) => Promise<string>;
  cameraAvailable: () => boolean;
};

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): string {
  const scale = Math.min(1, MAX_WALLPAPER_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read the image"));
    image.src = url;
  });
}

export const defaultMediaDeps: MediaDeps = {
  async readImageFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      return drawScaled(image, image.naturalWidth, image.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  openCamera: () =>
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    }),
  async captureFrame(video) {
    return drawScaled(video, video.videoWidth || 640, video.videoHeight || 480);
  },
  cameraAvailable: () =>
    typeof navigator !== "undefined" &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === "function",
};

export const MediaDepsContext = createContext<MediaDeps>(defaultMediaDeps);
