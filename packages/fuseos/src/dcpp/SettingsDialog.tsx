import { useState } from "react";

import type { ShareDir } from "./dcClient";
import { formatBytes } from "./format";

export type SettingsValues = {
  nick: string;
  shareDirs: ShareDir[];
};

/**
 * File > Settings: the 0.4xx property sheet, with the two pages that matter here: General (who you are) and
 * Sharing (what you share). "Add folder" offers the one folder this computer has worth sharing, C:\, which is
 * the fuse-games repository and conveniently big enough for FuseHub.
 */
export function SettingsDialog({
  initial,
  repoSize,
  repoReady,
  onOk,
  onCancel,
}: {
  initial: SettingsValues;
  repoSize: number;
  repoReady: boolean;
  onOk: (values: SettingsValues) => void;
  onCancel: () => void;
}) {
  const [page, setPage] = useState<"general" | "sharing">("general");
  const [nick, setNick] = useState(initial.nick);
  const [dirs, setDirs] = useState<ShareDir[]>(initial.shareDirs);
  const [selected, setSelected] = useState<string>();
  const [browsing, setBrowsing] = useState(false);
  const total = dirs.reduce((sum, dir) => sum + dir.size, 0);
  const hasC = dirs.some((dir) => dir.directory === "C:\\");

  return (
    <div className="dc-modal" role="presentation">
      <div className="window dc-settings" role="dialog" aria-label="Settings">
        <div className="title-bar">
          <div className="title-bar-text">Settings</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onCancel} />
          </div>
        </div>
        <div className="window-body dc-settings-body">
          <ul
            className="dc-settings-tree"
            role="tree"
            aria-label="Settings pages"
          >
            {(
              [
                ["general", "General"],
                ["sharing", "Sharing"],
              ] as const
            ).map(([id, label]) => (
              <li key={id} role="treeitem" aria-selected={page === id}>
                <button
                  type="button"
                  className="flat"
                  onClick={() => setPage(id)}
                >
                  {label}
                </button>
              </li>
            ))}
            {[
              "Downloads",
              "Appearance",
              "Logs and Sound",
              "Advanced",
              "User Commands",
            ].map((label) => (
              <li
                key={label}
                role="treeitem"
                aria-selected={false}
                aria-disabled
              >
                <button type="button" className="flat" disabled>
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div className="dc-settings-page">
            {page === "general" ? (
              <>
                <fieldset className="dc-group">
                  <legend>Personal information</legend>
                  <div className="dc-formrow">
                    <label htmlFor="dc-nick">Nick</label>
                    <input
                      id="dc-nick"
                      type="text"
                      value={nick}
                      onChange={(event) => setNick(event.target.value)}
                    />
                  </div>
                  <div className="dc-formrow">
                    <label htmlFor="dc-email">E-Mail</label>
                    <input id="dc-email" type="text" disabled defaultValue="" />
                  </div>
                  <div className="dc-formrow">
                    <label htmlFor="dc-desc">Description</label>
                    <input id="dc-desc" type="text" disabled defaultValue="" />
                  </div>
                  <div className="dc-formrow">
                    <label htmlFor="dc-conn">Connection</label>
                    <select id="dc-conn" disabled defaultValue="DSL">
                      <option>DSL</option>
                    </select>
                  </div>
                </fieldset>
                <fieldset className="dc-group">
                  <legend>Connection settings</legend>
                  <div className="field-row">
                    <input
                      id="dc-active"
                      type="radio"
                      name="dc-mode"
                      defaultChecked
                    />
                    <label htmlFor="dc-active">Active</label>
                  </div>
                  <div className="field-row">
                    <input
                      id="dc-passive"
                      type="radio"
                      name="dc-mode"
                      disabled
                    />
                    <label htmlFor="dc-passive">Passive</label>
                  </div>
                </fieldset>
              </>
            ) : (
              <fieldset className="dc-group dc-sharing">
                <legend>Shared directories</legend>
                <div className="dc-list dc-sharelist">
                  <table role="grid" aria-label="Shared directories">
                    <thead>
                      <tr>
                        <th scope="col">Directory</th>
                        <th scope="col" className="dc-right">
                          Size
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dirs.map((dir) => (
                        <tr
                          key={dir.directory}
                          aria-selected={selected === dir.directory}
                          onMouseDown={() => setSelected(dir.directory)}
                        >
                          <td>{dir.directory}</td>
                          <td className="dc-right">{formatBytes(dir.size)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="dc-sharebar">
                  <span>Total size: {formatBytes(total)}</span>
                  <span className="field-row">
                    <input id="dc-hidden" type="checkbox" disabled />
                    <label htmlFor="dc-hidden">Share hidden files</label>
                  </span>
                  <span className="dc-sharebuttons">
                    <button
                      type="button"
                      disabled={!selected}
                      onClick={() => {
                        setDirs(
                          dirs.filter((dir) => dir.directory !== selected),
                        );
                        setSelected(undefined);
                      }}
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setBrowsing(true)}>
                      Add folder
                    </button>
                  </span>
                </div>
              </fieldset>
            )}
            {page === "sharing" ? (
              <div className="dc-slots field-row">
                <label htmlFor="dc-slots">Upload slots</label>
                <input id="dc-slots" type="number" value={3} readOnly />
              </div>
            ) : null}
          </div>
        </div>
        <div className="dc-dialogbuttons">
          <button type="button" onClick={() => onOk({ nick, shareDirs: dirs })}>
            OK
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      {browsing ? (
        <div
          className="window dc-browse"
          role="dialog"
          aria-label="Browse for Folder"
        >
          <div className="title-bar">
            <div className="title-bar-text">Browse for Folder</div>
          </div>
          <div className="window-body">
            <p>Choose a directory to share:</p>
            <ul
              className="dc-tree dc-browsetree"
              role="tree"
              aria-label="Folders"
            >
              <li role="treeitem" aria-selected={false}>
                <button type="button" className="flat" disabled>
                  3½ Floppy (A:) — drive not ready
                </button>
              </li>
              <li role="treeitem" aria-selected={false}>
                <button
                  type="button"
                  className="flat"
                  disabled={hasC || !repoReady}
                  onClick={() => {
                    setDirs([
                      ...dirs,
                      {
                        virtualName: "fuse-games",
                        directory: "C:\\",
                        size: repoSize,
                      },
                    ]);
                    setBrowsing(false);
                  }}
                >
                  (C:) fuse-games —{" "}
                  {repoReady ? formatBytes(repoSize) : "reading drive..."}
                </button>
              </li>
            </ul>
            <div className="dc-dialogbuttons">
              <button type="button" onClick={() => setBrowsing(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
