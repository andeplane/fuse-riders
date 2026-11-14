import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import type { FakePaintSurface } from "../__mocks__/paintSurface";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import { LOCAL_FILES_NOTICE } from "./usePaintViewModel";

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
    const { surfaces } = renderPaint("pump.png");
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
    renderPaint("pump.png");
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

  it("says that local files arrive later when File > Open is used, as a message window over the desktop", async () => {
    const user = userEvent.setup();
    renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Open..." }),
    );
    // The message is its own window on the desktop, not part of the Paint window.
    const notice = await screen.findByText(LOCAL_FILES_NOTICE);
    expect(paint).not.toContainElement(notice);
  });

  it("asks to discard changes before File > Open and shows the notice once confirmed", async () => {
    const user = userEvent.setup();
    renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    drag(within(paint).getByLabelText("Drawing canvas"), [1, 1], [2, 2]);

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Open..." }),
    );
    const confirm = await within(paint).findByRole("dialog", { name: "Paint" });
    expect(confirm).toHaveTextContent("Discard the changes to untitled?");
    expect(screen.queryByText(LOCAL_FILES_NOTICE)).not.toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Yes" }));
    expect(await screen.findByText(LOCAL_FILES_NOTICE)).toBeInTheDocument();
    expect(
      within(paint).queryByRole("dialog", { name: "Paint" }),
    ).not.toBeInTheDocument();
  });

  it("says that local files arrive later for both Save and Save As", async () => {
    const user = userEvent.setup();
    renderPaint();
    const paint = await screen.findByRole("dialog", {
      name: "untitled - Paint",
    });
    const notices = () => screen.queryAllByText(LOCAL_FILES_NOTICE);

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Save" }),
    );
    await waitFor(() => expect(notices()).toHaveLength(1));

    await user.click(within(paint).getByRole("menuitem", { name: "File" }));
    await user.click(
      within(paint).getByRole("menuitemcheckbox", { name: "Save As..." }),
    );
    await waitFor(() => expect(notices()).toHaveLength(2));
  });
});

function renderPaint(fileName?: string, options: ProviderOptions = {}) {
  const state: AppState = {
    ...DEFAULT_STATE,
    windows: [
      { id: "w1", minimized: false, maximized: false, kind: "paint", fileName },
    ],
  };
  return renderWithProviders(<Desktop />, { initialState: state, ...options });
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
