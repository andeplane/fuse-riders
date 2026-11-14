import { useSystem32 } from "./System32Provider";

/**
 * Integration contract for the Explorer (built elsewhere): the fake folder it lists and the
 * callback its "Delete" runs. Nothing here is a file; the folder is a list entry and removing
 * it starts a cosmetic sequence that restores itself.
 *
 * In the Explorer:
 *   const system32 = useSystem32Folder();
 *   ...list `SYSTEM32_FOLDER` under `SYSTEM32_FOLDER.parentPath` while `system32.present`...
 *   onDelete={() => system32.remove()}   // opens the first of three questions; no confirm of your own
 *
 * `remove()` is a no-op while a sequence is already running. `present` goes false once the user
 * says "Yes" three times and comes back true after the fake restart (the folder is "reinstalled").
 * The provider lives in Shell.tsx, so any component under the desktop can call this hook.
 */
export type FakeFolderEntry = {
  /** Display name, as the real one is spelt. */
  name: "SYSTEM32";
  /** Where it is listed: a fake WINDOWS folder on the fake C: drive. */
  parentPath: "C:\\WINDOWS";
  icon: "folder";
  /** Shown in a details view; purely decorative. */
  description: string;
};

export const SYSTEM32_FOLDER: FakeFolderEntry = {
  name: "SYSTEM32",
  parentPath: "C:\\WINDOWS",
  icon: "folder",
  description: "System folder. Please do not.",
};

export type System32FolderHandle = {
  entry: FakeFolderEntry;
  /** Whether Explorer should list the folder right now. */
  present: boolean;
  /** The user asked to remove the folder. */
  remove: () => void;
};

export function useSystem32Folder(): System32FolderHandle {
  const { folderGone, removeSystem32 } = useSystem32();
  return {
    entry: SYSTEM32_FOLDER,
    present: !folderGone,
    remove: removeSystem32,
  };
}
