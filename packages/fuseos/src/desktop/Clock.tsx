import { useContext, useEffect, useState } from "react";

import { ClockDisplayContext } from "./clockDisplayContext";
import { DesktopDepsContext } from "./desktopDepsContext";
import { formatClock } from "./formatClock";

export function Clock() {
  const { now, subscribeClock } = useContext(DesktopDepsContext);
  const override = useContext(ClockDisplayContext);
  const [time, setTime] = useState(() => now());
  useEffect(() => subscribeClock(() => setTime(now())), [now, subscribeClock]);
  if (override)
    return (
      <time
        className={`px-2 ${override.className ?? ""}`.trim()}
        dateTime={new Date(time).toISOString()}
        data-clock-override
      >
        {override.text}
      </time>
    );
  return (
    <time className="px-2" dateTime={new Date(time).toISOString()}>
      {formatClock(time)}
    </time>
  );
}
