import {
  scriptedRandom as scripted,
  seededRandom,
} from "../../__mocks__/seededRandom";

import type { Vec3 } from "./pipesModel";
import {
  addVec,
  CAMERA_DISTANCE,
  cameraPosition,
  chance,
  chooseDirection,
  chooseFrom,
  chooseJoint,
  createPipeState,
  DIRECTIONS,
  dissolveBlocksPerFrame,
  dissolveGrid,
  dissolveOrder,
  equalVec,
  GRID_HALF,
  inBounds,
  isJointStyle,
  JOINT_STYLE_LABELS,
  JOINT_STYLES,
  jointChances,
  PipeGrid,
  pipeCount,
  randomCell,
  randomInteger,
  resolveJointStyle,
  sceneLifetimeMs,
  shuffleInPlace,
  stepPipe,
  subVec,
} from "./pipesModel";

describe("vectors and the grid", () => {
  it("adds, subtracts, compares and bounds-checks integer cells", () => {
    expect(addVec([1, 2, 3], [1, -1, 0])).toEqual([2, 1, 3]);
    expect(subVec([1, 2, 3], [1, -1, 0])).toEqual([0, 3, 3]);
    expect(equalVec([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(equalVec([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(inBounds([GRID_HALF, -GRID_HALF, 0])).toBe(true);
    expect(inBounds([GRID_HALF + 1, 0, 0])).toBe(false);
    expect(inBounds([0, 0, -3], 2)).toBe(false);
    expect(DIRECTIONS).toHaveLength(6);
    for (const direction of DIRECTIONS)
      expect(
        Math.abs(direction[0]) +
          Math.abs(direction[1]) +
          Math.abs(direction[2]),
      ).toBe(1);
  });

  it("remembers taken cells until cleared", () => {
    const grid = new PipeGrid();
    expect(grid.has([0, 0, 0])).toBe(false);
    grid.take([0, 0, 0]);
    grid.take([0, 0, 0]);
    grid.take([1, 0, 0]);
    expect(grid.has([0, 0, 0])).toBe(true);
    expect(grid.has([0, 0, 1])).toBe(false);
    expect(grid.size).toBe(2);
    grid.clear();
    expect(grid.has([0, 0, 0])).toBe(false);
    expect(grid.size).toBe(0);
  });

  it("picks random cells inside the grid", () => {
    const rng = seededRandom(7);
    for (let index = 0; index < 200; index += 1) {
      const cell = randomCell(rng);
      expect(inBounds(cell)).toBe(true);
      expect(cell.every(Number.isInteger)).toBe(true);
    }
    expect(randomCell(scripted([0]))).toEqual([
      -GRID_HALF,
      -GRID_HALF,
      -GRID_HALF,
    ]);
    expect(randomCell(scripted([0.999]))).toEqual([
      GRID_HALF,
      GRID_HALF,
      GRID_HALF,
    ]);
  });
});

describe("random helpers", () => {
  it("round, compare and choose exactly as the original did", () => {
    expect(randomInteger(scripted([0.5]), 0, 10)).toBe(5);
    expect(chance(scripted([0.1]), 0.2)).toBe(true);
    expect(chance(scripted([0.3]), 0.2)).toBe(false);
    expect(chance(scripted([0]), 0)).toBe(false);
    expect(chooseFrom(scripted([0.99]), ["a", "b", "c"])).toBe("c");
    expect(() => chooseFrom(scripted([0]), [])).toThrow("non-empty");
    const shuffled = shuffleInPlace(seededRandom(1), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(shuffled).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("direction and joints", () => {
  it("keeps straight half the time when it has a direction, otherwise picks any axis and sign", () => {
    const last: Vec3 = [0, 0, 1];
    expect(chooseDirection(scripted([0.2]), last)).toBe(last);
    expect(chooseDirection(scripted([0.7, 0.4, 0.9]), last)).toEqual([
      0, -1, 0,
    ]);
    expect(chooseDirection(scripted([0.1, 0.2]), undefined)).toEqual([1, 0, 0]);
    expect(chooseDirection(scripted([0.9, 0.7]), undefined)).toEqual([
      0, 0, -1,
    ]);
  });

  it("maps each joint style to the original chances, with teapots only when asked", () => {
    expect(jointChances("ball", true)).toEqual({ teapot: 1 / 200, ball: 1 });
    expect(jointChances("mixed", false)).toEqual({ teapot: 0, ball: 1 / 3 });
    expect(jointChances("elbow", true, 1 / 20)).toEqual({
      teapot: 1 / 20,
      ball: 0,
    });
    expect(chooseJoint(scripted([0.001]), { teapot: 1 / 200, ball: 0 })).toBe(
      "teapot",
    );
    expect(
      chooseJoint(scripted([0.5, 0.2]), { teapot: 1 / 200, ball: 1 / 3 }),
    ).toBe("ball");
    expect(
      chooseJoint(scripted([0.5, 0.9]), { teapot: 1 / 200, ball: 1 / 3 }),
    ).toBe("elbow");
    expect(chooseJoint(scripted([0]), { teapot: 0, ball: 0 })).toBe("elbow");
  });

  it("cycles elbow, ball, mixed across scenes and leaves the fixed styles alone", () => {
    expect(resolveJointStyle("cycle", 0)).toBe("elbow");
    expect(resolveJointStyle("cycle", 1)).toBe("ball");
    expect(resolveJointStyle("cycle", 2)).toBe("mixed");
    expect(resolveJointStyle("cycle", 3)).toBe("elbow");
    expect(resolveJointStyle("ball", 5)).toBe("ball");
    expect(JOINT_STYLES).toEqual(["elbow", "ball", "mixed", "cycle"]);
    for (const style of JOINT_STYLES) {
      expect(isJointStyle(style)).toBe(true);
      expect(JOINT_STYLE_LABELS[style]).not.toBe("");
    }
    expect(isJointStyle("torus")).toBe(false);
    expect(isJointStyle(1)).toBe(false);
  });
});

describe("stepPipe", () => {
  const chances = { teapot: 0, ball: 1 };

  it("takes the next free cell, records the path and joints only where it turns", () => {
    const grid = new PipeGrid();
    const state = createPipeState([0, 0, 0]);
    grid.take(state.current);
    // No previous direction: axis x, positive. No joint on the first segment.
    expect(stepPipe(scripted([0.1, 0.2]), state, grid, chances)).toEqual({
      from: [0, 0, 0],
      to: [1, 0, 0],
      joint: undefined,
    });
    // Keep straight (0.2 < 1/2): no joint.
    expect(stepPipe(scripted([0.2]), state, grid, chances)).toEqual({
      from: [1, 0, 0],
      to: [2, 0, 0],
      joint: undefined,
    });
    // Turn to +y: a joint at the corner, a ball since ball chance is 1.
    expect(
      stepPipe(scripted([0.9, 0.4, 0.2, 0.5, 0.5]), state, grid, chances),
    ).toEqual({
      from: [2, 0, 0],
      to: [2, 1, 0],
      joint: "ball",
    });
    expect(state.cells).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
    ]);
    expect(state.previous).toEqual([2, 0, 0]);
    expect(grid.size).toBe(4);
  });

  it("stays put when the next cell is taken or outside the grid", () => {
    const grid = new PipeGrid();
    const state = createPipeState([GRID_HALF, 0, 0]);
    grid.take(state.current);
    expect(
      stepPipe(scripted([0.1, 0.2]), state, grid, chances),
    ).toBeUndefined();
    expect(state.current).toEqual([GRID_HALF, 0, 0]);
    grid.take([GRID_HALF - 1, 0, 0]);
    expect(
      stepPipe(scripted([0.1, 0.9]), state, grid, chances),
    ).toBeUndefined();
    expect(grid.size).toBe(2);
    expect(state.cells).toHaveLength(1);
  });

  it("never leaves the grid or crosses itself over a long random run", () => {
    const rng = seededRandom(42);
    const grid = new PipeGrid();
    const state = createPipeState(randomCell(rng));
    grid.take(state.current);
    const seen = new Set<string>([state.current.join(",")]);
    for (let frame = 0; frame < 5000; frame += 1) {
      const step = stepPipe(rng, state, grid, { teapot: 1 / 200, ball: 1 / 3 });
      if (!step) continue;
      expect(inBounds(step.to)).toBe(true);
      expect(seen.has(step.to.join(","))).toBe(false);
      seen.add(step.to.join(","));
    }
    expect(seen.size).toBeGreaterThan(50);
    expect(grid.size).toBe(seen.size);
  });
});

describe("scenes", () => {
  it("counts pipes, scene lifetimes and camera angles like the original", () => {
    expect(pipeCount(scripted([0.5]), false)).toBe(1);
    expect(pipeCount(scripted([0.5]), true)).toBe(2);
    expect(pipeCount(scripted([0.05]), true)).toBe(3);
    expect(sceneLifetimeMs(scripted([0]))).toBe(16000);
    expect(sceneLifetimeMs(scripted([1]))).toBe(24000);
    expect(sceneLifetimeMs(scripted([0.5]), [2, 4])).toBe(3000);
    expect(cameraPosition(scripted([0.2]))).toEqual([0, 0, CAMERA_DISTANCE]);
    const rotated = cameraPosition(scripted([0.9, 1, 0.5, 0.5]));
    // A quarter turn about the x axis leaves the x-axis vector where it was.
    expect(rotated[0]).toBeCloseTo(CAMERA_DISTANCE);
    const rng = seededRandom(3);
    for (let index = 0; index < 50; index += 1) {
      const position = cameraPosition(rng);
      expect(Math.hypot(...position)).toBeCloseTo(CAMERA_DISTANCE, 5);
    }
    // A degenerate (all-zero) axis falls back to x rather than NaN.
    const degenerate = cameraPosition(scripted([0.9, 0.5, 0.5, 0.5]));
    expect(degenerate.every(Number.isFinite)).toBe(true);
  });

  it("dissolves every block once, in blocks of about twenty pixels, finishing in two seconds", () => {
    expect(dissolveGrid(1024, 768)).toEqual({ columns: 52, rows: 39 });
    expect(dissolveGrid(0, 0)).toEqual({ columns: 1, rows: 1 });
    const order = dissolveOrder(seededRandom(9), 4, 3);
    expect(order).toHaveLength(12);
    expect(
      new Set(order.map((cell) => `${cell.column},${cell.row}`)).size,
    ).toBe(12);
    expect(order.every((cell) => cell.column < 4 && cell.row < 3)).toBe(true);
    expect(dissolveBlocksPerFrame(2028, 2)).toBe(16);
    expect(dissolveBlocksPerFrame(1, 2)).toBe(1);
  });
});
