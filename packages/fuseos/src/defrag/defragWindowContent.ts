import type { DefragDrive, DefragStage } from "./defragSession";

/**
 * Disk Defragmenter (Start > Programs > Accessories > System Tools). One instance; the run itself is
 * transient (`defragSession.ts`), and what is mirrored here is only what the title bar, the taskbar and
 * the window's size need: which dialog is up, on which drive, and how far along it is.
 */
export interface DefragWindowContent {
  kind: "defrag";
  /** With `stage: "running"` the window opens straight into a run on this drive ("Defragment Now..."). */
  drive?: DefragDrive;
  stage?: DefragStage;
  /** Show Details is on: the window is large enough for the cluster grid. */
  details?: boolean;
  percent?: number;
}

export function isDefragWindowContent(value: Record<string, unknown>): boolean {
  return (
    (value.drive === undefined || value.drive === "C" || value.drive === "A") &&
    (value.stage === undefined ||
      value.stage === "select" ||
      value.stage === "settings" ||
      value.stage === "running") &&
    (value.details === undefined || typeof value.details === "boolean") &&
    (value.percent === undefined ||
      (typeof value.percent === "number" && Number.isFinite(value.percent)))
  );
}

export const DEFRAG_TITLE = "Disk Defragmenter";

type Size = { width: number; height: number };

export const DEFRAG_SELECT_SIZE: Size = { width: 380, height: 212 };
export const DEFRAG_SETTINGS_SIZE: Size = { width: 380, height: 286 };
export const DEFRAG_COMPACT_SIZE: Size = { width: 430, height: 176 };
/** Room for 68 x 32 clusters above the status strip. */
export const DEFRAG_DETAILS_SIZE: Size = { width: 640, height: 480 };

/** Title and size for the dialog the program is showing; the taskbar reads the percent from the title. */
export function defragWindowMeta(window: Omit<DefragWindowContent, "kind">): {
  title: string;
  size: Size;
} {
  if (window.stage === "settings")
    return {
      title: `${DEFRAG_TITLE} Settings`,
      size: DEFRAG_SETTINGS_SIZE,
    };
  if (window.stage === "running")
    return {
      title: `${Math.round(window.percent ?? 0)}% - Defragmenting Drive ${window.drive ?? "C"}`,
      size: window.details ? DEFRAG_DETAILS_SIZE : DEFRAG_COMPACT_SIZE,
    };
  return { title: "Select Drive", size: DEFRAG_SELECT_SIZE };
}
