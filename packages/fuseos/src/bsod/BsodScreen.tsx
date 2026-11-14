import { useEffect, useRef } from "react";

import "./bsod.css";
import { bsodMessage } from "./bsodMessage";

export type BsodScreenProps = {
  /** The executable the screen blames, e.g. "FUSEBALL.EXE". */
  culprit: string;
  /** A click or tap anywhere; keys are the provider's business, since they must be caught before the desktop sees them. */
  onDismiss: () => void;
};

/**
 * The Windows 95 Blue Screen of Death, over everything. It takes the keyboard focus while it
 * is up (so "any key" reaches the OS document even when a game iframe had the focus, e.g.
 * when raised from the Run dialog) and gives it back to whatever had it on the way out.
 */
export function BsodScreen({ culprit, onDismiss }: BsodScreenProps) {
  const ref = useRef<HTMLDivElement>(null);
  const message = bsodMessage(culprit);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  return (
    <div
      ref={ref}
      className="bsod"
      role="alertdialog"
      aria-modal="true"
      aria-label="Windows fatal exception"
      aria-describedby="bsod-summary"
      tabIndex={-1}
      data-testid="bsod"
      onPointerDown={(event) => {
        // Keep the click from landing on the desktop underneath as a focus change.
        event.preventDefault();
        onDismiss();
      }}
    >
      <div className="bsod__text">
        <p className="bsod__title-row">
          <span className="bsod__title">{message.title}</span>
        </p>
        <p className="bsod__summary" id="bsod-summary">
          {message.summary}
        </p>
        <ul className="bsod__instructions">
          {message.instructions.map((line) => (
            <li key={line}>*&nbsp;&nbsp;{line}</li>
          ))}
        </ul>
        <p className="bsod__prompt">
          {message.prompt}{" "}
          <span className="bsod__cursor" aria-hidden="true">
            _
          </span>
        </p>
      </div>
    </div>
  );
}
