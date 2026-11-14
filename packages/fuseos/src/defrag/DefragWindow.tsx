import type { ReactNode } from "react";
import { useContext, useState, useSyncExternalStore } from "react";

import { DRIVE_LABELS } from "../disk/diskPath";
import { Win98Icon } from "../ui/icons";

import { ClusterGrid } from "./ClusterGrid";
import { DefragSessionsContext } from "./defragDepsContext";
import type { CellState } from "./defragDisk";
import { CELL_STATES } from "./defragDisk";
import { DefragIcon } from "./DefragIcon";
import type {
  DefragChoice,
  DefragOptions,
  DefragSession,
  DefragSnapshot,
} from "./defragSession";
import { GRID_COLUMNS } from "./defragSession";

import "./defrag.css";

const CHOICES: readonly { value: DefragChoice; label: string }[] = [
  { value: "C", label: DRIVE_LABELS.C },
  { value: "A", label: DRIVE_LABELS.A },
  { value: "all", label: "All Hard Drives" },
];

const isChoice = (value: string): value is DefragChoice =>
  CHOICES.some((choice) => choice.value === value);

/** The Legend's lines, in the order Windows 98 lists them. */
export const LEGEND: readonly { state: CellState; label: string }[] = [
  { state: "begin", label: "Belongs at beginning of drive" },
  { state: "middle", label: "Belongs in middle of drive" },
  { state: "end", label: "Belongs at end of drive" },
  { state: "optimized", label: "Optimized (defragmented) data" },
  { state: "free", label: "Free space" },
  { state: "fixed", label: "Data that will not be moved" },
  { state: "bad", label: "Bad (damaged) area of the disk" },
  { state: "reading", label: "Data that's currently being read" },
  { state: "writing", label: "Data that's currently being written" },
];

function SelectDrive({
  session,
  snapshot,
}: {
  session: DefragSession;
  snapshot: DefragSnapshot;
}) {
  return (
    <div className="window-body flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start gap-3">
        <DefragIcon width={32} height={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="defrag-drive">
            Which drive do you want to defragment?
          </label>
          <select
            id="defrag-drive"
            value={snapshot.choice}
            onChange={(event) => {
              if (isChoice(event.target.value))
                session.choose(event.target.value);
            }}
          >
            {CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className="text-[10px] leading-tight">
            Copyright © 1981-1998 Fuse Games Corporation
            <br />
            Copyright © 1988-1992 Fusemantec Corporation
            <br />
            Fuse Application Launch Accelerator
          </p>
        </div>
      </div>
      <div className="mt-auto flex justify-end gap-2">
        <button
          type="button"
          className="default"
          onClick={session.start}
          autoFocus
        >
          OK
        </button>
        <button type="button" onClick={session.exit}>
          Exit
        </button>
        <button type="button" onClick={session.openSettings}>
          Settings...
        </button>
      </div>
    </div>
  );
}

function Settings({
  session,
  options,
}: {
  session: DefragSession;
  options: DefragOptions;
}) {
  const [draft, setDraft] = useState(options);
  return (
    <div className="window-body flex min-h-0 flex-1 flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend>When defragmenting my hard drive:</legend>
        <div className="field-row">
          <input
            id="defrag-rearrange"
            type="checkbox"
            checked={draft.rearrange}
            onChange={(event) =>
              setDraft({ ...draft, rearrange: event.target.checked })
            }
          />
          <label htmlFor="defrag-rearrange">
            Rearrange program files so my programs start faster.
          </label>
        </div>
        <div className="field-row">
          <input
            id="defrag-check"
            type="checkbox"
            checked={draft.checkErrors}
            onChange={(event) =>
              setDraft({ ...draft, checkErrors: event.target.checked })
            }
          />
          <label htmlFor="defrag-check">Check the drive for errors.</label>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>I want to use these options:</legend>
        <div className="field-row">
          <input
            id="defrag-once"
            type="radio"
            name="defrag-when"
            checked={!draft.everyTime}
            onChange={() => setDraft({ ...draft, everyTime: false })}
          />
          <label htmlFor="defrag-once">This time only.</label>
        </div>
        <div className="field-row">
          <input
            id="defrag-always"
            type="radio"
            name="defrag-when"
            checked={draft.everyTime}
            onChange={() => setDraft({ ...draft, everyTime: true })}
          />
          <label htmlFor="defrag-always">
            Every time I defragment my hard drive.
          </label>
        </div>
      </fieldset>
      <div className="mt-auto flex justify-end gap-2">
        <button
          type="button"
          className="default"
          onClick={() => session.saveSettings(draft)}
        >
          OK
        </button>
        <button type="button" onClick={session.cancelSettings}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="defrag-progress sunken"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Defragmenting"
    >
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

/** A message box over the Defragmenter's own window, the way its questions used to sit on top of it. */
function Popup({
  title,
  children,
  buttons,
}: {
  title: string;
  children: ReactNode;
  buttons: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/10"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="window max-w-[94%]">
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
        </div>
        <div className="window-body flex flex-col gap-3">
          {children}
          <div className="flex justify-center gap-2">{buttons}</div>
        </div>
      </div>
    </div>
  );
}

function Legend({ onClose }: { onClose: () => void }) {
  return (
    <Popup
      title="Defrag Legend"
      buttons={
        <button type="button" className="default" onClick={onClose} autoFocus>
          Close
        </button>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        <li>Unoptimized data that:</li>
        {LEGEND.map(({ state, label }, index) => (
          <li
            key={state}
            className={`flex items-center gap-2 ${index < 3 ? "pl-3" : ""}`}
          >
            <span
              className={`defrag-swatch defrag-c${CELL_STATES.indexOf(state)}`}
              data-state={state}
            />
            {label}
          </li>
        ))}
      </ul>
      <p>Each box represents one disk cluster.</p>
    </Popup>
  );
}

function Dialogs({
  session,
  snapshot,
}: {
  session: DefragSession;
  snapshot: DefragSnapshot;
}) {
  const dialog = snapshot.dialog;
  if (dialog?.kind === "restart")
    return (
      <Popup
        title="Disk Defragmenter"
        buttons={
          <button
            type="button"
            className="default"
            onClick={session.dismissRestart}
            autoFocus
          >
            OK
          </button>
        }
      >
        <div className="flex items-start gap-3">
          <Win98Icon name="warning" size={32} />
          <div className="flex flex-col gap-2">
            <p>{dialog.message}</p>
            <p className="text-[10px]">({dialog.detail})</p>
          </div>
        </div>
      </Popup>
    );
  if (dialog?.kind === "confirmStop")
    return (
      <Popup
        title="Are you sure?"
        buttons={
          <>
            <button type="button" onClick={() => session.answerStop(true)}>
              Yes
            </button>
            <button
              type="button"
              className="default"
              onClick={() => session.answerStop(false)}
              autoFocus
            >
              No
            </button>
          </>
        }
      >
        <p>
          Are you sure you want to stop defragmenting drive {snapshot.drive}?
        </p>
      </Popup>
    );
  if (dialog?.kind === "complete")
    return (
      <Popup
        title="Disk Defragmenter"
        buttons={
          <>
            <button
              type="button"
              className="default"
              onClick={() => session.answerComplete(true)}
              autoFocus
            >
              Yes
            </button>
            <button type="button" onClick={() => session.answerComplete(false)}>
              No
            </button>
          </>
        }
      >
        <p>
          Defragmentation of drive {snapshot.drive} is complete.
          <br />
          Do you want to quit Disk Defragmenter?
        </p>
      </Popup>
    );
  return snapshot.legend ? (
    <Legend onClose={() => session.setLegend(false)} />
  ) : null;
}

function Running({
  session,
  snapshot,
}: {
  session: DefragSession;
  snapshot: DefragSnapshot;
}) {
  const status = snapshot.paused ? "Paused" : snapshot.status;
  const stop = (
    <button type="button" onClick={session.requestStop}>
      Stop
    </button>
  );
  const pause = (
    <button type="button" onClick={session.togglePause}>
      {snapshot.paused ? "Resume" : "Pause"}
    </button>
  );
  const complete = <p>{snapshot.percent}% Complete</p>;

  if (!snapshot.details)
    return (
      <div className="window-body relative flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="defrag-anim" data-paused={snapshot.paused}>
              <DefragIcon width={32} height={32} />
            </span>
            <p>Defragmenting Drive {snapshot.drive}</p>
          </div>
          <ProgressBar percent={snapshot.percent} />
          {complete}
          <p className="truncate text-[10px]" title={status}>
            {status}
          </p>
        </div>
        <div className="flex w-[96px] shrink-0 flex-col gap-2">
          {stop}
          {pause}
          <button type="button" onClick={session.toggleDetails}>
            Show Details
          </button>
        </div>
        <Dialogs session={session} snapshot={snapshot} />
      </div>
    );

  return (
    <div className="window-body relative flex min-h-0 flex-1 flex-col gap-2">
      <ClusterGrid
        cells={snapshot.cells}
        columns={GRID_COLUMNS}
        percent={snapshot.percent}
      />
      <div className="flex shrink-0 gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="truncate" title={status} aria-live="off">
            {status}
          </p>
          <ProgressBar percent={snapshot.percent} />
          {complete}
        </div>
        <div className="grid shrink-0 grid-cols-2 content-start gap-2">
          {stop}
          <button type="button" onClick={() => session.setLegend(true)}>
            Legend
          </button>
          {pause}
          <button type="button" onClick={session.toggleDetails}>
            Hide Details
          </button>
        </div>
      </div>
      <Dialogs session={session} snapshot={snapshot} />
    </div>
  );
}

function DefragView({ session }: { session: DefragSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  if (snapshot.stage === "settings")
    return <Settings session={session} options={snapshot.options} />;
  if (snapshot.stage === "running")
    return <Running session={session} snapshot={snapshot} />;
  return <SelectDrive session={session} snapshot={snapshot} />;
}

/**
 * Disk Defragmenter, as Windows 98 had it: pick a drive, watch the clusters fall into line. It moves
 * nothing but coloured boxes; the run itself belongs to `DefragRunner`, so minimizing does not stop it.
 */
export function DefragWindow({ windowId }: { windowId: string }) {
  const sessions = useContext(DefragSessionsContext);
  const session = useSyncExternalStore(sessions.subscribe, () =>
    sessions.get(windowId),
  );
  return session ? <DefragView session={session} /> : null;
}
