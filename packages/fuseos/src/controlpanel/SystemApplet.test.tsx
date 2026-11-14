import { screen, within } from "@testing-library/react";

import {
  renderWithProviders,
  TEST_SYSTEM_PROBE,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import type { SystemProbe } from "./systemInfo";

const SYSTEM_OPEN: AppState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "controlpanel",
      applet: "system",
    },
  ],
};

async function findComputerTable() {
  const dialog = await screen.findByRole("dialog", { name: "Control Panel" });
  return within(dialog).findByRole("table", { name: "Computer information" });
}

describe("SystemApplet", () => {
  it("measures the storage in use through the probe and shows it against the quota", async () => {
    const probe: SystemProbe = {
      ...TEST_SYSTEM_PROBE,
      hardwareConcurrency: 10,
      deviceMemoryGb: 8,
      coarsePointer: false,
      estimateStorage: vi.fn(async () => ({
        usageBytes: 1.5 * 1024 * 1024,
        quotaBytes: 2 * 1024 ** 3,
      })),
    };
    renderWithProviders(<Desktop />, {
      initialState: SYSTEM_OPEN,
      systemProbe: probe,
    });
    const computer = await findComputerTable();
    expect(computer).toHaveTextContent("10 processors");
    expect(computer).toHaveTextContent("8 GB");
    expect(computer).toHaveTextContent("Mouse");
    expect(
      await within(computer).findByText(
        "Windows are remembered between visits; 1.5 MB of 2 GB used",
      ),
    ).toBeInTheDocument();
    expect(probe.estimateStorage).toHaveBeenCalledTimes(1);
  });

  it("keeps the plain storage line when the browser cannot estimate it", async () => {
    renderWithProviders(<Desktop />, {
      initialState: SYSTEM_OPEN,
      systemProbe: {
        ...TEST_SYSTEM_PROBE,
        coarsePointer: true,
        estimateStorage: async () => undefined,
      },
    });
    const computer = await findComputerTable();
    expect(
      await within(computer).findByText(
        "Windows are remembered between visits",
      ),
    ).toBeInTheDocument();
    expect(computer).toHaveTextContent("Touch screen");
  });

  it("shows the measuring state first when the estimate is slow, and never a stale result after close", async () => {
    let resolve: (value: undefined) => void = () => undefined;
    const pending = new Promise<undefined>((done) => {
      resolve = done;
    });
    const { unmount } = renderWithProviders(<Desktop />, {
      initialState: SYSTEM_OPEN,
      systemProbe: { ...TEST_SYSTEM_PROBE, estimateStorage: () => pending },
    });
    const computer = await findComputerTable();
    expect(computer).toHaveTextContent("(measuring...)");
    unmount();
    resolve(undefined);
    await pending;
  });
});
