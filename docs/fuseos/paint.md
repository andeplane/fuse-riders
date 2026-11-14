# Paint

Paint is the Win98 drawing program on the FuseOS desktop
(`packages/fuseos/src/paint/`): pencil, brush, eraser, line, rectangle,
ellipse, fill, colour picker and text on a 640x400 canvas, with twenty undo
steps, flip and rotate, the Win98 palette and Set As Wallpaper. This document
covers where its files come from and go to; the drawing core is unchanged from
the port.

## Files stay on this computer

Paint has no server. Everything under File goes through the browser:

| Menu item  | What happens                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open...    | The browser's own file picker (`<input type="file" accept="image/*">`). The picked file is decoded with `createImageBitmap` (an `<img>` when that is missing), the canvas takes its size and the window is named after it. Unsaved changes ask "Discard the changes to ...?" first.         |
| Save       | Downloads the canvas under the window's name (`sketch.png` saves as `sketch.png` again; the browser adds a suffix if the Downloads folder already has one). An untitled drawing opens Save As instead.                                                                                      |
| Save As... | A Win98 dialog with a file name and a format (PNG or JPEG). Saving encodes the canvas with `canvas.toBlob` and hands it to the browser as a download through a temporary `<a download>`; the window takes the new name. The format chosen is remembered in `localStorage` (`fuseos.paint`). |

Nothing is uploaded anywhere, and the Save As dialog says so. A file that does
not decode, a picker the browser refuses, or a download that fails ends in one
Win98 error box over the desktop ("Paint cannot open notes.txt: ...") and the
canvas stays usable; a failed Open leaves the window untitled.

## Opening an image by URL (Explorer, deep links)

Other apps open an image in Paint without a picker by opening a Paint window on
a URL. The window content carries it:

```ts
import { imageFromUrl, openImageFromUrl } from "../paint/paintFiles";

// Explorer (B11) double-clicking art/logo.png in the repo:
openImageFromUrl(commands, rawUrl, "logo.png");
// or, for a deep link or a custom open:
commands.open(imageFromUrl(rawUrl)); // named after the URL's last segment
```

`PaintWindowContent` is `{ kind: "paint"; fileName?: string; sourceUrl?: string }`
(`src/state/appState.ts`). When `sourceUrl` is set the window fetches it once
after the canvas mounts (`PaintFileDeps.fetchImage`, a plain `fetch`, so the
URL must be same origin or CORS enabled, which `raw.githubusercontent.com`
is), draws it and names the window `fileName`. It is an import in the
read-only sense: Save never writes back to the URL, it downloads a copy under
the window's name, after which the window is on that copy and `sourceUrl` is
cleared. A URL that cannot be fetched or decoded shows the error box and
returns the window to untitled. Each URL is loaded once per mount; re-renders
and dependency changes never refetch it.

## Dependency injection

`PaintDeps` (`paintDepsContext.ts`) carries the two browser pieces Paint
needs: `createSurface` (the 2D context) and `files`, a `PaintFileDeps`:

```ts
interface PaintFileDeps {
  pickImage(): Promise<File | undefined>; // undefined = cancelled
  download(blob: Blob, name: string): void;
  fetchImage(url: string): Promise<Blob>;
}
```

`createBrowserPaintFileDeps()` in `paintFiles.ts` is the real one (its
document, object URLs, `fetch` and the revoke timer are injectable for unit
tests); `src/__mocks__/paintFiles.ts` has `FakePaintFileDeps`, which scripts
what the picker answers, collects downloads and serves URLs from a map. The
test wrapper (`renderWithProviders`) installs the fake by default, so a window
test sets `files.nextPick` and clicks Open.

The open and save flows themselves are `createPaintFileActions`
(`paintFileActions.ts`): pure logic over the session, the reducer, the prefs
store and `PaintFileDeps`, so they are tested without React. The view model
(`usePaintViewModel.ts`) wires them to the menus and to the `sourceUrl`
effect; `PaintControls.openImage` (the Office Assistant's path) still goes
through the same discard confirmation and then the picker.
