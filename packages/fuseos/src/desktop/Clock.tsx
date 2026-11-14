import { useContext, useEffect, useState } from "react";

import { DesktopDepsContext } from "./desktopDepsContext";
import { formatClock } from "./formatClock";

export function Clock() {
  const { now, subscribeClock } = useContext(DesktopDepsContext);
  const [time, setTime] = useState(() => now());
  useEffect(() => subscribeClock(() => setTime(now())), [now, subscribeClock]);
  return (
    <time className="px-2" dateTime={new Date(time).toISOString()}>
      {formatClock(time)}
    </time>
  );
}
