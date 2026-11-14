import { useEffect, useState } from "react";

import {
  FLOPPY_ZIP_NAME,
  WINZIP_FAILURE_PROGRESS,
  WINZIP_FAKE_ENTRIES,
} from "../disk/floppy";
import { Win98Icon } from "../ui/icons";

export type WinZipDialogProps = {
  /** Milliseconds between progress steps. */
  stepMs?: number;
  /** The "extraction" reached the point where the archive turns out to be corrupt. */
  onFail: () => void;
  onCancel: () => void;
};

export const WINZIP_STEP_MS = 160;
const STEPS = 30;

/**
 * A WinZip-style "Extracting..." box over the Explorer window. The bar creeps up, filenames
 * from a 1997 home directory scroll by, and at 87% it gives up; nothing is ever really unpacked.
 */
export function WinZipDialog({
  stepMs = WINZIP_STEP_MS,
  onFail,
  onCancel,
}: WinZipDialogProps) {
  const [step, setStep] = useState(0);
  const progress = step / STEPS;
  const failed = progress >= WINZIP_FAILURE_PROGRESS;

  useEffect(() => {
    if (failed) return undefined;
    const timer = setInterval(
      () => setStep((current) => Math.min(STEPS, current + 1)),
      stepMs,
    );
    return () => clearInterval(timer);
  }, [failed, stepMs]);

  useEffect(() => {
    if (failed) onFail();
  }, [failed, onFail]);

  const shown = Math.min(
    WINZIP_FAKE_ENTRIES.length,
    Math.floor(progress * (WINZIP_FAKE_ENTRIES.length + 2)),
  );
  const current = WINZIP_FAKE_ENTRIES[Math.max(0, shown - 1)] ?? "";

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/10"
      role="dialog"
      aria-modal="true"
      aria-label={`WinZip - ${FLOPPY_ZIP_NAME}`}
    >
      <div className="window w-80">
        <div className="title-bar">
          <div className="title-bar-text">WinZip - {FLOPPY_ZIP_NAME}</div>
        </div>
        <div className="window-body flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Win98Icon name="zip" size={32} />
            <div className="min-w-0 flex-1">
              <p>Extracting to A:\TEMP\...</p>
              <p className="truncate font-mono text-[10px]" aria-live="polite">
                {current}
              </p>
            </div>
          </div>
          <div
            className="sunken flex h-4 w-full bg-white"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Extracting"
          >
            <div
              className="h-full bg-[navy]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="text-right text-[10px]">
            {shown} of {WINZIP_FAKE_ENTRIES.length} files
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
