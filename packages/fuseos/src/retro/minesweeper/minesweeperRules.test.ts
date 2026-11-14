import type { Board, Cell, MinesweeperState } from "./minesweeperRules";
import {
  DIFFICULTIES,
  MAX_SECONDS,
  counterText,
  emptyBoard,
  flagCount,
  initialState,
  isWon,
  minesweeperReducer,
  neighbours,
  placeMines,
  reveal,
  toggleFlag,
} from "./minesweeperRules";

const T0 = Date.UTC(1998, 5, 25, 12, 0, 0);

describe("DIFFICULTIES", () => {
  it("matches the classic presets", () => {
    expect(DIFFICULTIES.beginner).toEqual({ width: 9, height: 9, mines: 10 });
    expect(DIFFICULTIES.intermediate).toEqual({
      width: 16,
      height: 16,
      mines: 40,
    });
    expect(DIFFICULTIES.expert).toEqual({ width: 30, height: 16, mines: 99 });
  });
});

describe(neighbours.name, () => {
  it("returns the cells around a corner, an edge and the middle", () => {
    const board = { width: 3, height: 3, mines: 0 };
    expect(neighbours(board, 0)).toEqual([1, 3, 4]);
    expect(neighbours(board, 1)).toEqual([0, 2, 3, 4, 5]);
    expect(neighbours(board, 4)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });
});

describe(placeMines.name, () => {
  it("places exactly the configured number of mines, never on the first click, and counts neighbours", () => {
    const board = placeMines(emptyBoard(DIFFICULTIES.beginner), 40, sequence());
    expect(board.cells.filter((cell) => cell.mine)).toHaveLength(10);
    expect(cellAt(board, 40).mine).toBe(false);
    board.cells.forEach((cell, index) => {
      expect(cell.adjacent).toBe(
        neighbours(board, index).filter(
          (neighbour) => cellAt(board, neighbour).mine,
        ).length,
      );
    });
  });
});

describe(reveal.name, () => {
  it("flood fills empty areas and stops at numbers", () => {
    // Arrange: one mine in the bottom right corner of a 3x3 board.
    const board = withMines(3, 3, [8]);
    // Act
    const revealed = reveal(board, 0);
    // Assert: everything except the mine is revealed; the cells next to it show 1.
    expect(revealed.cells.map((cell) => cell.state)).toEqual([
      "revealed",
      "revealed",
      "revealed",
      "revealed",
      "revealed",
      "revealed",
      "revealed",
      "revealed",
      "hidden",
    ]);
    expect(cellAt(revealed, 4).adjacent).toBe(1);
    expect(isWon(revealed)).toBe(true);
  });

  it("does not reveal through flags", () => {
    // Arrange: the flag on cell 1 blocks the only empty route to the top right corner.
    const board = toggleFlag(withMines(3, 3, [8]), 1);
    // Act
    const revealed = reveal(board, 0);
    // Assert
    expect(cellAt(revealed, 1).state).toBe("flagged");
    expect(cellAt(revealed, 2).state).toBe("hidden");
    expect(cellAt(revealed, 6).state).toBe("revealed");
  });
});

describe(toggleFlag.name, () => {
  it("flags and unflags hidden cells only", () => {
    const board = withMines(2, 2, [3]);
    const flagged = toggleFlag(board, 0);
    expect(cellAt(flagged, 0).state).toBe("flagged");
    expect(flagCount(flagged)).toBe(1);
    expect(cellAt(toggleFlag(flagged, 0), 0).state).toBe("hidden");
    const revealed = reveal(board, 0);
    expect(toggleFlag(revealed, 0)).toBe(revealed);
  });

  it("leaves the board unchanged for an index outside it", () => {
    const board = withMines(2, 2, [3]);
    expect(toggleFlag(board, 4)).toBe(board);
    expect(toggleFlag(board, -1)).toBe(board);
  });
});

describe(minesweeperReducer.name, () => {
  it("starts the clock and places mines on the first reveal", () => {
    const state = minesweeperReducer(initialState("beginner"), {
      type: "reveal",
      index: 0,
      now: T0,
      random: sequence(),
    });
    expect(state.status).toBe("playing");
    expect(state.startedAt).toBe(T0);
    expect(state.board.cells.filter((cell) => cell.mine)).toHaveLength(10);
    expect(cellAt(state.board, 0).state).toBe("revealed");
  });

  it("ticks the timer while playing and caps it at 999", () => {
    const playing = minesweeperReducer(initialState("beginner"), {
      type: "reveal",
      index: 0,
      now: T0,
      random: sequence(),
    });
    expect(
      minesweeperReducer(playing, { type: "tick", now: T0 + 7_500 }).elapsed,
    ).toBe(7);
    expect(
      minesweeperReducer(playing, { type: "tick", now: T0 + 5_000_000 })
        .elapsed,
    ).toBe(MAX_SECONDS);
    expect(
      minesweeperReducer(initialState("beginner"), {
        type: "tick",
        now: T0 + 1000,
      }).elapsed,
    ).toBe(0);
  });

  it("loses on a mine, shows every mine and freezes the board", () => {
    const state = fixedState(withMines(2, 2, [3]));
    const lost = minesweeperReducer(state, {
      type: "reveal",
      index: 3,
      now: T0 + 3000,
      random: sequence(),
    });
    expect(lost.status).toBe("lost");
    expect(lost.exploded).toBe(3);
    expect(lost.elapsed).toBe(3);
    expect(cellAt(lost.board, 3).state).toBe("revealed");
    expect(
      minesweeperReducer(lost, {
        type: "reveal",
        index: 0,
        now: T0,
        random: sequence(),
      }),
    ).toBe(lost);
    expect(minesweeperReducer(lost, { type: "flag", index: 0 })).toBe(lost);
  });

  it("wins when every safe cell is revealed and flags the mines", () => {
    // Arrange: every safe cell on a 2x2 board touches the mine, so each needs its own click.
    let state = fixedState(withMines(2, 2, [3]));
    // Act
    state = minesweeperReducer(state, {
      type: "reveal",
      index: 0,
      now: T0,
      random: sequence(),
    });
    state = minesweeperReducer(state, {
      type: "reveal",
      index: 1,
      now: T0,
      random: sequence(),
    });
    expect(state.status).toBe("playing");
    const won = minesweeperReducer(state, {
      type: "reveal",
      index: 2,
      now: T0,
      random: sequence(),
    });
    // Assert
    expect(won.status).toBe("won");
    expect(cellAt(won.board, 3).state).toBe("flagged");
    expect(flagCount(won.board)).toBe(1);
  });

  it("flags cells and ignores reveals on flagged or revealed cells", () => {
    const state = fixedState(withMines(2, 2, [3]));
    const flagged = minesweeperReducer(state, { type: "flag", index: 3 });
    expect(cellAt(flagged.board, 3).state).toBe("flagged");
    expect(
      minesweeperReducer(flagged, {
        type: "reveal",
        index: 3,
        now: T0,
        random: sequence(),
      }),
    ).toBe(flagged);
  });

  it("resets to a fresh board and changes difficulty", () => {
    const playing = minesweeperReducer(initialState("beginner"), {
      type: "reveal",
      index: 0,
      now: T0,
      random: sequence(),
    });
    const reset = minesweeperReducer(playing, { type: "reset" });
    expect(reset.status).toBe("ready");
    expect(
      reset.board.cells.every((cell) => cell.state === "hidden" && !cell.mine),
    ).toBe(true);
    const expert = minesweeperReducer(reset, {
      type: "setDifficulty",
      difficulty: "expert",
    });
    expect(expert.board).toMatchObject({ width: 30, height: 16, mines: 99 });
    expect(expert.board.cells).toHaveLength(480);
  });
});

describe(counterText.name, () => {
  it("pads to three digits and shows small negatives", () => {
    expect(counterText(0)).toBe("000");
    expect(counterText(7)).toBe("007");
    expect(counterText(99)).toBe("099");
    expect(counterText(1234)).toBe("999");
    expect(counterText(-1)).toBe("-01");
    expect(counterText(-150)).toBe("-99");
  });
});

/** The cell at an index of the board; fails the test when the index is out of range. */
function cellAt(board: Board, index: number): Cell {
  const cell = board.cells[index];
  if (cell === undefined) throw new Error(`No cell at index ${index}`);
  return cell;
}

/** Deterministic random source cycling through a few fractions. */
function sequence(): () => number {
  const values = [0.13, 0.71, 0.42, 0.97, 0.05, 0.58, 0.33, 0.88, 0.21, 0.64];
  let index = 0;
  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}

/** A board with mines at the given indexes and adjacency counts filled in. */
function withMines(width: number, height: number, mines: number[]): Board {
  const board = emptyBoard({ width, height, mines: mines.length });
  const cells = board.cells.map((cell, index) => ({
    ...cell,
    mine: mines.includes(index),
  }));
  return {
    ...board,
    cells: cells.map((cell, index) => ({
      ...cell,
      adjacent: neighbours(board, index).filter(
        (neighbour) => cells[neighbour]?.mine === true,
      ).length,
    })),
  };
}

/** A game already in progress on a known board, so reveals do not reshuffle mines. */
function fixedState(board: Board): MinesweeperState {
  return {
    difficulty: "beginner",
    board,
    status: "playing",
    startedAt: T0,
    elapsed: 0,
  };
}
