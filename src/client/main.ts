import "@fontsource/press-start-2p/latin.css";
import "./style.css";
import "./viewport-lock.js";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing app root");

const bootFailure = (error: unknown) => {
  if (app.querySelector(".boot-failure") || app.querySelector(".online-header")) return;
  const card = document.createElement("section");
  card.className = "boot-failure";
  card.setAttribute("role", "alert");
  card.innerHTML = `<h1>Fuse Riders could not load</h1><p>${error instanceof Error ? error.message : String(error)}</p>`;
  const reload = document.createElement("button");
  reload.textContent = "RELOAD";
  reload.onclick = () => location.reload();
  card.append(reload);
  app.append(card);
};

window.addEventListener("error", (event) => bootFailure(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => bootFailure(event.reason));
void import("../online/ui.js")
  .then((module) => module.startOnline())
  .catch(bootFailure);
