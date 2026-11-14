import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";

import { AboutDialog, MADE_BY } from "./AboutDialog";
import type { Credit } from "./credits";
import { CREDITS } from "./credits";
import { FUSEOS_VERSION } from "./version";

const TWO_CREDITS: readonly Credit[] = [
  {
    name: "Linked Thing",
    by: "Someone",
    role: "does a thing",
    licence: "MIT",
    url: "https://example.com/linked",
  },
  { name: "Plain Thing", role: "does another", licence: "shareware" },
];

describe(AboutDialog.name, () => {
  it("shows the splash, the version, the copyright line and the source link", () => {
    renderWithProviders(<AboutDialog windowId="w1" credits={TWO_CREDITS} />);
    expect(screen.getByRole("img", { name: "FuseOS" })).toBeInTheDocument();
    expect(screen.getByText(`Version ${FUSEOS_VERSION}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Copyright © ${new Date().getFullYear()} ${MADE_BY}`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "github.com/andeplane/fuse-games" }),
    ).toHaveAttribute("href", "https://github.com/andeplane/fuse-games");
    expect(
      screen.getByText(/A Windows 98 desktop for the Fuse games/),
    ).toBeInTheDocument();
  });

  it("lists each credit, linking the ones with a home page", () => {
    renderWithProviders(<AboutDialog windowId="w1" credits={TWO_CREDITS} />);
    const list = screen.getByRole("list", { name: "Credits" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(
      within(list).getByRole("link", { name: "Linked Thing" }),
    ).toHaveAttribute("href", "https://example.com/linked");
    expect(items[0]).toHaveTextContent("Linked Thing by Someone");
    expect(items[0]).toHaveTextContent("does a thing (MIT)");
    expect(items[1]).toHaveTextContent("Plain Thing");
    expect(items[1]).toHaveTextContent("does another (shareware)");
    expect(
      within(list).queryByRole("link", { name: "Plain Thing" }),
    ).toBeNull();
  });

  it("credits everything the plan lists by default", () => {
    renderWithProviders(<AboutDialog windowId="w1" />);
    const list = screen.getByRole("list", { name: "Credits" });
    for (const name of [
      "98.css",
      "React95 icons",
      "Webamp",
      "js-dos",
      "clippyjs",
      "WebLLM",
      "CodeMirror",
      "3D Pipes",
      "id Software, Apogee Software and 3D Realms",
      "The Fuse games' soundtracks",
    ])
      expect(within(list).getByText(name)).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(CREDITS.length);
    expect(
      within(list).getByRole("link", { name: "3D Pipes" }),
    ).toHaveAttribute("href", "https://github.com/1j01/pipes");
  });

  it("OK closes the window", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(
      <AboutDialog windowId="w1" credits={TWO_CREDITS} />,
      {
        initialState: {
          version: 1,
          windows: [
            { id: "w1", kind: "about", minimized: false, maximized: false },
          ],
        },
      },
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(store.load().windows).toEqual([]);
  });
});

describe("CREDITS", () => {
  it("has unique names and an https home page wherever one is given", () => {
    expect(new Set(CREDITS.map((credit) => credit.name)).size).toBe(
      CREDITS.length,
    );
    for (const credit of CREDITS)
      if (credit.url) expect(credit.url).toMatch(/^https:\/\//);
  });
});
