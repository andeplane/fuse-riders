import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { FakeSoundService } from "../__mocks__/soundService";
import { Desktop } from "../desktop/Desktop";
import { MemorySoundPrefsStore } from "../sounds/soundPrefsStore";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

const SOUNDS_OPEN: AppState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "controlpanel",
      applet: "sounds",
    },
  ],
};

async function openSounds(sounds: FakeSoundService) {
  renderWithProviders(<Desktop />, { initialState: SOUNDS_OPEN, sounds });
  return screen.findByRole("dialog", { name: "Control Panel" });
}

describe("SoundsApplet", () => {
  it("lists every event with its toggle, and persists the toggles", async () => {
    const user = userEvent.setup();
    const prefs = new MemorySoundPrefsStore();
    const sounds = new FakeSoundService({ prefs });
    const dialog = await openSounds(sounds);
    const events = within(dialog).getByRole("list", { name: "Sound events" });
    expect(
      within(events)
        .getAllByRole("checkbox")
        .map((box) => box.id),
    ).toEqual([
      "sound-startup",
      "sound-shutdown",
      "sound-ding",
      "sound-error",
      "sound-recycle",
      "sound-floppy",
      "sound-modem",
    ]);
    const modem = within(events).getByRole("checkbox", {
      name: /Dial-up modem/,
    });
    expect(modem).toBeChecked();
    await user.click(modem);
    expect(modem).not.toBeChecked();
    expect(prefs.get()).toEqual({ master: true, events: { modem: false } });
    expect(sounds.isEnabled("modem")).toBe(false);
    await user.click(modem);
    expect(prefs.get().events.modem).toBe(true);
  });

  it("the master switch disables every event row", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService();
    const dialog = await openSounds(sounds);
    const master = within(dialog).getByRole("checkbox", {
      name: "Play system sounds",
    });
    await user.click(master);
    expect(sounds.prefs().master).toBe(false);
    expect(
      within(dialog).getByRole("checkbox", { name: /Floppy drive/ }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Play Floppy drive" }),
    ).toBeDisabled();
    await user.click(master);
    expect(
      within(dialog).getByRole("checkbox", { name: /Floppy drive/ }),
    ).toBeEnabled();
  });

  it("Play previews a sound even when its toggle is off, and Stop silences everything", async () => {
    const user = userEvent.setup();
    const sounds = new FakeSoundService();
    sounds.setEvent("floppy", false);
    const dialog = await openSounds(sounds);
    const play = within(dialog).getByRole("button", {
      name: "Play Floppy drive",
    });
    expect(play.title).toContain("switched off");
    await user.click(play);
    // The start-up chime the desktop itself asked for comes first.
    expect(sounds.plays.at(-1)).toMatchObject({
      event: "floppy",
      options: { force: true },
    });
    expect(sounds.plays.at(-1)?.handle.audible).toBe(true);
    await user.click(
      within(dialog).getByRole("button", { name: "Play Dial-up modem" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Stop" }));
    expect(sounds.stopAllCalls).toBe(1);
    expect(
      sounds.plays.every((play) => play.handle.stopped || !play.handle.audible),
    ).toBe(true);
  });

  it("explains ?mute and locks the controls under it", async () => {
    const sounds = new FakeSoundService({ muted: true });
    const dialog = await openSounds(sounds);
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "opened with ?mute",
    );
    expect(
      within(dialog).getByRole("checkbox", { name: "Play system sounds" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Play Start FuseOS" }),
    ).toBeDisabled();
  });
});
