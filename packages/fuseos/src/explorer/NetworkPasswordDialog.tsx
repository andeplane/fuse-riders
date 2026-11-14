import type { FormEvent } from "react";
import { useState } from "react";

import {
  PASSWORD_DIALOG_TITLE,
  PASSWORD_PROMPT,
  PORN_RESOURCE,
} from "../disk/floppy";
import { Win98Icon } from "../ui/icons";

import type { PasswordPrompt } from "./useExplorerViewModel";

export type NetworkPasswordDialogProps = {
  prompt: PasswordPrompt;
  /** Returns whether the password got in; a wrong one clears the field for another go. */
  onSubmit: (password: string) => "granted" | "denied";
  onCancel: () => void;
};

export const CONNECTING_STATUS = `Connecting to ${PORN_RESOURCE}...`;
export const GRANTED_STATUS = "Access granted.";

/**
 * Windows 98's "Enter Network Password" box over the Explorer window, as it asked for a share's
 * password: the keys, the resource as a UNC path, a masked field, and OK/Cancel stacked on the right.
 * After the right password it says it is connecting and then lets you in.
 */
export function NetworkPasswordDialog({
  prompt,
  onSubmit,
  onCancel,
}: NetworkPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(false);
  const busy = prompt.phase !== "asking";
  const status =
    prompt.phase === "connecting"
      ? CONNECTING_STATUS
      : prompt.phase === "granted"
        ? GRANTED_STATUS
        : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (onSubmit(password) === "denied") setPassword("");
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/10"
      role="dialog"
      aria-modal="true"
      aria-label={PASSWORD_DIALOG_TITLE}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onCancel();
      }}
    >
      <form className="window" style={{ width: 380 }} onSubmit={submit}>
        <div className="title-bar">
          <div className="title-bar-text">{PASSWORD_DIALOG_TITLE}</div>
          <div className="title-bar-controls">
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={onCancel}
            />
          </div>
        </div>
        <div className="window-body flex gap-3">
          <Win98Icon name="keys" size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p>{PASSWORD_PROMPT}</p>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
              <span>Resource:</span>
              <span data-testid="password-resource">{PORN_RESOURCE}</span>
              <label htmlFor="network-password">Password:</label>
              <input
                id="network-password"
                type="password"
                autoComplete="off"
                autoFocus
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="field-row">
              <input
                id="network-password-save"
                type="checkbox"
                disabled={busy}
                checked={save}
                onChange={(event) => setSave(event.target.checked)}
              />
              <label htmlFor="network-password-save">
                Save this password in your password list
              </label>
            </div>
            <p aria-live="polite" className="min-h-4">
              {status}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <button type="submit" className="default" disabled={busy}>
              OK
            </button>
            <button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
