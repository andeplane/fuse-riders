import type { MouseEvent } from "react";
import { useState } from "react";

import type { Size } from "../../windows/windowManager";

import type { Cell, Difficulty, GameStatus } from "./minesweeperRules";
import { DIFFICULTY_LABELS, DIFFICULTY_ORDER } from "./minesweeperRules";
import { useMinesweeperGame } from "./useMinesweeperGame";

const CELL = 16;
const NUMBER_COLOURS = [
  "",
  "#0000ff",
  "#008000",
  "#ff0000",
  "#000080",
  "#800000",
  "#008080",
  "#000000",
  "#808080",
];
const FACES: Record<GameStatus, string> = {
  ready: "🙂",
  playing: "🙂",
  won: "😎",
  lost: "😵",
};

function cellText(cell: Cell, status: GameStatus, exploded: boolean): string {
  if (cell.state === "flagged")
    return status === "lost" && !cell.mine ? "✖" : "🚩";
  if (cell.state !== "revealed") return "";
  if (cell.mine) return exploded ? "💥" : "💣";
  return cell.adjacent > 0 ? String(cell.adjacent) : "";
}

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <output
      aria-label={label}
      className="sunken bg-black px-1 font-mono text-[18px] font-bold leading-none text-[#ff0000]"
      style={{ letterSpacing: 1 }}
    >
      {value}
    </output>
  );
}

/** Windows 98 Minesweeper: counters, smiley, a grid of raised cells and a Game menu for the difficulty. */
export function Minesweeper({
  onBoardSizeChange,
}: { onBoardSizeChange?: (size: Size) => void } = {}) {
  const game = useMinesweeperGame("beginner", onBoardSizeChange);
  const [menuOpen, setMenuOpen] = useState(false);
  const { board, status, exploded } = game.state;
  const finished = status === "won" || status === "lost";

  const onCell = (index: number, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.button === 2) game.flag(index);
    else if (event.button === 0) game.reveal(index);
  };

  const choose = (difficulty: Difficulty) => {
    setMenuOpen(false);
    game.setDifficulty(difficulty);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[silver]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="relative flex shrink-0 items-center border-b border-b-[grey] px-1"
        role="menubar"
        aria-label="Minesweeper menu"
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`menu-item flat px-2 ${menuOpen ? "open" : ""}`}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Game
        </button>
        {menuOpen ? (
          <ul
            role="menu"
            aria-label="Game"
            className="raised absolute left-1 top-full z-10 min-w-36 bg-[silver] py-0.5"
          >
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="menu-item flat w-full px-4 py-0.5 text-left"
                onClick={() => choose(game.state.difficulty)}
              >
                New
              </button>
            </li>
            <li role="none">
              <hr className="mx-1 my-0.5 border-t border-[grey] border-b-white" />
            </li>
            {DIFFICULTY_ORDER.map((difficulty) => (
              <li key={difficulty} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={game.state.difficulty === difficulty}
                  className="menu-item flat w-full px-4 py-0.5 text-left"
                  onClick={() => choose(difficulty)}
                >
                  {game.state.difficulty === difficulty ? "• " : "  "}
                  {DIFFICULTY_LABELS[difficulty]}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="raised inline-block p-1.5" style={{ borderWidth: 3 }}>
          <div className="sunken mb-1.5 flex items-center justify-between p-1">
            <Counter label="Mines left" value={game.minesLeft} />
            <button
              type="button"
              aria-label="New game"
              className="flex h-7 w-7 items-center justify-center text-[16px] leading-none"
              style={{ minWidth: 0, padding: 0 }}
              onClick={game.reset}
            >
              {FACES[status]}
            </button>
            <Counter label="Time" value={game.time} />
          </div>
          <div
            role="grid"
            aria-label="Minefield"
            data-status={status}
            className="sunken grid bg-[silver]"
            style={{
              gridTemplateColumns: `repeat(${board.width}, ${CELL}px)`,
              borderWidth: 3,
              width: board.width * CELL + 6,
            }}
          >
            {board.cells.map((cell, index) => {
              const revealed = cell.state === "revealed";
              const text = cellText(cell, status, exploded === index);
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  aria-label={`Cell ${(index % board.width) + 1},${Math.floor(index / board.width) + 1}${revealed ? ` revealed${cell.mine ? " mine" : cell.adjacent ? ` ${cell.adjacent}` : ""}` : cell.state === "flagged" ? " flagged" : ""}`}
                  data-state={cell.state}
                  disabled={finished}
                  className={`flex items-center justify-center overflow-hidden text-[11px] font-bold leading-none ${revealed ? "" : "raised"}`}
                  style={{
                    width: CELL,
                    height: CELL,
                    minWidth: 0,
                    minHeight: 0,
                    padding: 0,
                    boxShadow: revealed ? "none" : undefined,
                    border: revealed ? "1px solid grey" : "none",
                    borderWidth: revealed ? "0 0 1px 1px" : 0,
                    background:
                      revealed && exploded === index ? "#ff0000" : "silver",
                    color: NUMBER_COLOURS[cell.adjacent] ?? "#000",
                  }}
                  onMouseDown={(event) => onCell(index, event)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  {text}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
