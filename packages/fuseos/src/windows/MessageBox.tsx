import { useEffect } from "react";

import { usePlaySystemSound } from "../sounds/useSystemSound";
import { Win98Icon } from "../ui/icons";

export type MessageBoxProps = {
  message: string;
  icon: "warning" | "info";
  onOk: () => void;
  /** Whether this is the box that has the keyboard: Enter and Esc press OK only then. Defaults to true. */
  active?: boolean;
};

/** The widest the text column grows before it wraps, as in Windows 98. */
export const MESSAGE_BOX_TEXT_MAX_WIDTH = 340;

/**
 * Body of a Win98 message box: a 32x32 icon with the text beside it and OK centred below, tight
 * padding, sized by its content (the modal layer shrink-wraps it). Opening one plays the critical
 * stop chord or the default ding; Enter and Esc press OK.
 */
export function MessageBox({
  message,
  icon,
  onOk,
  active = true,
}: MessageBoxProps) {
  const playSystemSound = usePlaySystemSound();
  useEffect(() => {
    playSystemSound(icon === "warning" ? "error" : "ding");
  }, [icon, playSystemSound]);
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      onOk();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onOk]);
  return (
    <div
      className="window-body flex flex-col gap-3"
      style={{ margin: 0, padding: 12 }}
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0">
          <Win98Icon name={icon} size={32} />
        </span>
        <p
          className="min-w-0 whitespace-pre-wrap"
          style={{
            maxWidth: MESSAGE_BOX_TEXT_MAX_WIDTH,
            overflowWrap: "anywhere",
          }}
        >
          {message}
        </p>
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          className="default"
          style={{ width: 75, height: 23, minWidth: 75 }}
          onClick={onOk}
          autoFocus
        >
          OK
        </button>
      </div>
    </div>
  );
}
