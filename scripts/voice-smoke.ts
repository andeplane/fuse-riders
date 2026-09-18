import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { smokeTimeout } from "./smoke-timeout.js";
import { mkdir } from "node:fs/promises";

// Chromium's synthetic microphone exercises real RTP. The harness observes peer connections and capture tracks,
// and deliberately closes one link for recovery; it does not fake audio delivery, SDP, or gameplay.
// This is browser emulation, not physical-phone, Bluetooth, acoustic echo or Safari qualification.
interface Capture {
  pcs: RTCPeerConnection[];
  tracks: MediaStreamTrack[];
  requests: number;
  deny: boolean;
}
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const base = process.env.ONLINE_URL ?? "http://localhost:8787/";
const errors: string[] = [];
async function instrument(page: Page) {
  page.on("console", (message) => {
    if (message.text().includes("CAPTURE FAILURE")) console.log(message.text());
  });
  page.setDefaultTimeout(smokeTimeout(30000));
  page.setDefaultNavigationTimeout(smokeTimeout(30000));
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("PAGE ERROR", error.message);
  });
  await page.addInitScript(() => {
    const capture: Capture = { pcs: [], tracks: [], requests: 0, deny: false };
    Reflect.set(window, "__voiceTest", capture);
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        capture.pcs.push(this);
      }
    };
    const get = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      ++capture.requests;
      if (capture.deny)
        throw new DOMException("Injected permission denial", "NotAllowedError");
      try {
        const stream = await get(constraints);
        capture.tracks.push(...stream.getTracks());
        return stream;
      } catch (error) {
        console.error("CAPTURE FAILURE", String(error));
        throw error;
      }
    };
  });
}
const data = (page: Page) =>
  page.evaluate(() => {
    const capture = Reflect.get(window, "__voiceTest") as Capture;
    return {
      requests: capture.requests,
      tracks: capture.tracks.map((t) => ({
        state: t.readyState,
        enabled: t.enabled,
      })),
      live: capture.pcs.filter((p) => p.connectionState === "connected").length,
      total: capture.pcs.length,
    };
  });
const audioReceived = (page: Page, count = 1, peer?: string) =>
  page.waitForFunction(
    async ({ count, peer }) => {
      const capture = Reflect.get(window, "__voiceTest") as Capture;
      let heard = 0;
      const audio = [
        ...document.querySelectorAll<HTMLAudioElement>(
          "audio[data-voice-peer]",
        ),
      ].find((a) => a.dataset.voicePeer === peer);
      const track = (
        audio?.srcObject as MediaStream | null
      )?.getAudioTracks()[0];
      for (const pc of capture.pcs.filter(
        (p) =>
          p.connectionState === "connected" &&
          (!peer || p.getReceivers().some((r) => r.track === track)),
      )) {
        const stats = await pc.getStats();
        let has = false;
        stats.forEach((s) => {
          if (
            s.type === "inbound-rtp" &&
            s.kind === "audio" &&
            s.bytesReceived > 0 &&
            s.totalAudioEnergy > 0.001
          )
            has = true;
        });
        if (has) ++heard;
      }
      return heard >= count;
    },
    { count, peer },
    { timeout: smokeTimeout(30000) },
  );
async function voice(page: Page) {
  await page.locator(".voice-toggle").click();
  await page.getByRole("region", { name: "Voice chat" }).waitFor();
}
async function close(page: Page) {
  await page.getByRole("button", { name: "CLOSE", exact: true }).click();
}
async function join(page: Page, name: string, url: string) {
  await page.goto(url);
  await page.getByPlaceholder("Your name").fill(name);
  await page
    .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
    .click();
}
try {
  const a = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 1280, height: 800 },
  });
  const host = await a.newPage();
  await instrument(host);
  await host.goto(base);
  console.log("Home loaded");
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  console.log("Room created");
  const url = `${host.url()}&renderer=phaser-canvas`;
  await host.getByPlaceholder("Your name").fill("Host");
  await host
    .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
    .click();
  assert.equal((await data(host)).requests, 0, "joining a room never captures");
  await voice(host);
  await host.getByRole("button", { name: "JOIN VOICE", exact: true }).click();
  await host
    .getByRole("button", { name: "MUTE MIC", exact: true })
    .waitFor()
    .catch(async (error) => {
      console.log(
        await host.locator(".voice-settings").textContent(),
        await data(host),
      );
      throw error;
    });
  await close(host);
  console.log("Host microphone active");
  const b = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 1280, height: 800 },
  });
  const guest = await b.newPage();
  await instrument(guest);
  await join(guest, "Guest", url);
  await host
    .locator(".room-riders")
    .getByText("Guest", { exact: true })
    .waitFor();
  assert.equal((await data(guest)).requests, 0);
  await guest.waitForFunction(() =>
    [
      ...document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]"),
    ].some((a) => a.srcObject),
  );
  assert.equal(
    await guest
      .locator("audio[data-voice-peer]")
      .evaluateAll((elements) =>
        elements.every(
          (a) =>
            (a as HTMLAudioElement).muted && (a as HTMLAudioElement).paused,
        ),
      ),
    true,
    "remote playback is off before joining voice",
  );
  await voice(guest);
  await guest.evaluate(() => {
    (Reflect.get(window, "__voiceTest") as Capture).deny = true;
  });
  await guest.getByRole("button", { name: "JOIN VOICE", exact: true }).click();
  await guest
    .getByRole("status")
    .filter({ hasText: "Microphone permission denied" })
    .waitFor();
  assert.equal((await data(guest)).tracks.length, 0);
  await guest.evaluate(() => {
    (Reflect.get(window, "__voiceTest") as Capture).deny = false;
  });
  await guest.getByRole("button", { name: "UNMUTE MIC", exact: true }).click();
  await guest.getByRole("button", { name: "MUTE MIC", exact: true }).waitFor();
  console.log("Guest microphone active");
  await audioReceived(host);
  await audioReceived(guest);
  await guest.waitForFunction(() =>
    [
      ...document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]"),
    ].some((a) => !a.paused && !a.muted),
  );
  await guest.waitForFunction(
    () => !!document.querySelector('[data-voice="SPEAKING"]'),
  );
  console.log(
    "Bidirectional RTP audio, opt-in playback and speaking indicators confirmed",
  );
  const peersBefore = (await data(guest)).total;
  await guest.getByRole("button", { name: "MUTE MIC", exact: true }).click();
  assert.equal((await data(guest)).tracks.at(-1)?.enabled, false);
  await host.waitForFunction(() =>
    [
      ...document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]"),
    ].every((a) => a.muted),
  );
  await guest.getByRole("button", { name: "DEAFEN", exact: true }).click();
  assert.equal(
    await guest
      .locator("audio[data-voice-peer]")
      .evaluateAll((elements) =>
        elements.every((a) => (a as HTMLAudioElement).muted),
      ),
    true,
  );
  await guest.getByRole("button", { name: "UNDEAFEN", exact: true }).click();
  assert.equal(
    (await data(guest)).tracks.at(-1)?.enabled,
    false,
    "undeafen preserves microphone mute",
  );
  await guest.getByRole("button", { name: "UNMUTE MIC", exact: true }).click();
  assert.equal((await data(guest)).tracks.at(-1)?.enabled, true);
  await guest
    .getByRole("button", { name: "Silence Host", exact: true })
    .click();
  assert.equal(
    await guest
      .locator("audio[data-voice-peer]")
      .evaluate((a) => (a as HTMLAudioElement).muted),
    true,
  );
  await guest
    .getByRole("button", { name: "Unsilence Host", exact: true })
    .click();
  await guest.getByRole("slider", { name: "Voice volume" }).fill("35");
  assert.equal(
    await guest
      .locator("audio[data-voice-peer]")
      .evaluate((a) => (a as HTMLAudioElement).volume),
    0.35,
  );
  assert.ok(
    (await guest
      .getByRole("combobox", { name: "Microphone" })
      .locator("option")
      .count()) >= 2,
  );
  await guest
    .getByRole("combobox", { name: "Microphone" })
    .selectOption({ index: 1 });
  await guest.waitForFunction(
    () => (Reflect.get(window, "__voiceTest") as Capture).tracks.length === 2,
  );
  assert.equal((await data(guest)).tracks[0]!.state, "ended");
  await guest.getByRole("combobox", { name: "Microphone" }).selectOption("");
  await guest.waitForFunction(
    () => (Reflect.get(window, "__voiceTest") as Capture).tracks.length === 3,
  );
  // Enumeration runs asynchronously after capture too; wait for the selected default to remain through that render.
  await guest.waitForFunction(
    () =>
      document.querySelector<HTMLSelectElement>(".voice-settings select")
        ?.value === "" &&
      !document.querySelector<HTMLSelectElement>(".voice-settings select")
        ?.disabled,
  );
  assert.equal((await data(guest)).tracks[1]!.state, "ended");
  assert.equal(
    (await data(guest)).total,
    peersBefore,
    "mic changes do not rebuild gameplay links",
  );
  await close(guest);
  console.log(
    "Mute, deafen, participant silence, volume and microphone switching confirmed",
  );
  // Third device is a shared display and must never request a microphone just to listen.
  const c = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const display = await c.newPage();
  await instrument(display);
  await display.goto(`${url}&display=1`);
  await voice(display);
  await display
    .getByRole("button", { name: "LISTEN ONLY", exact: true })
    .click();
  await audioReceived(display, 2);
  await display.waitForFunction(() => {
    const elements = [
      ...document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]"),
    ];
    return (
      elements.length === 2 &&
      elements.every((audio) => !audio.paused && !audio.muted)
    );
  });
  assert.equal((await data(display)).requests, 0);
  await mkdir("artifacts", { recursive: true });
  await display.screenshot({ path: "artifacts/voice-chat-phone.png" });
  assert.equal(
    await display
      .locator(".voice-settings")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
    "phone voice panel fits horizontally",
  );
  console.log("Listen-only display receives both riders without capture");
  // Lose a real link; the existing transport's bounded recovery recreates it with voice still attached.
  await voice(guest);
  await guest
    .getByRole("button", { name: "Silence Host", exact: true })
    .click();
  await close(guest);
  const beforeRecovery = (await data(guest)).total;
  const hostPeerId = await guest
    .locator(".voice-participants>div")
    .filter({ hasText: "Host ·" })
    .getAttribute("data-peer");
  assert.ok(hostPeerId);
  const guestPeerId = await host
    .locator(".voice-participants>div")
    .filter({ hasText: "Guest ·" })
    .getAttribute("data-peer");
  assert.ok(guestPeerId);
  await guest.evaluate((id) => {
    const audio = [
      ...document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]"),
    ].find((a) => a.dataset.voicePeer === id)!;
    const track = (audio.srcObject as MediaStream).getAudioTracks()[0];
    (Reflect.get(window, "__voiceTest") as Capture).pcs
      .find((pc) => pc.getReceivers().some((r) => r.track === track))!
      .close();
  }, hostPeerId);
  await guest.waitForFunction(
    (previous) =>
      (Reflect.get(window, "__voiceTest") as Capture).pcs.length > previous,
    beforeRecovery,
    { timeout: smokeTimeout(30000) },
  );
  await audioReceived(guest, 1, hostPeerId);
  await audioReceived(host, 1, guestPeerId);
  assert.equal((await data(guest)).tracks.at(-1)?.enabled, true);
  console.log("Voice restored after peer-link replacement");
  await voice(guest);
  await guest
    .getByRole("button", { name: "Unsilence Host", exact: true })
    .waitFor();
  assert.equal(
    await guest
      .locator("audio[data-voice-peer]")
      .evaluateAll(
        (elements, id) =>
          (
            elements.find(
              (a) => (a as HTMLAudioElement).dataset.voicePeer === id,
            ) as HTMLAudioElement
          )?.muted,
        hostPeerId,
      ),
    true,
    "silence survives link recovery",
  );
  await guest.getByRole("button", { name: "LEAVE VOICE", exact: true }).click();
  assert.equal(
    (await data(guest)).tracks.every((t) => t.state === "ended"),
    true,
  );
  await guest.getByRole("button", { name: "LISTEN ONLY", exact: true }).click();
  assert.equal((await data(guest)).requests, 4);
  await close(guest);
  await host.getByRole("button", { name: "START RACE", exact: true }).click();
  await host.waitForFunction(() =>
    document.querySelector(".online-round")?.textContent?.includes("ROUND"),
  );
  await guest.waitForFunction(
    () =>
      document.querySelector(".online-arena")?.getAttribute("hidden") === null,
  );
  await mkdir("artifacts", { recursive: true });
  await voice(host);
  await host.screenshot({ path: "artifacts/voice-chat.png" });
  await close(host);
  // Refresh is a new consent boundary: no saved preference automatically reopens capture.
  await guest.reload();
  await guest.locator(".voice-toggle").waitFor();
  assert.equal((await data(guest)).requests, 0);
  await voice(guest);
  await guest.getByRole("button", { name: "JOIN VOICE", exact: true }).click();
  await guest.getByRole("button", { name: "MUTE MIC", exact: true }).waitFor();
  await host.getByRole("button", { name: "ROOM", exact: true }).click();
  await host.getByRole("button", { name: "END ROOM", exact: true }).click();
  await host.waitForURL((url) => !url.searchParams.has("room"));
  await display.waitForFunction(() =>
    (Reflect.get(window, "__voiceTest") as Capture).pcs.every(
      (p) => p.connectionState === "closed",
    ),
  );
  assert.equal(await display.locator("audio[data-voice-peer]").count(), 0);
  await guest.waitForFunction(() =>
    (Reflect.get(window, "__voiceTest") as Capture).tracks.every(
      (t) => t.readyState === "ended",
    ),
  );
  assert.equal(await guest.locator("audio[data-voice-peer]").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Leave, gameplay, refresh consent and terminal cleanup confirmed",
  );
} finally {
  await browser.close();
}
