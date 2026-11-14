import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FIXTURE_IMAGE, FIXTURE_SHA } from "../__mocks__/disk";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { NOT_ON_GITHUB_NOTICE } from "../disk/diskSource";

const viewer = { kind: "imageviewer", path: FIXTURE_IMAGE } as const;

describe("Image Viewer", () => {
  it("shows the picture from the build's commit with its path and a Close button", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Desktop />, {
      initialOpen: [viewer],
    });
    expect(screen.getByText("Reading drive C:...")).toBeInTheDocument();
    const image = await screen.findByRole("img", { name: "fuseball.jpg" });
    expect(image).toHaveAttribute(
      "src",
      `memory://andeplane/fuse-riders/${FIXTURE_SHA}/${FIXTURE_IMAGE}`,
    );
    const window = screen.getByRole("dialog", {
      name: "fuseball.jpg - Image Viewer",
    });
    expect(
      within(window).getByText("C:\\public\\gallery\\fuseball.jpg"),
    ).toBeInTheDocument();
    await user.click(within(window).getByRole("button", { name: "Close" }));
    expect(store.load().windows).toEqual([]);
  });

  it("falls back to main when the commit is not on GitHub, then gives up", async () => {
    renderWithProviders(<Desktop />, { initialOpen: [viewer] });
    const image = await screen.findByRole("img", { name: "fuseball.jpg" });
    fireEvent.error(image);
    const fallback = screen.getByRole("img", { name: "fuseball.jpg" });
    expect(fallback).toHaveAttribute(
      "src",
      `memory://andeplane/fuse-riders/main/${FIXTURE_IMAGE}`,
    );
    expect(screen.getByText(NOT_ON_GITHUB_NOTICE)).toBeInTheDocument();
    fireEvent.error(fallback);
    expect(
      screen.getByText(
        "fuseball.jpg could not be shown: GitHub did not return it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "fuseball.jpg" }),
    ).not.toBeInTheDocument();
  });

  it("reports a manifest that will not load", async () => {
    renderWithProviders(<Desktop />, {
      initialOpen: [viewer],
      disk: { source: { manifestFailures: 5 } },
    });
    expect(await screen.findByText(/HTTP 503/)).toBeInTheDocument();
  });
});
