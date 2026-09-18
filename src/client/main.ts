import "@fontsource/press-start-2p/latin.css";
import "./style.css";
import "./viewport-lock.js";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

const bootFailure = (error: unknown) => {
  if (app.querySelector(".boot-failure") || app.querySelector(".online-header"))
    return;
  // A blank page reports nothing by itself. Imported lazily and best-effort: a failure that also stopped this module
  // from loading is one we simply do not hear about. What leaves is the error's class, a stable code and a bounded,
  // scrubbed message (`analytics-text.ts`) — never the raw text, which can name the page's URL and so the room.
  void import("../online/analytics.js")
    .then((analytics) => analytics.reportBootFailure(error))
    .catch(() => {
      /* analytics never breaks the game */
    });
  const card = document.createElement("section");
  card.className = "boot-failure";
  card.setAttribute("role", "alert");
  // textContent, not markup: an error message is not the page's to interpret.
  const title = document.createElement("h1"),
    detail = document.createElement("p");
  title.textContent = "Fuse Riders could not load";
  detail.textContent = error instanceof Error ? error.message : String(error);
  card.append(title, detail);
  const reload = document.createElement("button");
  reload.textContent = "RELOAD";
  reload.onclick = () => location.reload();
  card.append(reload);
  app.append(card);
};

window.addEventListener("error", (event) =>
  bootFailure(event.error ?? event.message),
);
window.addEventListener("unhandledrejection", (event) =>
  bootFailure(event.reason),
);
void import("../online/ui.js")
  .then((module) => module.startOnline())
  .catch(bootFailure);
