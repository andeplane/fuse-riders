import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FakePaintFileDeps } from "../__mocks__/paintFiles";
import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import type { FakePaintSurface } from "../__mocks__/paintSurface";
import { Desktop } from "../desktop/Desktop";
import type { AppState, PaintWindowContent } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import { MemoryPaintPrefsStore } from "./paintPrefsStore";

describe("Paint", () => {
  it("opens untitled with the pencil, a 640x400 canvas and the Win98 palette", async () => {
    const { surfaces } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    expect(
      within(paint).getByRole("button", { name: "Pencil" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(paint)
        .getByRole("group", { name: "Colors" })
        .querySelectorAll("button"),
    ).toHaveLength(28);
    expect(within(paint).getByText("640x400")).toBeInTheDocument();
    expect(surfaces).toHaveLength(1);
  });

  it("draws with the chosen tool and colour, then undoes", async () => {
    const user = userEvent.setup();
    const { surfaces } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    const canvas = within(paint).getByLabelText("Drawing canvas");
    const surface = firstSurface(surfaces);

    await user.click(
      within(paint).getByRole("button", { name: "Color #ff0000" }),
    );
    await user.click(within(paint).getByRole("button", { name: "Brush" }));
    await user.click(within(paint).getByRole("radio", { name: "Size 8" }));
    drag(canvas, [10, 10], [20, 20]);
    expect(surface.ops).toEqual([
      "line 10,10-10,10 #ff0000 8",
      "line 10,10-20,20 #ff0000 8",
    ]);
    expect(within(paint).getByTestId("foreground-swatch")).toHaveStyle({
      background: "#ff0000",
    });

    await user.click(within(paint).getByRole("button", { name: "Rectangle" }));
    drag(canvas, [0, 0], [30, 15]);
    expect(surface.ops).toEqual([
      "line 10,10-10,10 #ff0000 8",
      "line 10,10-20,20 #ff0000 8",
      "rect 0,0 30x15 #ff0000/- 8",
    ]);

    await user.click(within(paint).getByRole("menuitem", { name: "Edit" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Undo" }),
    );
    expect(surface.ops).toEqual([
      "line 10,10-10,10 #ff0000 8",
      "line 10,10-20,20 #ff0000 8",
    ]);
    await user.click(within(paint).getByRole("menuitem", { name: "Edit" }));
    expect(
      within(paint).getByRole("menuitemcheckbox", { name: "Undo" }),
    ).toBeEnabled();
  });

  it("opens a Win98 Text dialog on click, typing plus OK draws the text as one undo step, and Cancel draws nothing", async () => {
    const user = userEvent.setup();
    const { surfaces } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    const canvas = within(paint).getByLabelText("Drawing canvas");
    const surface = firstSurface(surfaces);

    await user.click(within(paint).getByRole("button", { name: "Text" }));
    fireEvent.pointerDown(canvas, {
      clientX: 7,
      clientY: 8,
      button: 0,
      buttons: 1,
    });
    const dialog = await within(paint).findByRole("dialog", { name: "Text" });
    expect(surface.ops).toEqual([]);

    // Escape cancels without drawing.
    await user.type(
      within(dialog).getByLabelText("Text:"),
      "Discarded{Escape}",
    );
    expect(
      within(paint).queryByRole("dialog", { name: "Text" }),
    ).not.toBeInTheDocument();
    expect(surface.ops).toEqual([]);

    // Clicking again and typing plus OK draws the text at the click point.
    fireEvent.pointerDown(canvas, {
      clientX: 7,
      clientY: 8,
      button: 0,
      buttons: 1,
    });
    const reopened = await within(paint).findByRole("dialog", { name: "Text" });
    await user.type(within(reopened).getByLabelText("Text:"), "Pump 42{Enter}");
    expect(
      within(paint).queryByRole("dialog", { name: "Text" }),
    ).not.toBeInTheDocument();
    expect(surface.ops).toEqual(['text 7,8 "Pump 42" #000000']);

    await user.click(within(paint).getByRole("menuitem", { name: "Edit" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Undo" }),
    );
    expect(surface.ops).toEqual([]);
  });

  it("fills, picks colours and clears through the Image menu", async () => {
    const user = userEvent.setup();
    const { surfaces } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    const canvas = within(paint).getByLabelText("Drawing canvas");
    const surface = firstSurface(surfaces);

    await user.click(
      within(paint).getByRole("button", { name: "Fill With Color" }),
    );
    fireEvent.pointerDown(canvas, {
      clientX: 5,
      clientY: 5,
      button: 0,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      clientX: 5,
      clientY: 5,
      button: 0,
      buttons: 0,
    });
    expect(surface.ops).toEqual(["fill 5,5 #000000"]);

    surface.pixelColor = "#00ff00";
    await user.click(within(paint).getByRole("button", { name: "Pick Color" }));
    fireEvent.pointerDown(canvas, {
      clientX: 1,
      clientY: 1,
      button: 0,
      buttons: 1,
    });
    expect(within(paint).getByTestId("foreground-swatch")).toHaveStyle({
      background: "#00ff00",
    });

    await user.click(within(paint).getByRole("menuitem", { name: "Image" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Clear Image" }),
    );
    expect(surface.ops[surface.ops.length - 1]).toBe("clear #ffffff");
    await user.click(within(paint).getByRole("menuitem", { name: "Image" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Rotate 90°" }),
    );
    expect(within(paint).getByText("400x640")).toBeInTheDocument();
    await user.click(within(paint).getByRole("menuitem", { name: "Image" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Flip Horizontal" }),
    );
    expect(surface.ops[surface.ops.length - 1]).toBe("flip horizontal");
  });

  it("sets the drawing as wallpaper and asks before discarding changes on New", async () => {
    const user = userEvent.setup();
    const { surfaces, wallpaperStore } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    drag(within(paint).getByLabelText("Drawing canvas"), [1, 1], [2, 2]);

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Set As Wallpaper" }),
    );
    expect(wallpaperStore.get()).toBe("data:image/jpeg;base64,FAKE");

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "New" }),
    );
    const confirm = await within(paint).findByRole("dialog", { name: "Paint" });
    expect(confirm).toHaveTextContent("Discard the changes to untitled?");
    await user.click(within(confirm).getByRole("button", { name: "No" }));
    expect(firstSurface(surfaces).ops).toHaveLength(2);
    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "New" }),
    );
    await user.click(
      within(
        await within(paint).findByRole("dialog", { name: "Paint" }),
      ).getByRole("button", { name: "Yes" }),
    );
    expect(firstSurface(surfaces).ops).toEqual(["reset 640x400 #ffffff"]);
  });

  it("names the window after the file in the window state and asks about it before New, which returns it to untitled", async () => {
    const user = userEvent.setup();
    const { surfaces } = renderPaint({ fileName: "pump.png" });
    const paint = await screen.findByRole("dialog", {
      name: "pump.png - Paint",
    });
    expect(within(paint).getByText("640x400")).toBeInTheDocument();

    // Nothing is unsaved yet, so New starts a blank canvas without asking and the window is untitled again.
    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "New" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
    expect(firstSurface(surfaces).ops).toEqual(["reset 640x400 #ffffff"]);
  });

  it("asks to discard changes to the named file before New", async () => {
    const user = userEvent.setup();
    renderPaint({ fileName: "pump.png" });
    const paint = await screen.findByRole("dialog", {
      name: "pump.png - Paint",
    });
    drag(within(paint).getByLabelText("Drawing canvas"), [1, 1], [2, 2]);

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "New" }),
    );
    const confirm = await within(paint).findByRole("dialog", { name: "Paint" });
    expect(confirm).toHaveTextContent("Discard the changes to pump.png?");
    await user.click(within(confirm).getByRole("button", { name: "Yes" }));
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
  });

  it("File > Open draws the picked image, names the window after it and reports its size", async () => {
    const user = userEvent.setup();
    const { surfaces, files } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    files.nextPick = imageFile("cat.png");

    await openFileMenu(user, paint, "Open...");
    expect(
      await screen.findByRole("dialog", { name: "cat.png - Paint" }),
    ).toBeInTheDocument();
    expect(firstSurface(surfaces).ops).toEqual(["image image/png 320x200"]);
    expect(within(paint).getByText("320x200")).toBeInTheDocument();
    expect(
      within(paint).getByText("Opened cat.png (320x200)"),
    ).toBeInTheDocument();
    expect(
      within(paint).queryByRole("dialog", { name: "Paint" }),
    ).not.toBeInTheDocument();
  });

  it("leaves the drawing alone when the file picker is cancelled", async () => {
    const user = userEvent.setup();
    const { surfaces } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    drag(within(paint).getByLabelText("Drawing canvas"), [1, 1], [2, 2]);
    const before = [...firstSurface(surfaces).ops];

    await openFileMenu(user, paint, "Open...");
    const confirm = await within(paint).findByRole("dialog", { name: "Paint" });
    expect(confirm).toHaveTextContent("Discard the changes to untitled?");
    await user.click(within(confirm).getByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(
        within(paint).queryByRole("dialog", { name: "Paint" }),
      ).not.toBeInTheDocument(),
    );
    expect(firstSurface(surfaces).ops).toEqual(before);
    expect(
      screen.getByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
  });

  it("reports a file Paint cannot decode in an error window over the desktop and stays untitled", async () => {
    const user = userEvent.setup();
    const { surfaces, files } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    firstSurface(surfaces).loadError = new Error("Could not decode the image");
    files.nextPick = imageFile("notes.txt", "text/plain");

    await openFileMenu(user, paint, "Open...");
    const error = await screen.findByText(
      "Paint cannot open notes.txt: Could not decode the image",
    );
    expect(paint).not.toContainElement(error);
    expect(
      screen.getByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
    expect(
      within(paint).queryByRole("dialog", { name: "Paint" }),
    ).not.toBeInTheDocument();
  });

  it("reports a picker that fails as an error window", async () => {
    const user = userEvent.setup();
    const { files } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    files.pickError = new Error("Not allowed");

    await openFileMenu(user, paint, "Open...");
    expect(
      await screen.findByText("Paint cannot open the file: Not allowed"),
    ).toBeInTheDocument();
  });

  it("Save on an untitled drawing opens Save As, which downloads under the typed name and format and names the window", async () => {
    const user = userEvent.setup();
    const { files, paintPrefs } = renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });

    await openFileMenu(user, paint, "Save");
    const saveAs = await within(paint).findByRole("dialog", {
      name: "Save As",
    });
    const name = within(saveAs).getByLabelText("File name:");
    expect(name).toHaveValue("untitled");
    await user.clear(name);
    expect(within(saveAs).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(saveAs).toHaveTextContent("Downloads the file to this computer.");
    await user.type(name, "sketch");
    await user.selectOptions(
      within(saveAs).getByLabelText("Save as type:"),
      "image/jpeg",
    );
    expect(saveAs).toHaveTextContent("Downloads sketch.jpg to this computer.");
    await user.click(within(saveAs).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("dialog", { name: "sketch.jpg - Paint" }),
    ).toBeInTheDocument();
    expect(files.downloads).toHaveLength(1);
    expect(files.downloads[0]?.name).toBe("sketch.jpg");
    expect(files.downloads[0]?.blob.type).toBe("image/jpeg");
    expect(within(paint).getByText("Saved sketch.jpg")).toBeInTheDocument();
    expect(paintPrefs.get()).toEqual({ format: "image/jpeg" });

    // Now that the drawing has a name, Save downloads again without asking.
    await openFileMenu(user, paint, "Save");
    await waitFor(() => expect(files.downloads).toHaveLength(2));
    expect(files.downloads[1]?.name).toBe("sketch.jpg");
    expect(
      within(paint).queryByRole("dialog", { name: "Save As" }),
    ).not.toBeInTheDocument();
  });

  it("Save As on a named drawing starts from its name and the remembered format, and Cancel downloads nothing", async () => {
    const user = userEvent.setup();
    const paintPrefs = new MemoryPaintPrefsStore();
    paintPrefs.set({ format: "image/jpeg" });
    const { files } = renderPaint({ fileName: "pump.png" }, { paintPrefs });
    const paint = await screen.findByRole("dialog", {
      name: "pump.png - Paint",
    });

    await openFileMenu(user, paint, "Save As...");
    const saveAs = await within(paint).findByRole("dialog", {
      name: "Save As",
    });
    expect(within(saveAs).getByLabelText("File name:")).toHaveValue("pump.png");
    expect(within(saveAs).getByLabelText("Save as type:")).toHaveValue(
      "image/jpeg",
    );
    // The extension follows the format: pump.png saved as JPEG is pump.jpg.
    expect(saveAs).toHaveTextContent("Downloads pump.jpg to this computer.");
    await user.click(within(saveAs).getByRole("button", { name: "Cancel" }));
    expect(
      within(paint).queryByRole("dialog", { name: "Save As" }),
    ).not.toBeInTheDocument();
    expect(files.downloads).toEqual([]);

    // Enter in the name field saves too.
    await openFileMenu(user, paint, "Save As...");
    await user.type(
      within(
        await within(paint).findByRole("dialog", { name: "Save As" }),
      ).getByLabelText("File name:"),
      "{Enter}",
    );
    await waitFor(() => expect(files.downloads).toHaveLength(1));
    expect(files.downloads[0]?.name).toBe("pump.jpg");
    expect(
      await screen.findByRole("dialog", { name: "pump.jpg - Paint" }),
    ).toBeInTheDocument();
  });

  it("reports a save that fails as an error window and keeps the drawing", async () => {
    const user = userEvent.setup();
    const { files, surfaces } = renderPaint({ fileName: "pump.png" });
    const paint = await screen.findByRole("dialog", {
      name: "pump.png - Paint",
    });
    files.download = () => {
      throw new Error("Downloads are blocked");
    };
    drag(within(paint).getByLabelText("Drawing canvas"), [1, 1], [2, 2]);

    await openFileMenu(user, paint, "Save");
    expect(
      await screen.findByText(
        "Paint could not save pump.png: Downloads are blocked",
      ),
    ).toBeInTheDocument();
    expect(firstSurface(surfaces).ops).toHaveLength(2);
    expect(
      within(paint).queryByRole("dialog", { name: "Paint" }),
    ).not.toBeInTheDocument();
  });

  it("opens a window on a URL by fetching the image once, and Save downloads a copy under its name", async () => {
    const user = userEvent.setup();
    const url = "https://raw.example.test/repo/sha/art/logo.png";
    const prepared = new FakePaintFileDeps();
    prepared.images.set(url, new Blob(["png"], { type: "image/png" }));
    const { surfaces, files, store } = renderPaint(
      { fileName: "logo.png", sourceUrl: url },
      { files: prepared },
    );
    const paint = await screen.findByRole("dialog", {
      name: "logo.png - Paint",
    });
    await waitFor(() =>
      expect(firstSurface(surfaces).ops).toEqual(["image image/png 320x200"]),
    );
    expect(
      within(paint).getByText("Opened logo.png (320x200)"),
    ).toBeInTheDocument();

    // Re-renders never fetch again.
    await user.click(within(paint).getByRole("button", { name: "Brush" }));
    await user.click(within(paint).getByRole("button", { name: "Pencil" }));
    expect(files.fetched).toEqual([url]);

    await openFileMenu(user, paint, "Save");
    await waitFor(() => expect(files.downloads).toHaveLength(1));
    expect(files.downloads[0]?.name).toBe("logo.png");
    expect(files.downloads[0]?.blob.type).toBe("image/png");
    // The window is now on the downloaded copy, not the URL.
    const window = store.load().windows.find((item) => item.id === "w1");
    expect(window).toMatchObject({ kind: "paint", fileName: "logo.png" });
    expect(window).not.toHaveProperty("sourceUrl");
    expect(files.fetched).toEqual([url]);
  });

  it("reports a URL that cannot be fetched and returns the window to untitled", async () => {
    const url = "https://raw.example.test/repo/sha/missing.png";
    const { surfaces, store } = renderPaint({
      fileName: "missing.png",
      sourceUrl: url,
    });
    const error = await screen.findByText(
      "Paint cannot open missing.png: The server answered 404",
    );
    expect(error).toBeInTheDocument();
    expect(
      await screen.findByRole("dialog", { name: "untitled - Paint" }),
    ).toBeInTheDocument();
    expect(firstSurface(surfaces).ops).toEqual([]);
    const window = store.load().windows.find((item) => item.id === "w1");
    expect(window).not.toHaveProperty("sourceUrl");
  });
});

function renderPaint(
  content: Omit<PaintWindowContent, "kind"> = {},
  options: ProviderOptions & { files?: FakePaintFileDeps } = {},
) {
  const state: AppState = {
    ...DEFAULT_STATE,
    windows: [
      {
        id: "w1",
        minimized: false,
        maximized: false,
        kind: "paint",
        ...content,
      },
    ],
  };
  const { files = new FakePaintFileDeps(), ...providerOptions } = options;
  const paintPrefs = options.paintPrefs ?? new MemoryPaintPrefsStore();
  const rendered = renderWithProviders(<Desktop />, {
    initialState: state,
    paintDeps: { files },
    ...providerOptions,
    paintPrefs,
  });
  return { ...rendered, files, paintPrefs };
}

function imageFile(name: string, type = "image/png"): File {
  return new File(["pixels"], name, { type });
}

async function openFileMenu(
  user: ReturnType<typeof userEvent.setup>,
  paint: HTMLElement,
  item: string,
) {
  await user.click(within(paint).getByRole("menuitem", { name: "File" }));
  await user.click(within(paint).getByRole("menuitemcheckbox", { name: item }));
}

function drag(
  canvas: HTMLElement,
  from: [number, number],
  to: [number, number],
) {
  fireEvent.pointerDown(canvas, {
    clientX: from[0],
    clientY: from[1],
    button: 0,
    buttons: 1,
  });
  fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1], buttons: 1 });
  fireEvent.pointerUp(canvas, {
    clientX: to[0],
    clientY: to[1],
    button: 0,
    buttons: 0,
  });
}

function firstSurface(surfaces: readonly FakePaintSurface[]): FakePaintSurface {
  const [surface] = surfaces;
  if (!surface) throw new Error("No paint surface was created");
  return surface;
}
