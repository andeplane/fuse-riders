import type { SafeStorage } from "./safe-storage.js";

export const CONTROLLER_SIDE_KEY = "fuse-riders-controller-bomb-side";

/** Device preference only: moving pads cancels contacts before their targets move. */
export function createControllerLayoutSetting(
  app: HTMLElement,
  storage: SafeStorage,
  clearControls: () => void,
) {
  const doc = app.ownerDocument;
  const label = doc.createElement("label");
  label.className = "controller-layout-setting";
  label.append("Landscape bomb side");
  const select = doc.createElement("select");
  select.setAttribute("aria-label", "Landscape bomb side");
  const initial =
    storage.getItem(CONTROLLER_SIDE_KEY) === "left" ? "left" : "right";
  for (const side of ["right", "left"] as const) {
    const option = doc.createElement("option");
    option.value = side;
    option.textContent = side === "left" ? "Left" : "Right";
    option.selected = side === initial;
    select.append(option);
  }
  app.dataset.bombSide = initial;
  select.addEventListener("change", () => {
    const side = select.value === "left" ? "left" : "right";
    clearControls();
    app.dataset.bombSide = side;
    storage.setItem(CONTROLLER_SIDE_KEY, side);
  });
  label.append(select);
  return label;
}
