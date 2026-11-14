import type { WindowContent } from "../../state/appState";
import { Win98Icon } from "../../ui/icons";

import { useDialUpViewModel } from "./useDialUpViewModel";

export const DIAL_UP_NETWORK_NAME = "Fuse Network";

/**
 * Dial-Up Networking's "Connect To" dialog. Connect runs the modem handshake (the sound and
 * the status lines it is timed to), then closes and opens `then` when there is one; Cancel
 * skips straight to it. Start > Programs > Accessories > Dial-Up Networking opens it bare.
 */
export function DialUpWindow({
  windowId,
  then,
}: {
  windowId: string;
  then?: WindowContent;
}) {
  const vm = useDialUpViewModel({ windowId, then });
  if (vm.stage === "idle")
    return (
      <form
        className="window-body flex flex-col gap-3"
        aria-label="Connect To"
        onSubmit={(event) => {
          event.preventDefault();
          vm.connect();
        }}
      >
        <div className="flex items-center gap-3">
          <Win98Icon name="dialup" size={32} />
          <span className="text-base font-bold">{DIAL_UP_NETWORK_NAME}</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          <label htmlFor="dialup-user">User name:</label>
          <input id="dialup-user" type="text" defaultValue="guest" />
          <label htmlFor="dialup-password">Password:</label>
          <input
            id="dialup-password"
            type="password"
            defaultValue="hunter2"
            autoComplete="off"
          />
          <span />
          <div className="field-row">
            <input id="dialup-save" type="checkbox" defaultChecked />
            <label htmlFor="dialup-save">Save password</label>
          </div>
          <label htmlFor="dialup-phone">Phone number:</label>
          <input
            id="dialup-phone"
            type="text"
            value={vm.phoneNumber}
            readOnly
          />
          <label htmlFor="dialup-from">Dialing from:</label>
          <input
            id="dialup-from"
            type="text"
            value="Default Location"
            readOnly
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="submit" className="default">
            Connect
          </button>
          <button type="button" onClick={vm.cancel}>
            Cancel
          </button>
        </div>
      </form>
    );
  return (
    <div className="window-body flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Win98Icon name="dialup" size={32} />
        <div>
          <p className="font-bold">Connecting to {DIAL_UP_NETWORK_NAME}</p>
          <p role="status" aria-live="polite">
            Status: {vm.status}
          </p>
        </div>
      </div>
      <div
        className="progress-indicator segmented"
        role="progressbar"
        aria-label="Connection progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(vm.progress * 100)}
      >
        <span
          className="progress-indicator-bar"
          style={{ width: `${Math.round(vm.progress * 100)}%` }}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={vm.cancel}
          disabled={vm.stage === "connected"}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
