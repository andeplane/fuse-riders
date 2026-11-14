import { OS_NAME } from "../desktop/windowMeta";

import { useControlPanelViewModel } from "./useControlPanelViewModel";

/** Control Panel, System: the browser FuseOS runs in, its graphics and whether it remembers the desktop. */
export function SystemApplet({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  const rows: [string, string][] = [
    ["Computer", OS_NAME],
    ["Browser", vm.system.browser],
    ["Platform", vm.system.platform],
    ["Screen", vm.system.screen],
    ["Language", vm.system.language],
    ["WebGPU", vm.system.webGpu ? "Available" : "Not available"],
    [
      "Storage",
      vm.system.storage
        ? "Windows are remembered between visits"
        : "Not available; nothing is remembered",
    ],
  ];
  return (
    <fieldset>
      <legend>System</legend>
      <table className="w-full" aria-label="System information">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th
                className="w-2/5 text-left font-normal text-[grey]"
                style={{
                  background: "none",
                  boxShadow: "none",
                  position: "static",
                }}
              >
                {label}
              </th>
              <td className="break-all">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}
