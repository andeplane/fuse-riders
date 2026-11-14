import { chromium } from "playwright";

// Fusemania's own latency probe, read after a song played with real browser key events (Playwright's keyboard, so
// each press has a browser stamp and waits for the main thread like a player's). The presses are sent `BIAS_MS`
// away from each note, so the run also shows the timing-bias offer on the result. Figures are this machine's:
// headless Chromium has no display and no audio device, and injected keys skip the keyboard and the operating
// system. Run against a served build: `pnpm exec tsx service/dev.ts --port 8890` after `pnpm build`.
//
// `LAB=1` drives the `?debugtiming` lab instead: the steady click track (`click-150` unless `SONG` says otherwise),
// the panel's figures and the session file the dev server writes. `MIC=1` adds the microphone, heard through a
// loopback this script puts in the page (see `LOOPBACK`): the page's own sound, delayed like a speaker, and a thud
// for each key. That exercises the real capture path (worklet, frames, envelopes, the session) against a room
// whose delays are known; it says nothing about a real microphone's sound. `AUDIOCLOCK=reported` plays on the
// stepped audio clock, to compare with the clock pair.
const base = process.env.ONLINE_URL ?? "http://localhost:8890/",
  lab = !!process.env.LAB,
  mic = lab && !!process.env.MIC,
  song = process.env.SONG ?? (lab ? "click-150" : "arcade-adventure"),
  chart = process.env.CHART ?? (lab ? "0" : "1"),
  bias = Number(process.env.BIAS_MS ?? -18),
  seconds = Number(process.env.SECONDS ?? 0),
  shot = process.env.SCREENSHOT;

/** The room the loopback stands for: the speaker's delay and how long after a key's sound the browser stamps it. */
const ROOM = { speakerMs: 50, keyboardMs: 12 };
/**
 * Runs in the page before its own code. Everything the page sends to its speakers also goes, `speakerMs` later,
 * into a stream that `getUserMedia` hands back as the microphone; each key down adds a thud `keyboardMs` before
 * its stamp. A thud cannot be scheduled in the past, so both paths carry `AHEAD` more: the microphone's own delay,
 * which the method cancels.
 */
const LOOPBACK = `(() => {
  const AHEAD = 0.03, SPEAKER = ${ROOM.speakerMs / 1000}, KEYBOARD = ${ROOM.keyboardMs / 1000};
  const Real = window.AudioContext, connect = AudioNode.prototype.connect;
  let context, air, speaker, thud, skews = [];
  window.AudioContext = class extends Real {
    constructor(options) {
      super(options);
      context = this;
      air = this.createMediaStreamDestination();
      speaker = this.createDelay(1);
      speaker.delayTime.value = SPEAKER + AHEAD;
      connect.call(speaker, air);
      const length = Math.round(0.03 * this.sampleRate);
      thud = this.createBuffer(1, length, this.sampleRate);
      const data = thud.getChannelData(0);
      let low = 0, seed = 7;
      for (let index = 0; index < length; index++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        low += 0.25 * ((seed / 0x80000000 - 1) - low);
        data[index] = 0.9 * low * Math.exp(-index / (0.005 * this.sampleRate)) * Math.min(1, index / 6);
      }
    }
  };
  AudioNode.prototype.connect = function (to, ...rest) {
    if (context && to === context.destination) connect.call(this, speaker);
    return connect.call(this, to, ...rest);
  };
  // Where the audio clock is on the page clock: the stepped clock is only ever behind, so the greatest of late.
  const watch = () => {
    if (context) {
      skews.push(context.currentTime - performance.now() / 1000);
      if (skews.length > 240) skews.shift();
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  window.addEventListener("keydown", (event) => {
    if (!context || !air || event.repeat || skews.length === 0) return;
    const source = context.createBufferSource();
    source.buffer = thud;
    connect.call(source, air);
    source.start(event.timeStamp / 1000 + Math.max(...skews) - KEYBOARD + AHEAD);
  }, true);
  const media = navigator.mediaDevices;
  media.getUserMedia = async () => air.stream;
  media.enumerateDevices = async () => [{ kind: "audioinput", deviceId: "loopback", label: "Loopback", groupId: "" }];
})();`;

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: lab ? 1100 : 800 },
  deviceScaleFactor: shot ? 2 : 1,
});
if (mic) await page.addInitScript(LOOPBACK);
const flags = [
  lab ? "debugtiming&mode=0" : "latency",
  process.env.MUTE ? "mute" : "",
  process.env.AUDIOCLOCK ? `audioclock=${process.env.AUDIOCLOCK}` : "",
]
  .filter(Boolean)
  .join("&");
await page.goto(
  `${base}fusemania/?solo=1&song=${song}&chart=${chart}&${flags}`,
);
await page.locator('main[data-stage="running"]').waitFor({ timeout: 30_000 });
// A click anywhere unlocks the audio clock where the browser wants a gesture.
await page.mouse.click(640, 400);
await page.waitForTimeout(800);
// A solo song that began before sound was allowed starts over once it is.
await page.locator('main[data-stage="running"]').waitFor({ timeout: 30_000 });
await page.waitForFunction(
  "window.fusemania.clock().audible === true",
  undefined,
  {
    timeout: 30_000,
  },
);
await page.waitForTimeout(500);
if (mic) {
  await page
    .getByRole("button", { name: "LISTEN WITH THE MICROPHONE" })
    .click();
  // The ticks before the first arrow are the ones it learns the round trip from.
  await page.waitForTimeout(300);
}

type Note = [ms: number, column: number, kind: number];
const notes = (await page.evaluate("window.fusemania.notes()")) as Note[];
const codes = ["KeyA", "KeyS", "KeyW", "KeyD"];
/** Song ms minus this process's clock, sampled a few times: the least is the one with the shortest round trip. */
let skew = Number.POSITIVE_INFINITY;
const sync = async () => {
  const before = performance.now();
  const heard = (await page.evaluate(
    "window.fusemania.clock().heardMs",
  )) as number;
  const after = performance.now();
  if (after - before < 8) skew = heard - (before + after) / 2;
};
for (let i = 0; i < 10; i++) await sync();
const until = seconds > 0 ? seconds * 1000 : Number.POSITIVE_INFINITY;
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
let sent = 0;
for (const [ms, column, kind] of notes) {
  // Mines are not pressed.
  if (kind === 3 || ms > until) continue;
  const due = ms + bias - skew;
  if (due < performance.now() - 5) continue;
  await sleep(due - performance.now());
  const code = codes[column]!;
  // Not awaited one after the other: a jump's two keys go down together.
  void page.keyboard
    .down(code)
    .then(() => sleep(60))
    .then(() => page.keyboard.up(code));
  if (++sent % 40 === 0) await sync();
}
if (seconds > 0) {
  await sleep(500);
} else {
  await page.locator('main[data-stage="over"]').waitFor({ timeout: 400_000 });
  await sleep(800);
}
console.log(`presses sent: ${sent}, ${bias} ms from each note`);
if (lab) {
  // The whole panel as text, the way COPY gives it.
  console.log(
    await page.evaluate(
      "document.querySelector('.fm-dt')?.innerText ?? 'no timing panel'",
    ),
  );
  if (mic)
    console.log(
      "microphone:",
      JSON.stringify(
        await page.evaluate(
          "(({ report, ...rest }) => ({ ...rest, report: report && { ...report, recent: undefined } }))(window.fusemania.timing().mic)",
        ),
      ),
      "\n" +
        `loopback room: speaker ${ROOM.speakerMs} ms, keyboard ${ROOM.keyboardMs} ms; the microphone should find ` +
        `${ROOM.speakerMs + ROOM.keyboardMs} ms less the latency the song clock already counts`,
    );
}
console.log(await page.evaluate("window.fusemania.latencyText()"));
console.log(
  "result offer:",
  JSON.stringify(
    await page.evaluate(
      "document.querySelector('.fm-card-timing:not([hidden]) p')?.textContent ?? null",
    ),
  ),
);
if (shot) await page.screenshot({ path: shot });
if (process.env.APPLY) {
  await page.locator(".fm-timing-apply").click();
  console.log(
    "after APPLY:",
    await page.evaluate(
      "document.querySelector('.fm-card-timing p')?.textContent + ' | stored ' + localStorage.getItem('fusemania-prefs-v1')",
    ),
  );
  if (shot)
    await page.screenshot({ path: shot.replace(/\.png$/, "-applied.png") });
}
await browser.close();
