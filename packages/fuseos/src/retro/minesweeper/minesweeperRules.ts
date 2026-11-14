export type Difficulty = "beginner" | "intermediate" | "expert";

export type BoardConfig = { width: number; height: number; mines: number };

export const DIFFICULTIES: Record<Difficulty, BoardConfig> = {
  beginner: { width: 9, height: 9, mines: 10 },
  intermediate: { width: 16, height: 16, mines: 40 },
  expert: { width: 30, height: 16, mines: 99 },
};

export const DIFFICULTY_ORDER: Difficulty[] = [
  "beginner",
  "intermediate",
  "expert",
];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
};

export type CellState = "hidden" | "revealed" | "flagged";

export type Cell = { mine: boolean; adjacent: number; state: CellState };

export type Board = BoardConfig & { cells: Cell[] };

export type GameStatus = "ready" | "playing" | "won" | "lost";

export type MinesweeperState = {
  difficulty: Difficulty;
  board: Board;
  status: GameStatus;
  startedAt?: number;
  /** Seconds since the first click, capped at 999 like the original. */
  elapsed: number;
  /** Index of the mine that ended the game. */
  exploded?: number;
};

export type MinesweeperAction =
  | { type: "reveal"; index: number; now: number; random: () => number }
  | { type: "flag"; index: number }
  | { type: "tick"; now: number }
  | { type: "reset" }
  | { type: "setDifficulty"; difficulty: Difficulty };

export const MAX_SECONDS = 999;

export function emptyBoard(config: BoardConfig): Board {
  return {
    ...config,
    cells: Array.from({ length: config.width * config.height }, () => ({
      mine: false,
      adjacent: 0,
      state: "hidden",
    })),
  };
}

export function initialState(difficulty: Difficulty): MinesweeperState {
  return {
    difficulty,
    board: emptyBoard(DIFFICULTIES[difficulty]),
    status: "ready",
    elapsed: 0,
  };
}

export function neighbours(board: BoardConfig, index: number): number[] {
  const x = index % board.width;
  const y = Math.floor(index / board.width);
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < board.width && ny >= 0 && ny < board.height)
        result.push(ny * board.width + nx);
    }
  }
  return result;
}

/** Places the mines anywhere except the first clicked cell, so the first click is always safe. */
export function placeMines(
  board: Board,
  safeIndex: number,
  random: () => number,
): Board {
  const candidates = board.cells
    .map((_cell, index) => index)
    .filter((index) => index !== safeIndex);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = candidates[index];
    const other = candidates[swap];
    if (current === undefined || other === undefined) continue;
    candidates[index] = other;
    candidates[swap] = current;
  }
  const mines = new Set(candidates.slice(0, board.mines));
  const cells = board.cells.map((cell, index) => ({
    ...cell,
    mine: mines.has(index),
  }));
  return {
    ...board,
    cells: cells.map((cell, index) => ({
      ...cell,
      adjacent: neighbours(board, index).filter(
        (neighbour) => cells[neighbour]?.mine,
      ).length,
    })),
  };
}

/** Reveals a cell, flood filling through cells with no adjacent mines. */
export function reveal(board: Board, index: number): Board {
  const cells = board.cells.map((cell) => ({ ...cell }));
  const stack = [index];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const cell = cells[current];
    if (!cell || cell.state !== "hidden") continue;
    cell.state = "revealed";
    if (!cell.mine && cell.adjacent === 0)
      stack.push(...neighbours(board, current));
  }
  return { ...board, cells };
}

export function toggleFlag(board: Board, index: number): Board {
  const cell = board.cells[index];
  if (!cell || cell.state === "revealed") return board;
  const cells = board.cells.slice();
  cells[index] = {
    ...cell,
    state: cell.state === "flagged" ? "hidden" : "flagged",
  };
  return { ...board, cells };
}

export function isWon(board: Board): boolean {
  return board.cells.every((cell) => cell.mine || cell.state === "revealed");
}

export function flagCount(board: Board): number {
  return board.cells.filter((cell) => cell.state === "flagged").length;
}

/** Shows every mine after a loss; flags on safe cells stay so they can be marked wrong. */
function revealMines(board: Board): Board {
  return {
    ...board,
    cells: board.cells.map((cell) =>
      cell.mine && cell.state === "hidden"
        ? { ...cell, state: "revealed" }
        : cell,
    ),
  };
}

function flagMines(board: Board): Board {
  return {
    ...board,
    cells: board.cells.map((cell) =>
      cell.mine ? { ...cell, state: "flagged" } : cell,
    ),
  };
}

function seconds(startedAt: number, now: number): number {
  return Math.min(
    MAX_SECONDS,
    Math.max(0, Math.floor((now - startedAt) / 1000)),
  );
}

export function minesweeperReducer(
  state: MinesweeperState,
  action: MinesweeperAction,
): MinesweeperState {
  switch (action.type) {
    case "reveal": {
      if (state.status === "won" || state.status === "lost") return state;
      const cell = state.board.cells[action.index];
      if (!cell || cell.state !== "hidden") return state;
      const started =
        state.status === "ready"
          ? placeMines(state.board, action.index, action.random)
          : state.board;
      const startedAt = state.startedAt ?? action.now;
      if (started.cells[action.index]?.mine) {
        return {
          ...state,
          board: revealMines(reveal(started, action.index)),
          status: "lost",
          startedAt,
          elapsed: seconds(startedAt, action.now),
          exploded: action.index,
        };
      }
      const board = reveal(started, action.index);
      if (isWon(board))
        return {
          ...state,
          board: flagMines(board),
          status: "won",
          startedAt,
          elapsed: seconds(startedAt, action.now),
        };
      return {
        ...state,
        board,
        status: "playing",
        startedAt,
        elapsed: seconds(startedAt, action.now),
      };
    }
    case "flag":
      if (state.status === "won" || state.status === "lost") return state;
      return { ...state, board: toggleFlag(state.board, action.index) };
    case "tick":
      if (state.status !== "playing" || state.startedAt === undefined)
        return state;
      return { ...state, elapsed: seconds(state.startedAt, action.now) };
    case "reset":
      return initialState(state.difficulty);
    case "setDifficulty":
      return initialState(action.difficulty);
  }
}

/** Three digit counter text like the LED displays: 007, 099, -01. */
export function counterText(value: number): string {
  const clamped = Math.max(-99, Math.min(999, value));
  return clamped < 0
    ? `-${String(-clamped).padStart(2, "0")}`
    : String(clamped).padStart(3, "0");
}
