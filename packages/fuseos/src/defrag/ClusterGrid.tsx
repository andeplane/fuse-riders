import { memo } from "react";

import { CELL_STATES } from "./defragDisk";

const Row = memo(function Row({ codes }: { codes: string }) {
  return (
    <div className="defrag-row">
      {[...codes].map((code, index) => (
        <i
          key={index}
          className={`defrag-c${code}`}
          data-state={CELL_STATES[Number(code)]}
        />
      ))}
    </div>
  );
});

export type ClusterGridProps = {
  /** One code per cluster (an index into `CELL_STATES`). */
  cells: Uint8Array;
  columns: number;
  percent: number;
};

/**
 * Show Details: every cluster as a small box. Rows are compared as strings, so a beat of the head
 * redraws the one or two rows it touched and not two thousand boxes.
 */
export function ClusterGrid({ cells, columns, percent }: ClusterGridProps) {
  const rows: string[] = [];
  for (let start = 0; start < cells.length; start += columns)
    rows.push(cells.subarray(start, start + columns).join(""));
  return (
    <div
      className="defrag-grid sunken min-h-0 flex-1"
      role="img"
      aria-label={`Disk clusters, ${percent}% defragmented`}
    >
      {rows.map((codes, index) => (
        <Row key={index} codes={codes} />
      ))}
    </div>
  );
}
