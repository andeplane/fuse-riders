import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ManualScheduler } from "../../__mocks__/dialUpDeps";
import { renderWithProviders } from "../../__mocks__/renderWithProviders";
import { FakeSoundService } from "../../__mocks__/soundService";
import { Desktop } from "../../desktop/Desktop";
import type { AppState, WindowContent } from "../../state/appState";
import { DEFAULT_STATE, isWindowState } from "../../state/appState";
import { MODEM_PHASES } from "../synth/modemTimeline";

import { MemoryDialUpSession, withDialUp } from "./dialUpSession";
import {
  CONNECTED_LINGER_MS,
  phaseSchedule,
  SILENT_PHASE_MS,
} from "./useDialUpViewModel";

const ABOUT: WindowContent = { kind: "about" };

function stateWith(content: WindowContent): AppState {
  return {
    ...DEFAULT_STATE,
    windows: [{ id: "w1", minimized: false, maximized: false, ...content }],
  };
}

describe("DialUpWindow", () => {
  it("opens from Start > Programs > Accessories > Dial-Up Networking as the Connect To form", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />);
    await user.click(screen.getByRole("button", { name: /Start/ }));
    const menu = screen.getByRole("menu", { name: "Start menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    await user.click(
      within(menu).getByRole("menuitem", { name: "Accessories" }),
    );
    await user.click(
      within(menu).getByRole("menuitem", { name: "Dial-Up Networking" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Connect To" });
    const form = within(dialog).getByRole("form", { name: "Connect To" });
    expect(within(form).getByLabelText("User name:")).toHaveValue("guest");
    expect(within(form).getByLabelText("Phone number:")).toHaveValue(
      "555-FUSE",
    );
    expect(
      within(form).getByRole("button", { name: "Connect" }),
    ).toBeInTheDocument();
  });

  it("dials with the modem sound, reports each phase in time with it, then opens what it was gating", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService();
    const scheduler = new ManualScheduler();
    const session = new MemoryDialUpSession();
    const { store } = renderWithProviders(<Desktop />, {
      initialState: stateWith(withDialUp(ABOUT, session)),
      sounds,
      dialUpDeps: scheduler,
      dialUpSession: session,
    });
    const dialog = await screen.findByRole("dialog", { name: "Connect To" });
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    const modem = sounds.plays.find((play) => play.event === "modem");
    expect(modem?.handle.audible).toBe(true);
    expect(
      within(dialog).getByText("Connecting to Fuse Network"),
    ).toBeInTheDocument();

    const status = () => within(dialog).getByRole("status");
    act(() => scheduler.advance(0));
    expect(status()).toHaveTextContent("Status: Dialing 555-FUSE...");
    act(() => scheduler.advance(3000));
    expect(status()).toHaveTextContent("Status: Ringing...");
    expect(
      within(dialog).getByRole("progressbar", { name: "Connection progress" }),
    ).toHaveAttribute("aria-valuenow", "20");
    const connected = MODEM_PHASES[MODEM_PHASES.length - 1];
    act(() => scheduler.advance((connected?.at ?? 0) * 1000 - 3000));
    expect(status()).toHaveTextContent("Status: Connected at 56,000 bps");
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    expect(session.connected).toBe(false);

    act(() => scheduler.advance(CONNECTED_LINGER_MS));
    expect(session.connected).toBe(true);
    expect(
      screen.queryByRole("dialog", { name: "Connect To" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("dialog", { name: "About FuseOS" }),
    ).toBeInTheDocument();
    expect(store.load().windows.map((window) => window.kind)).toEqual([
      "about",
    ]);
    expect(modem?.handle.stopped).toBe(true);
  });

  it("Cancel hangs up, stops the sound and still opens the gated window", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService();
    const scheduler = new ManualScheduler();
    const session = new MemoryDialUpSession();
    renderWithProviders(<Desktop />, {
      initialState: stateWith({ kind: "dialup", then: ABOUT }),
      sounds,
      dialUpDeps: scheduler,
      dialUpSession: session,
    });
    const dialog = await screen.findByRole("dialog", { name: "Connect To" });
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    act(() => scheduler.advance(1000));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      sounds.plays.find((play) => play.event === "modem")?.handle.stopped,
    ).toBe(true);
    expect(scheduler.pending).toBe(0);
    expect(session.connected).toBe(true);
    expect(
      await screen.findByRole("dialog", { name: "About FuseOS" }),
    ).toBeInTheDocument();
  });

  it("Cancel on the form just closes a bare Dial-Up Networking window", async () => {
    const user = userEvent.setup();
    const session = new MemoryDialUpSession();
    renderWithProviders(<Desktop />, {
      initialState: stateWith({ kind: "dialup" }),
      dialUpSession: session,
    });
    const dialog = await screen.findByRole("dialog", { name: "Connect To" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(session.connected).toBe(true);
  });

  it("runs the status lines quickly when the modem cannot be heard", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService({ muted: true });
    const scheduler = new ManualScheduler();
    renderWithProviders(<Desktop />, {
      initialState: stateWith({ kind: "dialup", then: ABOUT }),
      sounds,
      dialUpDeps: scheduler,
    });
    const dialog = await screen.findByRole("dialog", { name: "Connect To" });
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    act(() => scheduler.advance(SILENT_PHASE_MS * (MODEM_PHASES.length - 1)));
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Connected at 56,000 bps",
    );
    act(() => scheduler.advance(CONNECTED_LINGER_MS));
    expect(
      await screen.findByRole("dialog", { name: "About FuseOS" }),
    ).toBeInTheDocument();
  });

  it("closing the window from its title bar hangs up too", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService();
    const scheduler = new ManualScheduler();
    renderWithProviders(<Desktop />, {
      initialState: stateWith({ kind: "dialup" }),
      sounds,
      dialUpDeps: scheduler,
    });
    const dialog = await screen.findByRole("dialog", { name: "Connect To" });
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      sounds.plays.find((play) => play.event === "modem")?.handle.stopped,
    ).toBe(true);
    expect(scheduler.pending).toBe(0);
  });
});

describe(withDialUp.name, () => {
  it("gates a window while the session is offline and passes it through afterwards", () => {
    const session = new MemoryDialUpSession();
    expect(withDialUp(ABOUT, session)).toEqual({ kind: "dialup", then: ABOUT });
    session.markConnected();
    expect(withDialUp(ABOUT, session)).toBe(ABOUT);
  });

  it("is a window state the store accepts, with or without a gated window", () => {
    const base = { id: "w", minimized: false, maximized: false };
    expect(isWindowState({ ...base, kind: "dialup" })).toBe(true);
    expect(isWindowState({ ...base, kind: "dialup", then: ABOUT })).toBe(true);
    expect(
      isWindowState({ ...base, kind: "dialup", then: { kind: "nope" } }),
    ).toBe(false);
    expect(isWindowState({ ...base, kind: "dialup", then: 3 })).toBe(false);
  });
});

describe(phaseSchedule.name, () => {
  it("follows the sound when audible and a fixed quick cadence otherwise", () => {
    expect(
      phaseSchedule(MODEM_PHASES, true).map((phase) => phase.atMs),
    ).toEqual(MODEM_PHASES.map((phase) => Math.round(phase.at * 1000)));
    expect(
      phaseSchedule(MODEM_PHASES, false).map((phase) => phase.atMs),
    ).toEqual(MODEM_PHASES.map((_, index) => index * SILENT_PHASE_MS));
  });
});
