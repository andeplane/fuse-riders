import { useEffect, useRef } from "react";

export const BSOD_HEADLINE =
  "A problem has been detected and FuseOS has been shut down to prevent damage to your games.";

export const BSOD_STOP_CODE =
  "*** STOP: 0x0000005Y (0xC0FFEE32, 0xDEADBEEF, 0x00000000, 0x00000001)";

export type BlueScreenProps = {
  /** Any key, click or tap: the restart follows. */
  onAnyKey: () => void;
};

/**
 * The provider's own blue screen, used when the host injects no `showBsod`. Covers the whole
 * viewport; takes focus so the first key press restarts, and restarts by itself after a while.
 */
export function BlueScreen({ onAnyKey }: BlueScreenProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className="s32-bsod"
      role="alert"
      aria-label="FuseOS has crashed"
      tabIndex={-1}
      onKeyDown={onAnyKey}
      onClick={onAnyKey}
    >
      <p className="s32-bsod-title">FuseOS</p>
      <p>{BSOD_HEADLINE}</p>
      <p>SYSTEM32_NOT_FOUND</p>
      <p>
        If this is the first time you&apos;ve seen this stop error screen,
        restart your computer. If this screen appears again, follow these steps:
      </p>
      <p>
        Check to make sure the folder you removed was not, in fact, the
        operating system. Removing the operating system is not a supported way
        of freeing up disk space.
      </p>
      <p>Technical information:</p>
      <p>{BSOD_STOP_CODE}</p>
      <p>
        *** SYSTEM32.DLL - Address 0x1998 base at 0x0000, DateStamp 0x3593e2c0
      </p>
      <p className="s32-bsod-hint">Press any key to restart FuseOS _</p>
    </div>
  );
}

/** The black "restarting" screen between the blue screen and the restored desktop. */
export function RestartScreen() {
  return (
    <div
      className="s32-restart"
      role="status"
      aria-label="FuseOS is restarting"
    >
      <p>FuseOS is restarting...</p>
      <p className="s32-restart-sub">Reinstalling SYSTEM32 from the cloud.</p>
      <div className="s32-restart-bar" aria-hidden>
        <div className="s32-restart-fill" />
      </div>
    </div>
  );
}
