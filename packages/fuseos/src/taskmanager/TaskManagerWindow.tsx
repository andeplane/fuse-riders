import { useState } from "react";

import { formatBytes } from "../controlpanel/systemInfo";
import { Win98Icon } from "../ui/icons";
import { MenuBar } from "../windows/MenuBar";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { TaskStatus } from "./frameSampler";
import { PerformanceGraph } from "./PerformanceGraph";
import type {
  FrameSeries,
  TaskManagerSnapshot,
  TaskRow,
} from "./useTaskManagerViewModel";
import {
  HISTORY_LENGTH,
  useTaskManagerViewModel,
} from "./useTaskManagerViewModel";

/** The top of every frame-rate graph; a 120 Hz display still fits. */
const FPS_GRAPH_MAX = 120;

type Tab = "applications" | "performance";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "applications", label: "Applications" },
  { id: "performance", label: "Performance" },
];

export function statusLabel(status: TaskStatus): string {
  return status === "running" ? "Running" : "Not Responding";
}

function ApplicationsTab({
  rows,
  selectedId,
  onSelect,
  onSwitchTo,
  onEndTask,
}: {
  rows: readonly TaskRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSwitchTo: () => void;
  onEndTask: () => void;
}) {
  const hasSelection = selectedId !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="sunken min-h-0 flex-1 overflow-auto bg-white">
        <table className="w-full border-collapse" aria-label="Tasks">
          <thead className="sticky top-0 bg-[silver]">
            <tr>
              <th className="raised px-1 text-left font-normal">Task</th>
              <th className="raised w-28 px-1 text-left font-normal">Status</th>
              <th className="raised w-14 px-1 text-right font-normal">FPS</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-1 text-[grey]">
                  No windows are open.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const selected = row.id === selectedId;
              return (
                <tr
                  key={row.id}
                  aria-selected={selected}
                  className={`cursor-default select-none ${selected ? "bg-[navy] text-white" : ""}`}
                  onClick={() => onSelect(row.id)}
                  onDoubleClick={() => {
                    onSelect(row.id);
                    onSwitchTo();
                  }}
                >
                  <td className="px-1">
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <Win98Icon name={row.icon} />
                      <span className="truncate">{row.title}</span>
                    </span>
                  </td>
                  <td className="px-1 whitespace-nowrap">
                    {statusLabel(row.status)}
                  </td>
                  <td className="px-1 text-right tabular-nums">
                    {row.fps === undefined ? "" : row.fps}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <button type="button" disabled={!hasSelection} onClick={onEndTask}>
          End Task
        </button>
        <button type="button" disabled={!hasSelection} onClick={onSwitchTo}>
          Switch To
        </button>
      </div>
    </div>
  );
}

function FrameRateRow({ series }: { series: FrameSeries }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <span className="truncate">{series.title}</span>
        <span className="tabular-nums">{series.fps} fps</span>
      </div>
      <PerformanceGraph
        label={`${series.title} frame rate history`}
        values={series.history}
        capacity={HISTORY_LENGTH}
        max={FPS_GRAPH_MAX}
      />
    </div>
  );
}

function PerformanceTab({ snapshot }: { snapshot: TaskManagerSnapshot }) {
  const games = snapshot.rows.filter((row) => row.fps !== undefined).length;
  const heapMax = snapshot.heap ? snapshot.heap.totalBytes : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <fieldset className="flex flex-col gap-2">
        <legend>Frame rate</legend>
        {snapshot.frames.map((series) => (
          <FrameRateRow key={series.id} series={series} />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Memory</legend>
        {snapshot.heap ? (
          <>
            <div className="flex justify-between">
              <span>JS heap usage</span>
              <span className="tabular-nums">
                {formatBytes(snapshot.heap.usedBytes)} of{" "}
                {formatBytes(snapshot.heap.totalBytes)}
              </span>
            </div>
            <PerformanceGraph
              label="JS heap usage history"
              values={snapshot.heapHistory}
              capacity={HISTORY_LENGTH}
              max={heapMax}
            />
          </>
        ) : (
          <p className="text-[grey]">
            This browser does not report its JavaScript heap (Chromium does).
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>Totals</legend>
        <table className="w-full" aria-label="Totals">
          <tbody>
            <tr>
              <th className="w-2/5 text-left font-normal text-[grey]">
                Windows
              </th>
              <td>{snapshot.rows.length}</td>
            </tr>
            <tr>
              <th className="text-left font-normal text-[grey]">Game pages</th>
              <td>{games}</td>
            </tr>
          </tbody>
        </table>
      </fieldset>
    </div>
  );
}

/**
 * Task Manager, as Windows 2000 drew it: Applications lists every open window with whether
 * its page still paints, Performance graphs the frame rate of the desktop and of every game
 * page plus the JavaScript heap where the browser reports it. Opened from Start > Programs >
 * Accessories or Ctrl+Shift+Esc; one instance at a time (`TASK_MANAGER_WINDOW_ID`).
 */
export function TaskManagerWindow({ windowId }: { windowId: string }) {
  const vm = useTaskManagerViewModel();
  const commands = useWindowCommands();
  const [tab, setTab] = useState<Tab>("applications");
  const desktop = vm.snapshot.frames[0];
  const notResponding = vm.snapshot.rows.filter(
    (row) => row.status === "notResponding",
  ).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MenuBar
        menus={[
          {
            label: "File",
            items: [
              {
                label: "Exit Task Manager",
                onSelect: () => commands.close(windowId),
              },
            ],
          },
          {
            label: "Windows",
            items: [
              {
                label: "Switch To",
                onSelect: vm.switchTo,
                disabled: vm.selectedId === null,
              },
              {
                label: "End Task",
                onSelect: vm.endTask,
                disabled: vm.selectedId === null,
              },
            ],
          },
          {
            label: "Help",
            items: [
              {
                label: "About Task Manager",
                onSelect: () =>
                  commands.showInfo(
                    "About Task Manager",
                    "Frame rates are sampled from each page's own requestAnimationFrame; a page that stops painting for two seconds is Not Responding. Nothing is sent anywhere.",
                  ),
              },
            ],
          },
        ]}
      />
      <div className="window-body flex min-h-0 flex-1 flex-col gap-2">
        <menu role="tablist" aria-label="Task Manager tabs">
          {TABS.map((entry) => (
            <li
              key={entry.id}
              role="presentation"
              aria-selected={entry.id === tab}
            >
              <a
                href="#"
                role="tab"
                aria-selected={entry.id === tab}
                aria-controls={`taskmanager-tab-${entry.id}-${windowId}`}
                onClick={(event) => {
                  event.preventDefault();
                  setTab(entry.id);
                }}
              >
                {entry.label}
              </a>
            </li>
          ))}
        </menu>
        <div
          className="window flex min-h-0 flex-1 flex-col p-3"
          role="tabpanel"
          id={`taskmanager-tab-${tab}-${windowId}`}
          aria-label={tab === "applications" ? "Applications" : "Performance"}
        >
          {tab === "applications" ? (
            <ApplicationsTab
              rows={vm.snapshot.rows}
              selectedId={vm.selectedId}
              onSelect={vm.select}
              onSwitchTo={vm.switchTo}
              onEndTask={vm.endTask}
            />
          ) : (
            <PerformanceTab snapshot={vm.snapshot} />
          )}
        </div>
      </div>
      <div
        className="status-bar shrink-0"
        role="status"
        aria-label="Task Manager status"
      >
        <p className="status-bar-field">Windows: {vm.snapshot.rows.length}</p>
        <p className="status-bar-field">Not responding: {notResponding}</p>
        <p className="status-bar-field">Desktop: {desktop?.fps ?? 0} fps</p>
        <p className="status-bar-field">
          Mem usage:{" "}
          {vm.snapshot.heap ? formatBytes(vm.snapshot.heap.usedBytes) : "n/a"}
        </p>
      </div>
    </div>
  );
}
