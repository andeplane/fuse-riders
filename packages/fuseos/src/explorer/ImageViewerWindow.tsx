import { useState } from "react";

import { useDiskDeps, useDiskManifest } from "../disk/useDisk";
import { NOT_ON_GITHUB_NOTICE } from "../disk/diskSource";

export type ImageViewerWindowProps = { path: string };

/**
 * A picture from the C: drive, read-only. Paint's "open an image URL" is Phase B5's; until that
 * lands on this branch Explorer opens images here (see docs/fuseos/disk.md, "Images").
 */
export function ImageViewerWindow({ path }: ImageViewerWindowProps) {
  const { source } = useDiskDeps();
  const manifest = useDiskManifest();
  // The build's commit may not be on GitHub: try it, then the fallback branch, then give up.
  const [attempt, setAttempt] = useState<"commit" | "fallback" | "failed">(
    "commit",
  );
  const name = path.slice(path.lastIndexOf("/") + 1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[grey] px-1 py-0.5">
        <span className="truncate">C:\{path.replaceAll("/", "\\")}</span>
      </div>
      <div className="sunken-panel flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[grey] p-2">
        {manifest.status === "loading" ? (
          <p className="bg-white p-2">Reading drive C:...</p>
        ) : manifest.status === "error" ? (
          <p className="bg-white p-2">{manifest.message}</p>
        ) : attempt === "failed" ? (
          <p className="bg-white p-2">
            {name} could not be shown: GitHub did not return it.
          </p>
        ) : (
          <img
            key={attempt}
            src={source.fileUrl(
              manifest.manifest,
              path,
              attempt === "fallback",
            )}
            alt={name}
            className="max-h-full max-w-full bg-white"
            style={{ imageRendering: "pixelated" }}
            onError={() =>
              setAttempt(attempt === "commit" ? "fallback" : "failed")
            }
          />
        )}
      </div>
      <footer className="status-bar shrink-0">
        <p className="status-bar-field flex-1 truncate">
          {attempt === "fallback" ? NOT_ON_GITHUB_NOTICE : name}
        </p>
      </footer>
    </div>
  );
}
