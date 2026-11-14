import type { ChangeEvent } from "react";

import { Win98Icon } from "../ui/icons";

import { HourglassIcon } from "./HourglassIcon";
import type { HallOfFameColumn, HallOfFameEntry } from "./leaderboard";
import { TrophyIcon } from "./TrophyIcon";
import type { HallOfFameViewModel } from "./useHallOfFameViewModel";
import { useHallOfFameViewModel } from "./useHallOfFameViewModel";

import "./halloffame.css";

const COLUMNS: readonly {
  column: HallOfFameColumn;
  label: string;
  width: string;
}[] = [
  { column: "rank", label: "Rank", width: "4.5em" },
  { column: "name", label: "Player", width: "auto" },
  { column: "elo", label: "Elo", width: "4.5em" },
  { column: "rounds", label: "Rounds", width: "5em" },
  { column: "games", label: "Matches", width: "5.5em" },
];

const PODIUM = ["gold", "silver", "bronze"] as const;

function RankCell({ entry }: { entry: HallOfFameEntry }) {
  const metal = PODIUM[entry.rank - 1];
  return (
    <span className="halloffame-rank">
      {metal ? (
        <TrophyIcon metal={metal} width={16} height={16} />
      ) : (
        <span aria-hidden style={{ display: "inline-block", width: 16 }} />
      )}
      {entry.rank}
    </span>
  );
}

function HeaderButton({
  column,
  label,
  vm,
}: {
  column: HallOfFameColumn;
  label: string;
  vm: HallOfFameViewModel;
}) {
  const sorted = vm.sort.column === column;
  const ariaSort = sorted
    ? vm.sort.direction === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <th scope="col" aria-sort={ariaSort}>
      <button type="button" onClick={() => vm.sortBy(column)}>
        <span>{label}</span>
        {sorted ? (
          <span aria-hidden>{vm.sort.direction === "asc" ? "▲" : "▼"}</span>
        ) : null}
      </button>
    </th>
  );
}

function ListBody({ vm }: { vm: HallOfFameViewModel }) {
  const { status } = vm;
  if (status.kind === "loading")
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2"
        role="status"
        aria-live="polite"
      >
        <HourglassIcon size={32} />
        <span>Loading the Hall of Fame...</span>
      </div>
    );
  if (status.kind === "error")
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <Win98Icon name="warning" size={32} />
          <p className="whitespace-pre-wrap text-left">
            {vm.statusText}
            {status.failure.kind === "status" && status.failure.status === 404
              ? ""
              : "\nThe leaderboard could not be loaded."}
          </p>
        </div>
        <button type="button" onClick={vm.retry}>
          Retry
        </button>
      </div>
    );
  if (status.kind === "idle")
    return (
      <p className="p-4 text-center">
        No Fuse games are installed on this FuseOS, so there is nobody to
        celebrate.
      </p>
    );
  if (status.entries.length === 0)
    return (
      <p className="p-4 text-center">
        Nobody has played a rated round of {vm.game?.name ?? "this game"} yet.
        Be the first!
      </p>
    );
  return (
    <table
      className="halloffame-table"
      aria-label={`${vm.game?.name ?? "Game"} leaderboard`}
    >
      <colgroup>
        {COLUMNS.map(({ column, width }) => (
          <col key={column} style={{ width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map(({ column, label }) => (
            <HeaderButton key={column} column={column} label={label} vm={vm} />
          ))}
        </tr>
      </thead>
      <tbody>
        {vm.rows.map((entry) => (
          <tr
            key={`${entry.rank}:${entry.publicId ?? entry.name}`}
            data-podium={entry.rank <= 3}
            data-you={entry.you === true}
          >
            <td className="halloffame-number">
              <RankCell entry={entry} />
            </td>
            <td title={entry.name}>{entry.name}</td>
            <td className="halloffame-number">{entry.elo}</td>
            <td className="halloffame-number">{entry.rounds ?? 0}</td>
            <td className="halloffame-number">{entry.games}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type HallOfFameWindowProps = {
  windowId: string;
  gameId?: string;
};

/**
 * Start > Programs > Hall of Fame: every Fuse game's leaderboard, one game at a time, as an Explorer-style
 * details list. Elo and the counts come from the room service; the OS never signs in, so nothing is "you".
 */
export function HallOfFameWindow({ windowId, gameId }: HallOfFameWindowProps) {
  const vm = useHallOfFameViewModel(windowId, gameId);
  const onPick = (event: ChangeEvent<HTMLSelectElement>) =>
    vm.selectGame(event.target.value);
  const busy = vm.status.kind === "loading";
  return (
    <div
      className={`window-body flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden${busy ? " halloffame-busy" : ""}`}
      aria-busy={busy}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <TrophyIcon width={32} height={32} />
        <label htmlFor={`${windowId}-game`} className="whitespace-nowrap">
          Game:
        </label>
        <select
          id={`${windowId}-game`}
          className="min-w-0 flex-1"
          value={vm.game?.id ?? ""}
          onChange={onPick}
          disabled={vm.games.length === 0}
        >
          {vm.games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}
            </option>
          ))}
        </select>
      </div>
      <div
        className="halloffame-list sunken min-h-0 min-w-0 flex-1 overflow-auto"
        role="region"
        aria-label="Leaderboard"
        tabIndex={0}
      >
        <ListBody vm={vm} />
      </div>
      <div className="status-bar shrink-0">
        <p className="status-bar-field flex-1" data-testid="halloffame-status">
          {vm.statusText}
        </p>
        {vm.game ? (
          <p className="status-bar-field whitespace-nowrap">{vm.game.name}</p>
        ) : null}
      </div>
    </div>
  );
}
