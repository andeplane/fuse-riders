import "./style.css";
import type { ShowcaseHandle } from "../render/scene.js";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing showcase element: ${id}`);
  return value as T;
}
const host = element<HTMLDivElement>("scene"),
  status = element<HTMLParagraphElement>("status"),
  phase = element<HTMLSpanElement>("phase");
const play = element<HTMLButtonElement>("play"),
  replay = element<HTMLButtonElement>("replay"),
  retry = element<HTMLButtonElement>("retry");
const mode = element<HTMLSelectElement>("mode"),
  atmosphere = element<HTMLInputElement>("atmosphere");
const scrub = element<HTMLInputElement>("scrub");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let paused = reduced.matches,
  current: ShowcaseHandle | undefined,
  attempt = 0,
  deadline: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
element<HTMLAnchorElement>("home").href =
  import.meta.env.BASE_URL +
  (new URLSearchParams(location.search).has("mute") ? "?mute" : "");
play.textContent = paused ? "Play" : "Pause";
if (reduced.matches) atmosphere.checked = false;
function controls(enabled: boolean): void {
  for (const control of [play, replay, mode, atmosphere, scrub])
    control.disabled = !enabled;
}
function stop(): void {
  clearTimeout(deadline);
  current?.destroy();
  current = undefined;
}
function fail(message: string): void {
  attempt++;
  stop();
  controls(false);
  status.dataset.state = "error";
  status.textContent = `${message} You can retry without leaving the page.`;
  phase.textContent = "The belfry is taking a moment.";
  retry.hidden = false;
}
async function start(): Promise<void> {
  stop();
  const token = ++attempt;
  controls(false);
  retry.hidden = true;
  status.dataset.state = "loading";
  status.textContent = "Loading artwork and renderer…";
  deadline = setTimeout(() => {
    if (token === attempt) fail("Graphics did not become ready in time.");
  }, 15000);
  try {
    const { createShowcase } = await import("../render/scene.js");
    if (token !== attempt || disposed) return;
    current = createShowcase(host, {
      paused,
      idleOnly: mode.value === "idle",
      atmosphere: atmosphere.checked,
      ready() {
        if (token !== attempt) return;
        clearTimeout(deadline);
        controls(true);
        status.dataset.state = "ready";
        status.textContent =
          "Phaser art showcase · scripted movement · sound off";
      },
      failed(message) {
        if (token === attempt && !disposed) fail(message);
      },
      phase(label) {
        if (phase.textContent !== label) phase.textContent = label;
      },
      time(ms) {
        scrub.value = String(Math.floor(ms % 12000));
      },
    });
  } catch (error) {
    if (token === attempt)
      fail(
        error instanceof Error ? error.message : "Graphics could not start.",
      );
  }
}
play.onclick = () => {
  paused = !paused;
  play.textContent = paused ? "Play" : "Pause";
  current?.setPaused(paused);
};
replay.onclick = () => current?.replay();
mode.onchange = () => current?.setIdle(mode.value === "idle");
atmosphere.onchange = () => current?.setAtmosphere(atmosphere.checked);
scrub.oninput = () => {
  paused = true;
  play.textContent = "Play";
  current?.setPaused(true);
  current?.seek(Number(scrub.value));
};
retry.onclick = () => {
  void start();
};
window.addEventListener("pagehide", () => {
  disposed = true;
  attempt++;
  stop();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    disposed = false;
    void start();
  }
});
void start();
