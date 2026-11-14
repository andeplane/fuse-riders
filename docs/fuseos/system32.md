# Deleting SYSTEM32

A purely cosmetic gag in `packages/fuseos/src/system32/`. Nothing touches a file system: the
"folder" is a list entry in the in-app Explorer, and the "breakage" is CSS classes on a wrapper
element the provider renders around the desktop. State lives in memory only; the fake restart,
unmounting the provider, or a reload restores everything.

## What happens

1. Explorer calls `remove()` on the fake `SYSTEM32` folder.
2. Three escalating questions: "Are you sure...?", "FuseOS really likes this folder. Really?",
   "OK, you asked for it." "No" or Escape on any of them ends it.
3. Over about 60 seconds (`FOLD_STAGES` in `system32Machine.ts`): desktop icons fade one by one,
   fonts turn to Comic Sans, window titles get misspelt, the Start button wobbles, Clippy looks
   alarmed, the last icons go, the screen leans, then flickers. Each stage adds a class
   (`s32-icons-1`, `s32-comic-sans`, ...) to `.s32-root`; `system32.css` does the rest.
4. A blue screen (`BlueScreen.tsx`, or the host's `showBsod` if injected), then a short black
   "restarting" screen, then the desktop as it was.

## Integration contract for the Explorer

`explorerContract.ts`:

```ts
import {
  SYSTEM32_FOLDER,
  useSystem32Folder,
} from "../system32/explorerContract";

const system32 = useSystem32Folder();
// list `system32.entry` (name "SYSTEM32", parentPath "C:\\WINDOWS", icon "folder") while `system32.present`
// on Delete: system32.remove()   -- opens the first question; do not add a confirm of your own
```

`present` goes false once the user has said "Yes" three times and comes back true after the
restart. `remove()` is a no-op while a sequence is running. The provider is mounted in
`Shell.tsx`, so any component under the desktop can use the hook.

Window titles: `WindowChrome` already shows `useSystem32Title(title)`. The taskbar buttons and
anything else that prints a window title can call the same hook.

## Dependencies

`System32DepsContext` (`system32Deps.ts`): a `Scheduler` (`window.setTimeout` in the app,
`MemoryScheduler` in tests), an optional `showBsod(): Promise<void> | void` that replaces the
built-in blue screen (the restart follows when the promise resolves, or after `BSOD_MS` for a
plain call), and the optional `demo` below.

## Demo trigger

Hidden query parameter, parsed in `demoTrigger.ts` and dropped from the address on boot:

- `?fold=now` plays the whole thing from the first question.
- `?fold=stage:N` lands on the first `N` stages (0..10) and holds there, for screenshots.
- `?fold=bsod` goes straight to the blue screen and the restart.
