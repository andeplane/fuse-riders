export type PerformanceGraphProps = {
  label: string;
  /** Oldest first; the newest value sits at the right edge. */
  values: readonly number[];
  /** How many columns the graph spans; shorter series leave the left empty, as a fresh Task Manager does. */
  capacity: number;
  /** The value drawn at the top edge; anything above is clipped to it. */
  max: number;
  height?: number;
};

const WIDTH = 240;
const GRID_STEP = 12;

/** The Windows 2000 Task Manager graph: a bright green trace over a dim green grid on black. */
export function PerformanceGraph({
  label,
  values,
  capacity,
  max,
  height = 64,
}: PerformanceGraphProps) {
  const columns = Math.max(capacity, 1);
  const step = WIDTH / columns;
  const scale = max > 0 ? max : 1;
  const offset = columns - values.length;
  const points = values
    .map((value, index) => {
      const x = (offset + index) * step;
      const y =
        height -
        (Math.min(Math.max(value, 0), scale) / scale) * (height - 2) -
        1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const verticals = Array.from(
    { length: Math.floor(WIDTH / GRID_STEP) },
    (_, index) => (index + 1) * GRID_STEP,
  );
  const horizontals = Array.from(
    { length: Math.floor(height / GRID_STEP) },
    (_, index) => (index + 1) * GRID_STEP,
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      className="sunken block h-16 w-full bg-black"
      style={{ shapeRendering: "crispEdges" }}
    >
      <rect x={0} y={0} width={WIDTH} height={height} fill="#000" />
      {verticals.map((x) => (
        <line
          key={`v${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={height}
          stroke="#004000"
          strokeWidth={1}
        />
      ))}
      {horizontals.map((y) => (
        <line
          key={`h${y}`}
          x1={0}
          y1={y}
          x2={WIDTH}
          y2={y}
          stroke="#004000"
          strokeWidth={1}
        />
      ))}
      {values.length > 1 ? (
        <polyline
          data-testid="trace"
          points={points}
          fill="none"
          stroke="#00ff00"
          strokeWidth={1}
        />
      ) : null}
    </svg>
  );
}
