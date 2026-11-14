import { Win98Icon } from "../ui/icons";

import type { ConfirmStep } from "./system32Machine";
import { CONFIRMATIONS } from "./system32Machine";

export type System32ConfirmDialogProps = {
  step: ConfirmStep;
  onYes: () => void;
  onNo: () => void;
};

/**
 * One of the three escalating questions, as a modal Win98 message box over the desktop. Escape
 * is "No"; the dialog is its own small window rather than an app window so the fold can start
 * from any screen without touching the window manager.
 */
export function System32ConfirmDialog({
  step,
  onYes,
  onNo,
}: System32ConfirmDialogProps) {
  const question = CONFIRMATIONS[step];
  if (!question) return null;
  return (
    <div
      className="s32-modal win98"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") onNo();
      }}
    >
      <section
        className="window s32-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={question.title}
        aria-describedby={`s32-question-${step}`}
        data-step={step}
      >
        <header className="title-bar">
          <div className="title-bar-text">{question.title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onNo} />
          </div>
        </header>
        <div className="window-body flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Win98Icon name="warning" size={32} />
            <p id={`s32-question-${step}`} className="whitespace-pre-wrap">
              {question.message}
            </p>
          </div>
          <div className="flex justify-center gap-2">
            <button type="button" className="default" onClick={onYes} autoFocus>
              Yes
            </button>
            <button type="button" onClick={onNo}>
              No
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
