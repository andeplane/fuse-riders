import type { FuseGame } from "../fusegames/registry";
import { Win98Icon } from "../ui/icons";

import { ROOM_CODE_LENGTH } from "./roomCode";
import type { JoinDialogState } from "./useNetworkViewModel";

export type JoinRoomDialogProps = {
  dialog: JoinDialogState;
  games: readonly FuseGame[];
  onGameChange: (gameId: string) => void;
  onCodeChange: (code: string) => void;
  onJoin: () => void;
  onCancel: () => void;
};

/** "Join room": pick the game, type the four-character code a friend gave you. Sits over the window's panes. */
export function JoinRoomDialog({
  dialog,
  games,
  onGameChange,
  onCodeChange,
  onJoin,
  onCancel,
}: JoinRoomDialogProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20">
      <form
        className="window w-80"
        role="dialog"
        aria-modal="true"
        aria-label="Join room"
        onSubmit={(event) => {
          event.preventDefault();
          onJoin();
        }}
      >
        <div className="title-bar">
          <div className="title-bar-text flex items-center gap-1">
            <Win98Icon name="network" />
            <span>Join room</span>
          </div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onCancel} />
          </div>
        </div>
        <div className="window-body flex flex-col gap-3">
          <p>Type the room code your friend sees in their game.</p>
          <div className="field-row-stacked">
            <label htmlFor="join-room-game">Game</label>
            <select
              id="join-room-game"
              value={dialog.gameId}
              onChange={(event) => onGameChange(event.target.value)}
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row-stacked">
            <label htmlFor="join-room-code">Room code</label>
            <input
              id="join-room-code"
              type="text"
              value={dialog.code}
              maxLength={ROOM_CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="AB42"
              className="font-mono uppercase tracking-wider"
              aria-invalid={dialog.error !== null}
              aria-describedby={dialog.error ? "join-room-error" : undefined}
              onChange={(event) => onCodeChange(event.target.value)}
            />
          </div>
          {dialog.error ? (
            <p
              id="join-room-error"
              role="alert"
              className="flex items-center gap-2"
            >
              <Win98Icon name="warning" />
              <span>{dialog.error}</span>
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="submit" className="default">
              Join
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
