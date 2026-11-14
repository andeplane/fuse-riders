# My Computer: the C: and A: drives

FuseOS's Explorer shows two drives. **Fuse Riders (C:)** is this repository, read straight from
GitHub; **3½ Floppy (A:)** is a 1997 backup disk that exists only for the joke. Notepad++ opens
the text files on either; what it saves stays in the browser.

## Where C: comes from

- **The manifest.** `scripts/fuseos/repo-tree-plugin.ts` is a Vite plugin registered in
  `vite.config.ts`. At build time it runs `git ls-tree -r -l HEAD`, `git rev-parse HEAD` and
  `git log -1 --format=%cI` and writes `fuseos/repo-tree.json` into `dist/`: every committed
  file with its size, the commit sha, its date, the repository slug (`GITHUB_REPOSITORY`, else the
  `origin` remote, else `andeplane/fuse-riders`) and the fallback branch (`main`). The dev server
  serves the same JSON, rebuilt on each request, so a new commit shows up without a restart.
- **Zero API calls.** The manifest is fetched once, lazily, when the first Explorer, Notepad++ or
  Paint opens a picture (`src/disk/useDisk.ts`), and shared by every window. File contents
  come from `https://raw.githubusercontent.com/<repo>/<sha>/<path>`: immutable, CORS-enabled and
  outside the GitHub API's rate limits.
- **The sha is the deployed build's.** In GitHub Actions the checked-out `HEAD` is what Pages
  deploys, so every file is read at exactly that commit. A local build or `vite dev` may be on a
  commit that is not pushed; the first 404 at that sha switches the source to the fallback branch
  for the rest of the session and Notepad++'s status bar says so ("This build's commit is not on
  GitHub yet; showing the file as it is on main."). A picture Paint opens resolves its URL the same way (`DiskSource.imageUrl`).
- **Committed files only.** Sizes and the listing are what `HEAD` contains, which is exactly what
  raw.githubusercontent.com serves for that sha. Uncommitted edits in a working tree are invisible
  to the desktop by design.

## What opens how

`src/disk/fileTypes.ts` decides by extension (`src/explorer/openEntry.ts` applies it):

| Kind                              | Double click                                                        |
| --------------------------------- | ------------------------------------------------------------------- |
| Text up to 512 KB                 | Notepad++ (a new tab in the open window)                            |
| Text over 512 KB                  | "Notepad++" dialog: too large, read it on GitHub                    |
| Image (png, jpg, gif, webp, svg…) | Paint, read-only: fetched from GitHub by URL; Save downloads a copy |
| Anything else (zip, mp3, wasm…)   | Win95 "Open With" dialog: Windows cannot open this file             |

**Images and Paint.** A picture opens in Paint through its `sourceUrl` (`DiskSource.imageUrl`
names the raw URL at the build's commit, or on the fallback branch after one HEAD request finds
the commit is not on GitHub). Paint draws it and its Save downloads a copy; nothing is written
back.

## Explorer

`src/explorer/` is Windows 98's "Exploring" window, measured from a 640x480 screenshot of the real
one (`explorer.css` holds the sizes): a rebar of three bands (the menu bar with the logo that moves
while a drive is read, the Standard Buttons, the Address combo box), an **All Folders** pane with a
16px-row tree and dotted lines, the listing, and a status bar of three panels (objects, size, where
the listing comes from).

- **Tree.** Desktop at the root, My Computer under it, then the drives; a folder gets a box only
  when it has folders inside, and the tree opens down to the folder being shown.
- **Views.** Large Icons, Small Icons, List (the one it opens in) and Details, from View, the pane's
  context menu or the Views button, which steps to the next view. Details has a sortable header
  (Name, Size, Type, Modified; folders stay above files).
- **Buttons.** Back and Forward (each with a drop-down of the places it would go), Up, Delete,
  Properties and Views work. Cut, Copy, Paste and Undo are always grey: the disk is read only.
  Delete on a file with a saved copy reverts it; on anything else it is "Access is denied".
  The pictures are pixel grids in `pixelIcons.ts`, grey until the pointer is over them.
- **Address.** Accepts `C:\packages\fuseos`, `c:/packages/fuseos`, `My Computer` or `Desktop`; its
  drop-down lists the way down to this folder and the other drives.
- **Keyboard.** The shortcuts registered in `src/lib/shortcuts.ts`: arrows, Enter, Backspace,
  Escape, Shift+F10 and Alt+Enter for Properties.

Every file on C: shows the commit's date as its modified time. A file with a saved copy in the
browser carries a blue `*` after its name ("Saved copy on this computer"); the context menu and File
menu offer **Revert to original**.

Locations are strings so a window survives a reload: `""` is My Computer, `"C:"` a drive root,
`"C:/packages/fuseos"` a folder, `"A:/porn"` the floppy's folder (`src/disk/diskPath.ts`).
`"shell:desktop"` is the Desktop, and `src/explorer/shellNamespace.ts` owns everything above the
drives.

### System folders

Printers, Control Panel, Dial-Up Networking and Scheduled Tasks list under My Computer as Windows
has them. They are programs, not places: Control Panel opens the Control Panel, the others say why
there is nothing to open. **Network Neighborhood** and the **Recycle Bin** appear on the Desktop
only when their program is installed. Explorer finds them by the id of a Start menu registration
(`network-neighborhood` or `network`, `recycle-bin` or `recyclebin`, see `OPTIONAL_FOLDERS`) and
calls that registration's `open`, so it never imports the program itself.

## The floppy (A:)

Opening A: from another drive plays a synthesized head seek (`src/disk/floppySound.ts`, Web
Audio, no asset) and shows "Reading drive A:..." for 1.4 s. The disk holds exactly:

- `slackbacup.zip`, 1.35 MB, dated 14 August 1997. Opening it shows a WinZip-style box that
  "extracts" a 1997 home directory with a progress bar, then fails at 87%:
  _"slackbacup.zip is corrupt. Disk in drive A: may be a coaster."_ Nothing is extracted; there is
  no archive.
- a folder named `porn` (the joke is the name; the contents are strictly safe for work). It is behind
  Windows 98's "Enter Network Password" box (`explorer/NetworkPasswordDialog.tsx`: "You must supply
  a password to make this connection:", Resource `\\A:\porn`, a masked field, OK/Cancel), however
  it is reached: a double click, the address bar, Back, the tree or a window restored inside it. A
  wrong password gets "The password is incorrect. Access is denied."; every third wrong one, Clippy
  says _"It looks like you're trying to get into the porn folder. Would you like help?"_. The
  password is `mender`, in any case: the box says "Connecting to \\A:\porn..." and "Access
  granted." (`DiskDeps.logonPause`), then the folder opens on its only file,
  `definitely_not_porn.avi`, which plays by itself in the Media Player titled "Never Gonna Give You
  Up.avi": a rickroll through YouTube's privacy-enhanced embed (`mediaplayer/streams.ts`; nothing is
  downloaded or copied). The gate is per desktop and in memory: a reload asks again.

Everything on A: lives in `src/disk/floppy.ts`.

## Notepad++

`src/notepadpp/`: tabs, a File / Edit / View / Help menu bar and the six-field status bar
(language, notice, length and lines, Ln/Col, UTF-8, INS). The editor is CodeMirror 6 with a theme
and highlight style after Notepad++'s defaults (`codemirrorEditor.ts`), loaded by dynamic import
the first time a window mounts, so it never enters the desktop's initial bundle
(`tests/fuseos-disk.test.ts` walks the static import graph to keep it that way). Highlighting
covers ts, tsx, js, jsx, json, md, css, html and yml; anything else is "Normal text file".

- **Save (Ctrl+S)** writes the tab's text to the **overlay**, an IndexedDB store
  (`fuseos-disk` / `files`, `src/disk/diskOverlay.ts`, `DiskOverlay` interface with a
  `MemoryDiskOverlay` fake). The saved copy shadows the committed text in every window and
  survives reloads; it exists only in that browser. Nothing is ever sent to GitHub.
- **Revert to original** removes the overlay copy and shows the committed text again.
- A tab shows `*` while it holds unsaved typing and `●` once a saved copy exists. Closing a dirty
  tab asks "Save file?" (Yes / No / Cancel); closing the last tab closes the window.
- A save or revert made elsewhere (Explorer, another tab, the Office Assistant) updates an open
  tab unless it has unsaved typing, which is kept.

## EditorCommands for the Office Assistant

`src/notepadpp/editorCommands.ts` exports the `EditorCommands` interface (`open`, `readFile`,
`writeFile`, `listModified`, `revert`), the `useEditorCommands()` hook that builds it from the
disk deps and the window commands, `EditorCommandsContext` for injecting a fake, and
`EditorCommandsProvider`. Paths are editor paths: a repository path on C:
(`packages/fuseos/src/App.tsx`) or an `A:/...` location. Phase C's Clippy `[edit:<path>]` tool
is meant to read the file through `readFile`, write the replacement through `writeFile` (which the
open tab follows) and offer `revert` as the undo; every change lands on "your C: drive" only.

## Dependencies and fakes

`src/disk/diskDepsContext.ts` bundles what the drives need (`DiskDeps`: the `DiskSource`, the
`DiskOverlay`, the `FloppyJokeGate` and `floppySeek`). Production deps are built on first use;
tests get `createTestDiskDeps()` from `src/__mocks__/disk.ts` (a fixture repository in memory, an
empty overlay, an instant seek) and the textarea-backed `FakeEditor` from `src/__mocks__/editor.ts`
through `EditorDepsContext`, both wired into `renderWithProviders`.
