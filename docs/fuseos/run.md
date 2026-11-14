# Run

Start > Run... opens the Windows 98 Run box (`packages/fuseos/src/run/`, window kind `run`, one instance):
"Type the name of a program, folder, document, or Internet resource, and FuseOS will open it for you." Win+R
opens it too where the browser passes the Windows key on to the page; on an Apple device the same chord is
Cmd+R, the browser's Reload, so it is left alone there (`isRunChord` in `lib/shortcuts.ts`,
`DesktopDeps.isApplePlatform`). `?open=run` opens it on boot.

`resolveRunCommand` (`runCommand.ts`, pure) decides what a line means, in this order:

| Typed                                            | Opens                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://...`                                    | The address in a browser tab                                                                                                                                                                                    |
| `bsod`                                           | The Blue Screen of Death (`useBsod().showBsod()`)                                                                                                                                                               |
| A Fuse game's id (`fuseball`, `fuse-riders`...)  | The game through `useFuseGameLauncher`: a window or a tab, as the Games applet says                                                                                                                             |
| A retro game's id (`doom`, `wolf3d`, `keen1`...) | The game's window                                                                                                                                                                                               |
| A program's name                                 | The names `?open=` knows (`state/deepLink.ts`): `winamp`, `notepad`, `explorer`, `fusteam`, `paint`, `dosgames`, `friends`, `network`, `halloffame`, `taskmanager`, `recyclebin`, `dialup`, `settings`, `about` |
| A drive or Windows folder                        | Explorer on `A:\`, `C:\`, `C:\WINDOWS` or `C:\WINDOWS\SYSTEM32`                                                                                                                                                 |
| Anything else                                    | "Cannot find the file '...' (or one of its components)." and the box stays open                                                                                                                                 |

Names are case-insensitive, a trailing `.exe`, `.com`, `.bat` or `.lnk` is dropped, and `RUN_ALIASES` maps the
names people remember (`mspaint`, `taskmgr`, `control`, `sol`, `winmine`, `steam`, `icq`...) onto those ids. A
program added to `deepLink.ts` runs by its id with no change here. Network Neighborhood and Fuse Messenger go
through Dial-Up Networking first, as they do from the Start menu (`useDialUpCommands`). The Open box suggests
the installed games and the program names; Browse... opens My Computer.
