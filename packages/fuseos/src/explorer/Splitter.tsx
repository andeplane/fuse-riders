import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";

export type SplitterProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Vertical drag handle between the folders pane and the listing; the pane on the left grows with a drag to the right. */
export function Splitter({ label, value, min, max, onChange }: SplitterProps) {
  const drag = useRef<{ startX: number; startValue: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { startX: event.clientX, startValue: value };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onChange(
      clamp(
        drag.current.startValue + (event.clientX - drag.current.startX),
        min,
        max,
      ),
    );
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="raised w-1.5 shrink-0 cursor-col-resize bg-[silver] select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
        if (step !== 0) {
          event.preventDefault();
          onChange(clamp(value + step, min, max));
        }
      }}
    />
  );
}
