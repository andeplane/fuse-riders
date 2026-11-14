import { useContext, useEffect, useState } from "react";

import { OS_NAME } from "../desktop/windowMeta";

import type { StorageEstimate } from "./systemInfo";
import { formatBytes } from "./systemInfo";
import { SystemProbeContext } from "./systemProbeContext";
import { useControlPanelViewModel } from "./useControlPanelViewModel";

type StorageRow =
  | { state: "measuring" }
  | { state: "unavailable" }
  | { state: "measured"; estimate: StorageEstimate };

function storageText(available: boolean, row: StorageRow): string {
  if (!available) return "Not available; nothing is remembered";
  switch (row.state) {
    case "measuring":
      return "Windows are remembered between visits (measuring...)";
    case "unavailable":
      return "Windows are remembered between visits";
    case "measured":
      return `Windows are remembered between visits; ${formatBytes(row.estimate.usageBytes)} of ${formatBytes(row.estimate.quotaBytes)} used`;
  }
}

function InfoTable({
  label,
  rows,
}: {
  label: string;
  rows: readonly [string, string][];
}) {
  return (
    <table className="w-full" aria-label={label}>
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name}>
            <th
              className="w-2/5 text-left font-normal text-[grey]"
              style={{
                background: "none",
                boxShadow: "none",
                position: "static",
              }}
            >
              {name}
            </th>
            <td className="break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Control Panel, System: the Windows 98 System Properties "General" sheet for a browser. The
 * browser FuseOS runs in, its graphics (WebGPU is what the Office Assistant's local model needs),
 * the machine as far as a page may know it, and whether and how much the desktop remembers.
 * The storage figure arrives asynchronously from the probe; the sheet renders without it first.
 */
export function SystemApplet({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  const probe = useContext(SystemProbeContext);
  const [storage, setStorage] = useState<StorageRow>({ state: "measuring" });

  useEffect(() => {
    const estimate = probe().estimateStorage;
    if (!estimate) {
      setStorage({ state: "unavailable" });
      return;
    }
    let cancelled = false;
    void estimate().then((result) => {
      if (cancelled) return;
      setStorage(
        result
          ? { state: "measured", estimate: result }
          : { state: "unavailable" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [probe]);

  const system: [string, string][] = [
    ["System", OS_NAME],
    ["Browser", vm.system.browser],
    ["Platform", vm.system.platform],
    ["Language", vm.system.language],
  ];
  const computer: [string, string][] = [
    ["Processors", vm.system.processors],
    ["Memory", vm.system.memory],
    ["Screen", vm.system.screen],
    ["Pointer", vm.system.pointer],
    ["WebGPU", vm.system.webGpu ? "Available" : "Not available"],
    ["Storage", storageText(vm.system.storage, storage)],
  ];
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend>System</legend>
        <InfoTable label="System information" rows={system} />
      </fieldset>
      <fieldset>
        <legend>Computer</legend>
        <InfoTable label="Computer information" rows={computer} />
      </fieldset>
      <p className="text-[grey]">
        Everything above is read from this browser; nothing is sent anywhere.
      </p>
    </div>
  );
}
