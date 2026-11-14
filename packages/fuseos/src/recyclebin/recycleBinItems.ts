import type { IconName } from "../ui/icons";

/**
 * What double clicking a "deleted" file does. Nothing here is a real file: a video opens the
 * media player (which fails on every codec except the one Fuse Volley "ships"), anything else
 * shows the classic "cannot open a file in the Recycle Bin" box.
 */
export type RecycleBinOpenBehaviour =
  { kind: "video"; launches?: string } | { kind: "locked" };

export type RecycleBinItem = {
  /** Stable id the store remembers restores and deletions by; never shown. */
  id: string;
  name: string;
  originalLocation: string;
  /** Epoch milliseconds; shown as "Date Deleted". */
  deletedAt: number;
  type: string;
  /** Bytes. */
  size: number;
  icon: IconName;
  open: RecycleBinOpenBehaviour;
};

/** The game a beach-volleyball "video" really is (its portal id, `games/fuse-volley/`). */
export const FUSE_VOLLEY_GAME_ID = "fuse-volley";

const KB = 1024;
const MB = 1024 * KB;

function at(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

/**
 * The files found in the bin on a fresh install. Every name is a pun and every "video" is a
 * title card for a joke, nothing more: the player never shows a frame of anything.
 */
export const RECYCLE_BIN_ITEMS: readonly RecycleBinItem[] = [
  {
    id: "old-netcode",
    name: "old_netcode_v1.ts",
    originalLocation: "C:\\fuse-riders\\packages\\fuse-netcode",
    deletedAt: at(1998, 3, 14, 2, 17),
    type: "TypeScript Source File",
    size: 412 * KB,
    icon: "file",
    open: { kind: "locked" },
  },
  {
    id: "bug-free",
    name: "bug_free_code.exe",
    originalLocation: "C:\\Program Files\\Fuse",
    deletedAt: at(1998, 4, 1, 0, 0),
    type: "Application",
    size: 0,
    icon: "programs",
    open: { kind: "locked" },
  },
  {
    id: "lan-server",
    name: "LAN_server_RIP.zip",
    originalLocation: "C:\\fuse-riders\\service",
    deletedAt: at(1998, 6, 27, 23, 59),
    type: "WinZip File",
    size: 2718 * KB,
    icon: "documents",
    open: { kind: "locked" },
  },
  {
    id: "todo",
    name: "TODO_before_launch.txt",
    originalLocation: "C:\\My Documents",
    deletedAt: at(1998, 7, 4, 9, 5),
    type: "Text Document",
    size: 48 * MB,
    icon: "file",
    open: { kind: "locked" },
  },
  {
    id: "final-final",
    name: "logo_final_FINAL_v3_really.bmp",
    originalLocation: "C:\\My Documents\\Art",
    deletedAt: at(1998, 8, 19, 16, 40),
    type: "Bitmap Image",
    size: 2304 * KB,
    icon: "image",
    open: { kind: "locked" },
  },
  {
    id: "desync",
    name: "desync_repro_steps.doc",
    originalLocation: "C:\\My Documents\\Bugs",
    deletedAt: at(1998, 9, 2, 11, 11),
    type: "Word Document",
    size: 1 * KB,
    icon: "file",
    open: { kind: "locked" },
  },
  {
    id: "sleep",
    name: "sleep_schedule.xls",
    originalLocation: "C:\\My Documents",
    deletedAt: at(1998, 10, 31, 3, 33),
    type: "Excel Worksheet",
    size: 0,
    icon: "file",
    open: { kind: "locked" },
  },
  {
    id: "debbie",
    name: "Debbie_Does_Netcode.avi",
    originalLocation: "C:\\Windows\\Temp\\definitely_not_videos",
    deletedAt: at(1998, 11, 13, 23, 45),
    type: "Video Clip",
    size: 697 * MB,
    icon: "video",
    open: { kind: "video" },
  },
  {
    id: "hot-singles",
    name: "Hot_Singles_In_Your_Lobby.mpg",
    originalLocation: "C:\\Windows\\Temp\\definitely_not_videos",
    deletedAt: at(1998, 11, 13, 23, 46),
    type: "Movie Clip (MPEG)",
    size: 512 * MB,
    icon: "video",
    open: { kind: "video" },
  },
  {
    id: "fifty-shades",
    name: "Fifty_Shades_of_Teal.avi",
    originalLocation: "C:\\Windows\\Temp\\definitely_not_videos",
    deletedAt: at(1998, 11, 13, 23, 47),
    type: "Video Clip",
    size: 640 * MB,
    icon: "video",
    open: { kind: "video" },
  },
  {
    id: "lag-spikes",
    name: "Lag_Spikes_Gone_Wild.mpg",
    originalLocation: "C:\\Windows\\Temp\\definitely_not_videos",
    deletedAt: at(1998, 11, 13, 23, 48),
    type: "Movie Clip (MPEG)",
    size: 333 * MB,
    icon: "video",
    open: { kind: "video" },
  },
  {
    id: "naughty-nulls",
    name: "Naughty_Null_Pointers.avi",
    originalLocation: "C:\\Windows\\Temp\\definitely_not_videos",
    deletedAt: at(1998, 11, 13, 23, 49),
    type: "Video Clip",
    size: 0,
    icon: "video",
    open: { kind: "video" },
  },
  {
    id: "beach-volley",
    name: "Fuse_Volley_Beach_Edition_UNCUT.avi",
    originalLocation: "C:\\Windows\\Temp\\definitely_not_videos",
    deletedAt: at(1998, 11, 13, 23, 50),
    type: "Video Clip",
    size: 1337 * MB,
    icon: "video",
    open: { kind: "video", launches: FUSE_VOLLEY_GAME_ID },
  },
];

/** Explorer's size column: whole kilobytes, rounded up, with thousands separators; "0KB" for an empty file. */
export function formatRecycleBinSize(bytes: number): string {
  const kb = Math.ceil(bytes / KB);
  return `${kb.toLocaleString("en-US")}KB`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Explorer's date column: "11/13/1998 11:45 PM". */
export function formatDeletedAt(deletedAt: number): string {
  return DATE_FORMAT.format(deletedAt).replace(",", "");
}
